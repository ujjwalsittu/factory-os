CREATE TABLE "auth_sso_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"email_snapshot" text NOT NULL,
	"issuer" text NOT NULL,
	"target_account_id" text,
	"nonce_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_sso_action_shape_ck" CHECK ("auth_sso_action"."provider" in ('google','microsoft') and "auth_sso_action"."kind" in ('link','unlink') and (("auth_sso_action"."kind"='unlink')=("auth_sso_action"."target_account_id" is not null)) and "auth_sso_action"."nonce_hash" ~ '^[a-f0-9]{64}$' and "auth_sso_action"."expires_at">"auth_sso_action"."created_at" and "auth_sso_action"."expires_at"<="auth_sso_action"."created_at"+interval '300 seconds')
);
--> statement-breakpoint
CREATE TABLE "auth_sso_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"session_id" text,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sso_event_shape_ck" CHECK ("auth_sso_event"."provider" in ('google','microsoft') and "auth_sso_event"."kind" in ('linked','unlinked','signed_in','failed') and ("auth_sso_event"."code" is null or "auth_sso_event"."code" in ('identity_refused','consent_refused','mfa_refused','provider_refused')))
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sso_issuer" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sso_action_id" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_account_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_issuer" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "sso_account_id" text;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "sso_issuer" text;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "sso_return_cipher" text;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sso_action_nonce_uq" ON "auth_sso_action" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "auth_sso_action_expiry_idx" ON "auth_sso_action" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_sso_event_user_idx" ON "auth_sso_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_key_uq" ON "account" USING btree ("provider_id","account_id");
--> statement-breakpoint
-- The native adapter supplies a server-only action reference. Mutation and
-- permanent evidence succeed together or roll back together.
CREATE FUNCTION factoryos_sso_check_action(action_id uuid, expected_kind text, owner_id text, provider text, issuer text, binding_id text)
RETURNS auth_sso_action LANGUAGE plpgsql AS $$
DECLARE a auth_sso_action; s session; u "user"; sso_now timestamptz;
BEGIN
 SELECT * INTO a FROM auth_sso_action WHERE id=action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SSO consent refused'; END IF;
 SELECT * INTO s FROM session WHERE id=a.session_id AND user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SSO consent refused'; END IF;
 SELECT * INTO u FROM "user" WHERE id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SSO consent refused'; END IF;
 sso_now:=clock_timestamp();
 IF a.kind<>expected_kind OR a.user_id<>owner_id OR a.provider<>provider OR a.issuer<>issuer
  OR (expected_kind='unlink' AND a.target_account_id IS DISTINCT FROM binding_id)
  OR (expected_kind='link' AND a.target_account_id IS NOT NULL)
  OR a.consumed_at IS NOT NULL OR a.expires_at<=sso_now OR a.created_at>sso_now
  OR s.expires_at<=sso_now OR s.created_at<=sso_now-interval '300 seconds' OR s.sso_pending
  OR NOT u.email_verified OR u.email<>a.email_snapshot THEN RAISE EXCEPTION 'SSO consent refused'; END IF;
 RETURN a;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION factoryos_sso_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a auth_sso_action; b account;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.provider_id IN ('google','microsoft') OR NEW.provider_id IN ('google','microsoft') THEN
   IF (NEW.id,NEW.user_id,NEW.provider_id,NEW.account_id,NEW.sso_issuer) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.provider_id,OLD.account_id,OLD.sso_issuer) THEN RAISE EXCEPTION 'SSO identity is immutable'; END IF;
   IF NEW.sso_action_id IS DISTINCT FROM OLD.sso_action_id THEN
    PERFORM factoryos_sso_check_action(NEW.sso_action_id,'unlink',NEW.user_id,NEW.provider_id,NEW.sso_issuer,NEW.id);
   END IF;
  ELSIF NEW.sso_issuer IS NOT NULL OR NEW.sso_action_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected SSO credential metadata'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN b:=OLD; ELSE b:=NEW; END IF;
 IF b.provider_id NOT IN ('google','microsoft') THEN
  IF TG_OP='INSERT' AND (b.sso_issuer IS NOT NULL OR b.sso_action_id IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected SSO credential metadata'; END IF;
  RETURN b;
 END IF;
 -- A real user cascade is allowed; evidence has no FK that prevents erasure.
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=b.user_id) THEN
  INSERT INTO auth_sso_event(user_id,account_id,provider,issuer,kind) VALUES(b.user_id,b.id,b.provider_id,coalesce(b.sso_issuer,'unverified'),'unlinked'); RETURN OLD;
 END IF;
 IF b.sso_issuer IS NULL THEN RAISE EXCEPTION 'SSO issuer provenance required'; END IF;
 a:=factoryos_sso_check_action(b.sso_action_id,CASE WHEN TG_OP='DELETE' THEN 'unlink' ELSE 'link' END,b.user_id,b.provider_id,b.sso_issuer,b.id);
 UPDATE auth_sso_action SET consumed_at=clock_timestamp() WHERE id=a.id;
 INSERT INTO auth_sso_event(user_id,account_id,provider,issuer,kind) VALUES(b.user_id,b.id,b.provider_id,b.sso_issuer,CASE WHEN TG_OP='DELETE' THEN 'unlinked' ELSE 'linked' END);
 RETURN b;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_sso_guard BEFORE INSERT OR UPDATE OR DELETE ON account FOR EACH ROW EXECUTE FUNCTION factoryos_sso_binding_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_sso_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b account;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.user_id,NEW.sso_account_id,NEW.sso_issuer) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.sso_account_id,OLD.sso_issuer)
   OR (NOT OLD.sso_pending AND NEW.sso_pending) THEN RAISE EXCEPTION 'SSO session provenance is immutable'; END IF;
 END IF;
 IF (NEW.sso_account_id IS NULL)<>(NEW.sso_issuer IS NULL) OR (NEW.sso_pending AND NEW.sso_account_id IS NULL) THEN RAISE EXCEPTION 'Incomplete SSO session provenance'; END IF;
 IF NEW.sso_account_id IS NULL OR (TG_OP='UPDATE' AND NOT OLD.sso_pending) THEN RETURN NEW; END IF;
 SELECT * INTO b FROM account WHERE id=NEW.sso_account_id AND user_id=NEW.user_id FOR UPDATE;
 IF NOT FOUND OR b.provider_id NOT IN ('google','microsoft') OR b.sso_issuer IS DISTINCT FROM NEW.sso_issuer THEN RAISE EXCEPTION 'SSO binding unavailable'; END IF;
 IF NOT NEW.sso_pending THEN
  INSERT INTO auth_sso_event(user_id,account_id,session_id,provider,issuer,kind) VALUES(NEW.user_id,b.id,NEW.id,b.provider_id,b.sso_issuer,'signed_in');
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_sso_guard BEFORE INSERT OR UPDATE ON session FOR EACH ROW EXECUTE FUNCTION factoryos_sso_session_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_sso_event_frozen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SSO evidence is append only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER auth_sso_event_frozen BEFORE UPDATE OR DELETE ON auth_sso_event FOR EACH ROW EXECUTE FUNCTION factoryos_sso_event_frozen();
