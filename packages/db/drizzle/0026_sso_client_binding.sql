ALTER TABLE "account" ADD COLUMN "sso_client_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_client_id" text;--> statement-breakpoint
ALTER TABLE "auth_sso_action" ADD COLUMN "client_id" text;
--> statement-breakpoint
-- Never infer provenance for historical bindings; locally authorized removal is allowed.
CREATE OR REPLACE FUNCTION factoryos_sso_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a auth_sso_action; b account;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.provider_id IN ('google','microsoft') OR NEW.provider_id IN ('google','microsoft') THEN
   IF (NEW.id,NEW.user_id,NEW.provider_id,NEW.account_id,NEW.sso_issuer,NEW.sso_client_id) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.provider_id,OLD.account_id,OLD.sso_issuer,OLD.sso_client_id) THEN RAISE EXCEPTION 'SSO identity is immutable'; END IF;
   IF NEW.sso_action_id IS DISTINCT FROM OLD.sso_action_id THEN
    PERFORM factoryos_sso_check_action(NEW.sso_action_id,'unlink',NEW.user_id,NEW.provider_id,coalesce(NEW.sso_issuer,'unverified'),NEW.id);
   END IF;
  ELSIF NEW.sso_issuer IS NOT NULL OR NEW.sso_action_id IS NOT NULL OR NEW.sso_client_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected SSO credential metadata'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN b:=OLD; ELSE b:=NEW; END IF;
 IF b.provider_id NOT IN ('google','microsoft') THEN
  IF TG_OP='INSERT' AND (b.sso_issuer IS NOT NULL OR b.sso_action_id IS NOT NULL OR b.sso_client_id IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected SSO credential metadata'; END IF;
  RETURN b;
 END IF;
 -- A real user cascade is allowed; evidence has no FK that prevents erasure.
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=b.user_id) THEN
  INSERT INTO auth_sso_event(user_id,account_id,provider,issuer,kind) VALUES(b.user_id,b.id,b.provider_id,coalesce(b.sso_issuer,'unverified'),'unlinked'); RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND (b.sso_issuer IS NULL OR b.sso_client_id IS NULL) THEN RAISE EXCEPTION 'SSO issuer provenance required'; END IF;
 a:=factoryos_sso_check_action(b.sso_action_id,CASE WHEN TG_OP='DELETE' THEN 'unlink' ELSE 'link' END,b.user_id,b.provider_id,coalesce(b.sso_issuer,'unverified'),b.id);
 IF a.client_id IS DISTINCT FROM b.sso_client_id THEN RAISE EXCEPTION 'SSO client provenance refused'; END IF;
 UPDATE auth_sso_action SET consumed_at=clock_timestamp() WHERE id=a.id;
 INSERT INTO auth_sso_event(user_id,account_id,provider,issuer,kind) VALUES(b.user_id,b.id,b.provider_id,coalesce(b.sso_issuer,'unverified'),CASE WHEN TG_OP='DELETE' THEN 'unlinked' ELSE 'linked' END);
 RETURN b;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION factoryos_sso_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b account;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.user_id,NEW.sso_account_id,NEW.sso_issuer,NEW.sso_client_id) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.sso_account_id,OLD.sso_issuer,OLD.sso_client_id)
   OR (NOT OLD.sso_pending AND NEW.sso_pending) THEN RAISE EXCEPTION 'SSO session provenance is immutable'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NOT OLD.sso_pending THEN RETURN NEW; END IF;
 IF (NEW.sso_account_id IS NULL)<>(NEW.sso_issuer IS NULL) OR (NEW.sso_account_id IS NULL)<>(NEW.sso_client_id IS NULL) OR (NEW.sso_pending AND NEW.sso_account_id IS NULL) THEN RAISE EXCEPTION 'Incomplete SSO session provenance'; END IF;
 IF NEW.sso_account_id IS NULL OR (TG_OP='UPDATE' AND NOT OLD.sso_pending) THEN RETURN NEW; END IF;
 SELECT * INTO b FROM account WHERE id=NEW.sso_account_id AND user_id=NEW.user_id FOR UPDATE;
 IF NOT FOUND OR b.provider_id NOT IN ('google','microsoft') OR b.sso_issuer IS DISTINCT FROM NEW.sso_issuer OR b.sso_client_id IS DISTINCT FROM NEW.sso_client_id OR b.sso_client_id IS NULL THEN RAISE EXCEPTION 'SSO binding unavailable'; END IF;
 IF NOT NEW.sso_pending THEN
  INSERT INTO auth_sso_event(user_id,account_id,session_id,provider,issuer,kind) VALUES(NEW.user_id,b.id,NEW.id,b.provider_id,b.sso_issuer,'signed_in');
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
