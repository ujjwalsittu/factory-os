ALTER TABLE "auth_passkey_ceremony" DROP CONSTRAINT "auth_passkey_ceremony_shape_ck";--> statement-breakpoint
ALTER TABLE "auth_passkey_ceremony" ADD CONSTRAINT "auth_passkey_ceremony_shape_ck" CHECK ("auth_passkey_ceremony"."kind" in ('register','signin') and "auth_passkey_ceremony"."challenge_hash" ~ '^[a-f0-9]{64}$' and (("auth_passkey_ceremony"."kind"='register' and "auth_passkey_ceremony"."user_id" is not null and "auth_passkey_ceremony"."session_id" is not null and "auth_passkey_ceremony"."action_id" is not null and "auth_passkey_ceremony"."user_handle" is not null and "auth_passkey_ceremony"."user_handle" ~ '^[A-Za-z0-9_-]{43}$' and "auth_passkey_ceremony"."credential_id" is null and "auth_passkey_ceremony"."password_version" is null) or ("auth_passkey_ceremony"."kind"='signin' and "auth_passkey_ceremony"."session_id" is null and "auth_passkey_ceremony"."action_id" is null and "auth_passkey_ceremony"."user_handle" is null and (("auth_passkey_ceremony"."user_id" is null and "auth_passkey_ceremony"."credential_id" is null and "auth_passkey_ceremony"."password_version" is null and "auth_passkey_ceremony"."consumed_at" is null) or ("auth_passkey_ceremony"."user_id" is not null and "auth_passkey_ceremony"."credential_id" is not null and "auth_passkey_ceremony"."password_version" is not null and "auth_passkey_ceremony"."consumed_at" is not null)))) and "auth_passkey_ceremony"."expires_at">"auth_passkey_ceremony"."created_at" and "auth_passkey_ceremony"."expires_at"<="auth_passkey_ceremony"."created_at"+interval '300 seconds' and ("auth_passkey_ceremony"."password_version" is null or "auth_passkey_ceremony"."password_version" ~ '^[a-f0-9]{64}$') and ("auth_passkey_ceremony"."consumed_at" is null or ("auth_passkey_ceremony"."consumed_at">="auth_passkey_ceremony"."created_at" and "auth_passkey_ceremony"."consumed_at"<"auth_passkey_ceremony"."expires_at")));
--> statement-breakpoint
-- Explicit NULL-safe identity comparisons preserve fail-closed SQL authority.
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
 a_id:=nullif(current_setting('factoryos.passkey.action_id',true),'')::uuid;
 IF a_id IS NULL THEN RAISE EXCEPTION 'Passkey removal proof refused'; END IF;
 PERFORM factoryos_passkey_consume_action(a_id,'remove',OLD.user_id,OLD.id,OLD.rp_id);
 DELETE FROM session WHERE passkey_credential_id=OLD.id;
 DELETE FROM verification WHERE passkey_credential_id=OLD.id;
 INSERT INTO auth_passkey_event(user_id,credential_id,session_id,rp_id,kind) SELECT OLD.user_id,OLD.id,session_id,OLD.rp_id,'removed' FROM auth_passkey_action WHERE id=a_id;
 RETURN OLD;
END $$;
