CREATE TYPE "public"."erasure_reason" AS ENUM('data_principal_request', 'left_organisation', 'duplicate_account', 'consent_withdrawn');--> statement-breakpoint
CREATE TABLE "user_erasure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"erased_by" text NOT NULL,
	"reason" "erasure_reason" NOT NULL,
	"txid" bigint DEFAULT txid_current() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_erasure" ADD CONSTRAINT "user_erasure_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_erasure" ADD CONSTRAINT "user_erasure_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_erasure" ADD CONSTRAINT "user_erasure_erased_by_user_id_fk" FOREIGN KEY ("erased_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_erasure_user_uq" ON "user_erasure" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_erasure_tenant_idx" ON "user_erasure" USING btree ("tenant_id");
--> statement-breakpoint
-- Decision 067: erasure by anonymisation. The guards' erasure path needs this transaction's erasure row for the user
-- and the user already marked erased; a transaction setting alone is not proof.
CREATE FUNCTION factoryos_user_erasure_authorised(p_user text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE e_id uuid;
BEGIN
 e_id:=nullif(current_setting('factoryos.erasure.id',true),'')::uuid;
 IF e_id IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM user_erasure e JOIN "user" u ON u.id=e.user_id WHERE e.id=e_id AND e.user_id=p_user AND e.txid=txid_current() AND u.erased_at IS NOT NULL);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION factoryos_passkey_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a_id uuid; c_id uuid; c auth_passkey_ceremony%ROWTYPE; v_now timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  a_id:=nullif(current_setting('factoryos.passkey.action_id',true),'')::uuid;
  c_id:=nullif(current_setting('factoryos.passkey.ceremony_id',true),'')::uuid;
  IF a_id IS NULL OR c_id IS NULL OR NEW.registration_action_id<>a_id OR NEW.registration_ceremony_id<>c_id THEN RAISE EXCEPTION 'Passkey registration proof refused'; END IF;
  PERFORM factoryos_passkey_consume_action(a_id,'register',NEW.user_id,NULL,NEW.rp_id);
  SELECT * INTO c FROM auth_passkey_ceremony WHERE id=c_id FOR UPDATE;
  v_now:=clock_timestamp();
  IF c.id IS NULL OR c.kind<>'register' OR c.user_id IS DISTINCT FROM NEW.user_id OR c.action_id IS DISTINCT FROM a_id OR c.rp_id IS DISTINCT FROM NEW.rp_id OR c.user_handle IS DISTINCT FROM NEW.user_handle OR c.consumed_at IS NOT NULL OR c.created_at>v_now OR c.expires_at<=v_now THEN RAISE EXCEPTION 'Passkey registration ceremony refused'; END IF;
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
   IF c.id IS NULL OR c.kind<>'signin' OR c.user_id IS DISTINCT FROM OLD.user_id OR c.credential_id IS DISTINCT FROM OLD.id OR c.rp_id IS DISTINCT FROM OLD.rp_id OR c.consumed_at IS NULL OR (NEW.counter IS DISTINCT FROM OLD.counter AND c.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Passkey counter verification refused'; END IF;
   IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at AND NOT EXISTS(SELECT 1 FROM auth_passkey_event WHERE session_id=nullif(current_setting('factoryos.passkey.session_id',true),'') AND user_id=OLD.user_id AND credential_id=OLD.id AND rp_id=OLD.rp_id AND kind='signed_in') THEN RAISE EXCEPTION 'Passkey completion evidence required'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- Decision 067: a passkey goes with its owner's erasure, bound to the erasure row of this transaction.
 IF factoryos_user_erasure_authorised(OLD.user_id) THEN
  DELETE FROM session WHERE passkey_credential_id=OLD.id;
  DELETE FROM verification WHERE passkey_credential_id=OLD.id;
  INSERT INTO auth_passkey_event(user_id,credential_id,session_id,rp_id,kind) VALUES(OLD.user_id,OLD.id,NULL,OLD.rp_id,'removed');
  RETURN OLD;
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
 -- Decision 067: an SSO link also goes with its owner's erasure in the same transaction.
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM "user" WHERE id=b.user_id) OR factoryos_user_erasure_authorised(b.user_id)) THEN
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
-- One step: record, anonymise, remove every way to sign in, this workspace's invitations and the membership.
CREATE FUNCTION factoryos_erase_user(p_user text,p_tenant uuid,p_actor text,p_reason erasure_reason) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u "user"%ROWTYPE; e_id uuid; placeholder text;
BEGIN
 SELECT * INTO u FROM "user" WHERE id=p_user FOR UPDATE;
 IF u.id IS NULL OR NOT EXISTS(SELECT 1 FROM membership WHERE user_id=p_user AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Erasure refused: not a member of this workspace'; END IF;
 IF u.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Erasure refused: already erased'; END IF;
 IF p_actor=p_user THEN RAISE EXCEPTION 'Erasure refused: not oneself'; END IF;
 IF NOT EXISTS(SELECT 1 FROM membership WHERE user_id=p_actor AND tenant_id=p_tenant AND is_owner AND status='active') THEN RAISE EXCEPTION 'Erasure refused: only an owner erases'; END IF;
 IF EXISTS(SELECT 1 FROM membership WHERE user_id=p_user AND tenant_id=p_tenant AND is_owner) THEN RAISE EXCEPTION 'Erasure refused: remove ownership first'; END IF;
 IF EXISTS(SELECT 1 FROM membership WHERE user_id=p_user AND tenant_id<>p_tenant) THEN RAISE EXCEPTION 'Erasure refused: member of another workspace'; END IF;
 IF EXISTS(SELECT 1 FROM platform_admin WHERE user_id=p_user) THEN RAISE EXCEPTION 'Erasure refused: platform administrator'; END IF;
 INSERT INTO user_erasure(tenant_id,user_id,erased_by,reason) VALUES(p_tenant,p_user,p_actor,p_reason) RETURNING id INTO e_id;
 placeholder:='erased-'||p_user||'@erased.invalid';
 UPDATE "user" SET name='Erased user',email=placeholder,email_verified=false,image=NULL,two_factor_enabled=false,erased_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_user;
 PERFORM set_config('factoryos.erasure.id',e_id::text,true);
 -- Only this workspace's invitations: other workspaces decide their own.
 UPDATE invitation SET email=placeholder,status=CASE WHEN status='pending' THEN 'revoked'::invitation_status ELSE status END WHERE tenant_id=p_tenant AND lower(email)=lower(u.email);
 DELETE FROM passkey WHERE user_id=p_user;
 DELETE FROM auth_passkey_ceremony WHERE user_id=p_user;
 DELETE FROM auth_passkey_action WHERE user_id=p_user;
 DELETE FROM account WHERE user_id=p_user;
 DELETE FROM auth_sso_action WHERE user_id=p_user;
 DELETE FROM two_factor WHERE user_id=p_user;
 DELETE FROM verification WHERE identifier=u.email OR value=p_user;
 DELETE FROM session WHERE user_id=p_user;
 DELETE FROM membership WHERE user_id=p_user AND tenant_id=p_tenant;
 PERFORM set_config('factoryos.erasure.id','',true);
 RETURN e_id;
END $$;
