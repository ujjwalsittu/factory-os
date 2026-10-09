CREATE TABLE "auth_passkey_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text,
	"rp_id" text NOT NULL,
	"config_hash" text NOT NULL,
	"password_version" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_passkey_action_shape_ck" CHECK ("auth_passkey_action"."kind" in ('register','rename','remove') and (("auth_passkey_action"."kind"='register')=("auth_passkey_action"."target_id" is null)) and "auth_passkey_action"."nonce_hash" ~ '^[a-f0-9]{64}$' and "auth_passkey_action"."password_version" ~ '^[a-f0-9]{64}$' and "auth_passkey_action"."config_hash" ~ '^[a-f0-9]{64}$' and "auth_passkey_action"."expires_at">"auth_passkey_action"."created_at" and "auth_passkey_action"."expires_at"<="auth_passkey_action"."created_at"+interval '300 seconds' and ("auth_passkey_action"."consumed_at" is null or ("auth_passkey_action"."consumed_at">="auth_passkey_action"."created_at" and "auth_passkey_action"."consumed_at"<"auth_passkey_action"."expires_at")))
);
--> statement-breakpoint
CREATE TABLE "auth_passkey_ceremony" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"session_id" text,
	"action_id" uuid,
	"challenge_hash" text NOT NULL,
	"rp_id" text NOT NULL,
	"user_handle" text,
	"return_cipher" text NOT NULL,
	"credential_id" text,
	"password_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_passkey_ceremony_shape_ck" CHECK ("auth_passkey_ceremony"."kind" in ('register','signin') and "auth_passkey_ceremony"."challenge_hash" ~ '^[a-f0-9]{64}$' and (("auth_passkey_ceremony"."kind"='register' and "auth_passkey_ceremony"."user_id" is not null and "auth_passkey_ceremony"."session_id" is not null and "auth_passkey_ceremony"."action_id" is not null and "auth_passkey_ceremony"."user_handle" ~ '^[A-Za-z0-9_-]{43}$') or ("auth_passkey_ceremony"."kind"='signin' and "auth_passkey_ceremony"."action_id" is null and "auth_passkey_ceremony"."user_handle" is null)) and "auth_passkey_ceremony"."expires_at">"auth_passkey_ceremony"."created_at" and "auth_passkey_ceremony"."expires_at"<="auth_passkey_ceremony"."created_at"+interval '300 seconds' and ("auth_passkey_ceremony"."password_version" is null or "auth_passkey_ceremony"."password_version" ~ '^[a-f0-9]{64}$') and ("auth_passkey_ceremony"."consumed_at" is null or ("auth_passkey_ceremony"."consumed_at">="auth_passkey_ceremony"."created_at" and "auth_passkey_ceremony"."consumed_at"<"auth_passkey_ceremony"."expires_at")))
);
--> statement-breakpoint
CREATE TABLE "auth_passkey_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text,
	"session_id" text,
	"rp_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_passkey_event_shape_ck" CHECK ("auth_passkey_event"."kind" in ('enrolled','renamed','removed','signed_in','failed') and ("auth_passkey_event"."code" is null or "auth_passkey_event"."code" in ('credential_refused','consent_refused','mfa_refused','configuration_refused')))
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"rp_id" text NOT NULL,
	"user_handle" text NOT NULL,
	"registration_action_id" uuid NOT NULL,
	"registration_ceremony_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_shape_ck" CHECK (length(btrim("passkey"."name")) between 1 and 80 and "passkey"."name"=btrim("passkey"."name") and "passkey"."counter" between 0 and 4294967295 and "passkey"."credential_id" ~ '^[A-Za-z0-9_-]+$' and length("passkey"."credential_id") between 1 and 1024 and length("passkey"."credential_id")%4<>1 and "passkey"."user_handle" ~ '^[A-Za-z0-9_-]{43}$' and length("passkey"."rp_id") between 1 and 253 and length("passkey"."public_key")>0 and "passkey"."device_type" in ('singleDevice','multiDevice'))
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "passkey_credential_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "passkey_rp_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "passkey_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "passkey_credential_id" text;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "passkey_rp_id" text;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "passkey_return_cipher" text;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "passkey_password_version" text;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkey_action_nonce_uq" ON "auth_passkey_action" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "auth_passkey_action_expiry_idx" ON "auth_passkey_action" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkey_ceremony_challenge_uq" ON "auth_passkey_ceremony" USING btree ("challenge_hash");--> statement-breakpoint
CREATE INDEX "auth_passkey_ceremony_expiry_idx" ON "auth_passkey_ceremony" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_passkey_event_owner_idx" ON "auth_passkey_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_uq" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_owner_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
-- Consent and native mutation evidence commit with the actual credential row.
CREATE FUNCTION factoryos_passkey_consume_action(p_id uuid,p_kind text,p_user text,p_target text,p_rp text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a auth_passkey_action%ROWTYPE; s session%ROWTYPE; v_now timestamptz;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM auth_passkey_action WHERE id=p_id FOR UPDATE;
 SELECT * INTO s FROM session WHERE id=a.session_id AND user_id=p_user FOR UPDATE;
 v_now:=clock_timestamp();
 IF a.id IS NULL OR a.user_id<>p_user OR a.kind<>p_kind OR a.target_id IS DISTINCT FROM p_target OR a.rp_id<>p_rp OR a.consumed_at IS NOT NULL OR a.expires_at<=v_now OR a.created_at>v_now OR s.id IS NULL OR s.expires_at<=v_now OR s.created_at>v_now OR s.created_at<=v_now-interval '300 seconds' OR s.sso_pending OR s.passkey_pending THEN
  RAISE EXCEPTION 'Passkey action/session consent refused';
 END IF;
 UPDATE auth_passkey_action SET consumed_at=v_now WHERE id=p_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at') OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION 'Passkey action immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER auth_passkey_action_immutable BEFORE UPDATE ON auth_passkey_action FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_action_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_ceremony_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'consumed_at'-'user_id'-'credential_id'-'password_version') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at'-'user_id'-'credential_id'-'password_version') THEN RAISE EXCEPTION 'Passkey ceremony immutable'; END IF;
 IF OLD.consumed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Passkey ceremony immutable'; END IF;
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.password_version IS DISTINCT FROM OLD.password_version THEN
  IF OLD.kind<>'signin' OR OLD.user_id IS NOT NULL OR OLD.credential_id IS NOT NULL OR OLD.password_version IS NOT NULL OR NEW.user_id IS NULL OR NEW.credential_id IS NULL OR NEW.password_version IS NULL THEN RAISE EXCEPTION 'Passkey ceremony identity immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM passkey WHERE id=NEW.credential_id AND user_id=NEW.user_id AND rp_id=NEW.rp_id) THEN RAISE EXCEPTION 'Passkey ceremony identity refused'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER auth_passkey_ceremony_immutable BEFORE UPDATE ON auth_passkey_ceremony FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_ceremony_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Passkey evidence is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER auth_passkey_event_append_only BEFORE UPDATE OR DELETE ON auth_passkey_event FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a_id uuid; c_id uuid; c auth_passkey_ceremony%ROWTYPE; v_now timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  a_id:=nullif(current_setting('factoryos.passkey.action_id',true),'')::uuid;
  c_id:=nullif(current_setting('factoryos.passkey.ceremony_id',true),'')::uuid;
  IF a_id IS NULL OR c_id IS NULL OR NEW.registration_action_id<>a_id OR NEW.registration_ceremony_id<>c_id THEN RAISE EXCEPTION 'Passkey registration proof refused'; END IF;
  PERFORM factoryos_passkey_consume_action(a_id,'register',NEW.user_id,NULL,NEW.rp_id);
  SELECT * INTO c FROM auth_passkey_ceremony WHERE id=c_id FOR UPDATE;
  v_now:=clock_timestamp();
  IF c.id IS NULL OR c.kind<>'register' OR c.user_id<>NEW.user_id OR c.action_id<>a_id OR c.rp_id<>NEW.rp_id OR c.user_handle<>NEW.user_handle OR c.consumed_at IS NOT NULL OR c.created_at>v_now OR c.expires_at<=v_now THEN RAISE EXCEPTION 'Passkey registration ceremony refused'; END IF;
  UPDATE auth_passkey_ceremony SET consumed_at=v_now WHERE id=c_id;
  INSERT INTO auth_passkey_event(user_id,credential_id,session_id,rp_id,kind) VALUES(NEW.user_id,NEW.id,c.session_id,NEW.rp_id,'enrolled');
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'name'-'counter'-'last_used_at') IS DISTINCT FROM (to_jsonb(OLD)-'name'-'counter'-'last_used_at') THEN RAISE EXCEPTION 'Passkey identity immutable'; END IF;
  IF NEW.name IS DISTINCT FROM OLD.name OR nullif(current_setting('factoryos.passkey.action_id',true),'') IS NOT NULL THEN
   a_id:=nullif(current_setting('factoryos.passkey.action_id',true),'')::uuid;
   IF a_id IS NULL THEN RAISE EXCEPTION 'Passkey rename proof refused'; END IF;
   PERFORM factoryos_passkey_consume_action(a_id,'rename',OLD.user_id,OLD.id,OLD.rp_id);
   INSERT INTO auth_passkey_event(user_id,credential_id,session_id,rp_id,kind) SELECT OLD.user_id,OLD.id,session_id,OLD.rp_id,'renamed' FROM auth_passkey_action WHERE id=a_id;
  END IF;
  IF NEW.counter IS DISTINCT FROM OLD.counter OR NEW.last_used_at IS DISTINCT FROM OLD.last_used_at THEN
   c_id:=nullif(current_setting('factoryos.passkey.ceremony_id',true),'')::uuid;
   SELECT * INTO c FROM auth_passkey_ceremony WHERE id=c_id;
   IF c.id IS NULL OR c.kind<>'signin' OR c.user_id<>OLD.user_id OR c.credential_id<>OLD.id OR c.rp_id<>OLD.rp_id OR c.consumed_at IS NULL OR (NEW.counter IS DISTINCT FROM OLD.counter AND c.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Passkey counter verification refused'; END IF;
   IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at AND NOT EXISTS(SELECT 1 FROM auth_passkey_event WHERE session_id=nullif(current_setting('factoryos.passkey.session_id',true),'') AND user_id=OLD.user_id AND credential_id=OLD.id AND rp_id=OLD.rp_id AND kind='signed_in') THEN RAISE EXCEPTION 'Passkey completion evidence required'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 a_id:=nullif(current_setting('factoryos.passkey.action_id',true),'')::uuid;
 IF a_id IS NULL THEN RAISE EXCEPTION 'Passkey removal proof refused'; END IF;
 PERFORM factoryos_passkey_consume_action(a_id,'remove',OLD.user_id,OLD.id,OLD.rp_id);
 DELETE FROM session WHERE passkey_credential_id=OLD.id;
 DELETE FROM verification WHERE passkey_credential_id=OLD.id;
 INSERT INTO auth_passkey_event(user_id,credential_id,session_id,rp_id,kind) SELECT OLD.user_id,OLD.id,session_id,OLD.rp_id,'removed' FROM auth_passkey_action WHERE id=a_id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER passkey_identity_and_evidence BEFORE INSERT OR UPDATE OR DELETE ON passkey FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_credential_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.passkey_credential_id,NEW.passkey_rp_id) IS DISTINCT FROM ROW(OLD.passkey_credential_id,OLD.passkey_rp_id) OR (OLD.passkey_credential_id IS NOT NULL AND NEW.user_id<>OLD.user_id) OR (NOT OLD.passkey_pending AND NEW.passkey_pending) THEN RAISE EXCEPTION 'Passkey session provenance immutable'; END IF;
  IF OLD.passkey_pending AND NOT NEW.passkey_pending AND NOT EXISTS(SELECT 1 FROM auth_passkey_event WHERE session_id=NEW.id AND user_id=NEW.user_id AND credential_id=NEW.passkey_credential_id AND rp_id=NEW.passkey_rp_id AND kind='signed_in') THEN RAISE EXCEPTION 'Passkey completion evidence required'; END IF;
 END IF;
 IF NEW.passkey_credential_id IS NULL THEN
  IF NEW.passkey_rp_id IS NOT NULL OR NEW.passkey_pending THEN RAISE EXCEPTION 'Passkey session provenance incomplete'; END IF;
 ELSE
  IF NEW.passkey_rp_id IS NULL OR NEW.sso_account_id IS NOT NULL OR NEW.sso_pending OR NOT EXISTS(SELECT 1 FROM passkey WHERE id=NEW.passkey_credential_id AND user_id=NEW.user_id AND rp_id=NEW.passkey_rp_id) THEN RAISE EXCEPTION 'Passkey session identity refused'; END IF;
  IF TG_OP='INSERT' AND NOT NEW.passkey_pending THEN RAISE EXCEPTION 'Passkey session must start pending'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER session_passkey_provenance BEFORE INSERT OR UPDATE ON session FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_session_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_passkey_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.passkey_credential_id,NEW.passkey_rp_id,NEW.passkey_return_cipher,NEW.passkey_password_version) IS DISTINCT FROM ROW(OLD.passkey_credential_id,OLD.passkey_rp_id,OLD.passkey_return_cipher,OLD.passkey_password_version) THEN RAISE EXCEPTION 'Passkey verification provenance immutable'; END IF;
 IF NEW.passkey_credential_id IS NULL THEN
  IF NEW.passkey_rp_id IS NOT NULL OR NEW.passkey_return_cipher IS NOT NULL OR NEW.passkey_password_version IS NOT NULL THEN RAISE EXCEPTION 'Passkey verification provenance incomplete'; END IF;
 ELSE
  IF NEW.passkey_rp_id IS NULL OR NEW.passkey_return_cipher IS NULL OR NEW.passkey_password_version IS NULL OR NEW.passkey_password_version !~ '^[a-f0-9]{64}$' OR NEW.sso_account_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM passkey WHERE id=NEW.passkey_credential_id AND user_id=NEW.value AND rp_id=NEW.passkey_rp_id) THEN RAISE EXCEPTION 'Passkey verification provenance refused'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER verification_passkey_provenance BEFORE INSERT OR UPDATE ON verification FOR EACH ROW EXECUTE FUNCTION factoryos_passkey_verification_guard();
