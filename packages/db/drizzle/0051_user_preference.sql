CREATE TABLE "user_preference" (
	"user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- The erase routine also removes the person's menu preferences (favourites, recent pages).
CREATE OR REPLACE FUNCTION factoryos_erase_user(p_user text,p_tenant uuid,p_actor text,p_reason erasure_reason) RETURNS uuid LANGUAGE plpgsql AS $$
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
 DELETE FROM user_preference WHERE user_id=p_user;
 DELETE FROM membership WHERE user_id=p_user AND tenant_id=p_tenant;
 PERFORM set_config('factoryos.erasure.id','',true);
 RETURN e_id;
END $$;
