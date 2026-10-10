CREATE TABLE "support_access_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grant_id" uuid,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"subject_user_id" text,
	"operator_user_id" text,
	"area" text,
	"reason_code" text,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "support_access_event_kind_ck" CHECK ("support_access_event"."kind" in ('approved','started','stopped','revoked','expired','invalidated','read','denied','policy-changed')),
	CONSTRAINT "support_access_event_area_ck" CHECK ("support_access_event"."area" is null or "support_access_event"."area" = any(array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[])),
	CONSTRAINT "support_access_event_reason_ck" CHECK ("support_access_event"."reason_code" is null or "support_access_event"."reason_code" ~ '^[a-z][a-z0-9-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "support_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"operator_user_id" text NOT NULL,
	"subject_user_id" text NOT NULL,
	"subject_membership_id" uuid NOT NULL,
	"approver_user_id" text NOT NULL,
	"areas" text[] NOT NULL,
	"reason" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"start_by" timestamp with time zone NOT NULL,
	"policy_config_revision" bigint NOT NULL,
	"tenant_authority_revision" bigint NOT NULL,
	"operator_epoch" bigint NOT NULL,
	"subject_epoch" bigint NOT NULL,
	"approver_epoch" bigint NOT NULL,
	"approver_password_version" text NOT NULL,
	"approver_session_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"actor_session_id" text,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_kind" text,
	"end_reason" text,
	"ended_by" text,
	CONSTRAINT "support_access_grant_duration_ck" CHECK ("support_access_grant"."duration_seconds" between 300 and 1800),
	CONSTRAINT "support_access_grant_areas_ck" CHECK (cardinality("support_access_grant"."areas") between 1 and 5 and "support_access_grant"."areas" <@ array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[]),
	CONSTRAINT "support_access_grant_reason_ck" CHECK (char_length("support_access_grant"."reason") between 3 and 500),
	CONSTRAINT "support_access_grant_people_ck" CHECK ("support_access_grant"."operator_user_id" <> "support_access_grant"."approver_user_id" and "support_access_grant"."operator_user_id" <> "support_access_grant"."subject_user_id"),
	CONSTRAINT "support_access_grant_window_ck" CHECK ("support_access_grant"."start_by" > "support_access_grant"."approved_at" and "support_access_grant"."start_by" <= "support_access_grant"."approved_at" + interval '600 seconds'),
	CONSTRAINT "support_access_grant_start_ck" CHECK (("support_access_grant"."started_at" is null and "support_access_grant"."actor_session_id" is null and "support_access_grant"."expires_at" is null) or ("support_access_grant"."started_at" is not null and "support_access_grant"."actor_session_id" is not null and "support_access_grant"."expires_at" is not null and "support_access_grant"."started_at" <= "support_access_grant"."start_by" and "support_access_grant"."expires_at" > "support_access_grant"."started_at" and "support_access_grant"."expires_at" <= "support_access_grant"."started_at" + make_interval(secs => "support_access_grant"."duration_seconds"))),
	CONSTRAINT "support_access_grant_end_ck" CHECK (("support_access_grant"."ended_at" is null and "support_access_grant"."end_kind" is null and "support_access_grant"."end_reason" is null and "support_access_grant"."ended_by" is null) or ("support_access_grant"."ended_at" is not null and "support_access_grant"."end_kind" in ('stopped','revoked','expired','invalidated') and "support_access_grant"."ended_at" >= "support_access_grant"."approved_at"))
);
--> statement-breakpoint
CREATE TABLE "support_access_policy" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_duration_seconds" integer DEFAULT 1800 NOT NULL,
	"allowed_areas" text[] DEFAULT array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[] NOT NULL,
	"config_revision" bigint DEFAULT 0 NOT NULL,
	"authority_revision" bigint DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_policy_duration_ck" CHECK ("support_access_policy"."max_duration_seconds" between 300 and 1800),
	CONSTRAINT "support_access_policy_areas_ck" CHECK (cardinality("support_access_policy"."allowed_areas") between 1 and 5 and "support_access_policy"."allowed_areas" <@ array['inventory','sales-invoices','purchase-invoices','work-orders','accounting']::text[]),
	CONSTRAINT "support_access_policy_revisions_ck" CHECK ("support_access_policy"."config_revision" >= 0 and "support_access_policy"."authority_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "support_access_user_epoch" (
	"user_id" text PRIMARY KEY NOT NULL,
	"security_epoch" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_user_epoch_ck" CHECK ("support_access_user_epoch"."security_epoch" >= 0)
);
--> statement-breakpoint
ALTER TABLE "support_access_policy" ADD CONSTRAINT "support_access_policy_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_access_event_tenant_idx" ON "support_access_event" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "support_access_event_grant_idx" ON "support_access_event" USING btree ("grant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "support_access_grant_tenant_idx" ON "support_access_grant" USING btree ("tenant_id","approved_at");--> statement-breakpoint
CREATE INDEX "support_access_grant_operator_idx" ON "support_access_grant" USING btree ("operator_user_id","approved_at");--> statement-breakpoint
CREATE INDEX "support_access_grant_session_idx" ON "support_access_grant" USING btree ("actor_session_id");--> statement-breakpoint
-- Support access (decision 050), hand-written: immutable consent, append-only evidence and transactional authority
-- revisions. Every source trigger is statement-level and locks the affected epoch/policy rows in key order, so
-- concurrent multi-row changes cannot deadlock against each other; support control work takes user epochs, then
-- tenant policies, then grants, always in key order, and never locks source rows.
CREATE FUNCTION factoryos_support_bump_users(ids text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ids IS NULL OR cardinality(ids)=0 THEN RETURN; END IF;
 PERFORM 1 FROM support_access_user_epoch WHERE user_id=ANY(ids) ORDER BY user_id FOR UPDATE;
 UPDATE support_access_user_epoch SET security_epoch=security_epoch+1,updated_at=clock_timestamp() WHERE user_id=ANY(ids);
END $$;
--> statement-breakpoint
CREATE FUNCTION factoryos_support_bump_tenants(ids uuid[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ids IS NULL OR cardinality(ids)=0 THEN RETURN; END IF;
 PERFORM 1 FROM support_access_policy WHERE tenant_id=ANY(ids) ORDER BY tenant_id FOR UPDATE;
 UPDATE support_access_policy SET authority_revision=authority_revision+1,updated_at=clock_timestamp() WHERE tenant_id=ANY(ids);
END $$;
--> statement-breakpoint
-- Native identity: email, verification and the two-factor switch. Names, images and timestamps do not count.
CREATE FUNCTION factoryos_support_user_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];
BEGIN
 IF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM old_rows;
 ELSE SELECT array_agg(DISTINCT o.id ORDER BY o.id) INTO ids FROM old_rows o JOIN new_rows n ON n.id=o.id
  WHERE (o.email,o.email_verified,o.two_factor_enabled) IS DISTINCT FROM (n.email,n.email_verified,n.two_factor_enabled);
 END IF;
 PERFORM factoryos_support_bump_users(ids); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_user_update AFTER UPDATE ON "user" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_user_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_user_delete AFTER DELETE ON "user" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_user_authority();
--> statement-breakpoint
-- Local password: credential accounts only (SSO links are not support proof).
CREATE FUNCTION factoryos_support_account_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM new_rows WHERE provider_id='credential';
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM old_rows WHERE provider_id='credential';
 ELSE SELECT array_agg(DISTINCT u ORDER BY u) INTO ids FROM (
  SELECT o.user_id u FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.provider_id='credential' OR n.provider_id='credential') AND (o.password,o.user_id,o.provider_id) IS DISTINCT FROM (n.password,n.user_id,n.provider_id)
  UNION SELECT n.user_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.provider_id='credential' OR n.provider_id='credential') AND (o.password,o.user_id,o.provider_id) IS DISTINCT FROM (n.password,n.user_id,n.provider_id)) s;
 END IF;
 PERFORM factoryos_support_bump_users(ids); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_account_insert AFTER INSERT ON account REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_account_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_account_update AFTER UPDATE ON account REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_account_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_account_delete AFTER DELETE ON account REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_account_authority();
--> statement-breakpoint
-- Verified TOTP: enrolment, removal, a new secret or verification. Failure counters, lockouts and consuming a
-- backup code are not authority changes.
CREATE FUNCTION factoryos_support_factor_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM new_rows;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM old_rows;
 ELSE SELECT array_agg(DISTINCT u ORDER BY u) INTO ids FROM (
  SELECT o.user_id u FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.secret,o.verified,o.user_id) IS DISTINCT FROM (n.secret,n.verified,n.user_id)
  UNION SELECT n.user_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.secret,o.verified,o.user_id) IS DISTINCT FROM (n.secret,n.verified,n.user_id)) s;
 END IF;
 PERFORM factoryos_support_bump_users(ids); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_factor_insert AFTER INSERT ON two_factor REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_factor_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_factor_update AFTER UPDATE ON two_factor REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_factor_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_factor_delete AFTER DELETE ON two_factor REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_factor_authority();
--> statement-breakpoint
CREATE FUNCTION factoryos_support_platform_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM new_rows;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT user_id ORDER BY user_id) INTO ids FROM old_rows;
 ELSE SELECT array_agg(DISTINCT u ORDER BY u) INTO ids FROM (SELECT user_id u FROM old_rows UNION SELECT user_id FROM new_rows) s;
 END IF;
 PERFORM factoryos_support_bump_users(ids); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_platform_insert AFTER INSERT ON platform_admin REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_platform_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_platform_update AFTER UPDATE ON platform_admin REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_platform_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_platform_delete AFTER DELETE ON platform_admin REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_platform_authority();
--> statement-breakpoint
-- Tenancy: tenant status, membership status/identity/ownership, role permissions, assignments and entity eligibility.
-- The first release invalidates every grant of an affected tenant (approved in the written spec).
CREATE FUNCTION factoryos_support_tenancy_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
 IF TG_TABLE_NAME='tenant' THEN
  SELECT array_agg(DISTINCT o.id ORDER BY o.id) INTO ids FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE o.status IS DISTINCT FROM n.status;
 ELSIF TG_OP='INSERT' THEN
  SELECT array_agg(DISTINCT tenant_id ORDER BY tenant_id) INTO ids FROM new_rows;
 ELSIF TG_OP='DELETE' THEN
  SELECT array_agg(DISTINCT tenant_id ORDER BY tenant_id) INTO ids FROM old_rows;
 ELSIF TG_TABLE_NAME='membership' THEN
  SELECT array_agg(DISTINCT t ORDER BY t) INTO ids FROM (
   SELECT o.tenant_id t FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.status,o.user_id,o.tenant_id,o.is_owner) IS DISTINCT FROM (n.status,n.user_id,n.tenant_id,n.is_owner)
   UNION SELECT n.tenant_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.status,o.user_id,o.tenant_id,o.is_owner) IS DISTINCT FROM (n.status,n.user_id,n.tenant_id,n.is_owner)) s;
 ELSIF TG_TABLE_NAME='role' THEN
  SELECT array_agg(DISTINCT t ORDER BY t) INTO ids FROM (
   SELECT o.tenant_id t FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.permissions,o.tenant_id) IS DISTINCT FROM (n.permissions,n.tenant_id)
   UNION SELECT n.tenant_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.permissions,o.tenant_id) IS DISTINCT FROM (n.permissions,n.tenant_id)) s;
 ELSIF TG_TABLE_NAME='role_assignment' THEN
  SELECT array_agg(DISTINCT t ORDER BY t) INTO ids FROM (
   SELECT o.tenant_id t FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.membership_id,o.role_id,o.entity_ids,o.tenant_id) IS DISTINCT FROM (n.membership_id,n.role_id,n.entity_ids,n.tenant_id)
   UNION SELECT n.tenant_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.membership_id,o.role_id,o.entity_ids,o.tenant_id) IS DISTINCT FROM (n.membership_id,n.role_id,n.entity_ids,n.tenant_id)) s;
 ELSIF TG_TABLE_NAME='legal_entity' THEN
  SELECT array_agg(DISTINCT t ORDER BY t) INTO ids FROM (
   SELECT o.tenant_id t FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.is_active,o.tenant_id) IS DISTINCT FROM (n.is_active,n.tenant_id)
   UNION SELECT n.tenant_id FROM old_rows o JOIN new_rows n ON n.id=o.id WHERE (o.is_active,o.tenant_id) IS DISTINCT FROM (n.is_active,n.tenant_id)) s;
 END IF;
 PERFORM factoryos_support_bump_tenants(ids); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_tenant_update AFTER UPDATE ON tenant REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_membership_update AFTER UPDATE ON membership REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_membership_delete AFTER DELETE ON membership REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_role_update AFTER UPDATE ON role REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_role_delete AFTER DELETE ON role REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_assignment_insert AFTER INSERT ON role_assignment REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_assignment_update AFTER UPDATE ON role_assignment REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_assignment_delete AFTER DELETE ON role_assignment REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_entity_update AFTER UPDATE ON legal_entity REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
CREATE TRIGGER support_access_entity_delete AFTER DELETE ON legal_entity REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_tenancy_authority();
--> statement-breakpoint
-- Deleting the exact native session a grant was started from ends that grant, once, with evidence. Expired grants
-- are left alone (their state is already derived), so routine cleanup of old sessions records nothing.
CREATE FUNCTION factoryos_support_session_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM support_access_grant WHERE actor_session_id IN (SELECT id FROM old_rows) AND ended_at IS NULL ORDER BY id FOR UPDATE;
 WITH ended AS (
  UPDATE support_access_grant g SET ended_at=clock_timestamp(),end_kind='invalidated',end_reason='actor-session-ended'
  WHERE g.actor_session_id IN (SELECT id FROM old_rows) AND g.ended_at IS NULL AND g.expires_at>clock_timestamp()
  RETURNING g.id,g.tenant_id,g.operator_user_id,g.subject_user_id)
 INSERT INTO support_access_event(tenant_id,grant_id,kind,operator_user_id,subject_user_id,reason_code)
  SELECT tenant_id,id,'invalidated',operator_user_id,subject_user_id,'actor-session-ended' FROM ended;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_session_delete AFTER DELETE ON session REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION factoryos_support_session_ended();
--> statement-breakpoint
-- Consent identity and scope never change; start and end are one-way; nothing is deleted.
CREATE FUNCTION factoryos_support_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Support consent is permanent evidence'; END IF;
 IF (to_jsonb(NEW)-'started_at'-'actor_session_id'-'expires_at'-'ended_at'-'end_kind'-'end_reason'-'ended_by') IS DISTINCT FROM (to_jsonb(OLD)-'started_at'-'actor_session_id'-'expires_at'-'ended_at'-'end_kind'-'end_reason'-'ended_by') THEN RAISE EXCEPTION 'Support consent is immutable'; END IF;
 IF OLD.ended_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Support consent has ended'; END IF;
 IF OLD.started_at IS NOT NULL AND (NEW.started_at,NEW.actor_session_id,NEW.expires_at) IS DISTINCT FROM (OLD.started_at,OLD.actor_session_id,OLD.expires_at) THEN RAISE EXCEPTION 'Support consent already started'; END IF;
 IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL AND NEW.ended_at IS NOT NULL THEN RAISE EXCEPTION 'Support consent cannot start and end at once'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_grant_guard BEFORE UPDATE OR DELETE ON support_access_grant FOR EACH ROW EXECUTE FUNCTION factoryos_support_grant_guard();
--> statement-breakpoint
CREATE FUNCTION factoryos_support_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Support evidence is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_event_append_only BEFORE UPDATE OR DELETE ON support_access_event FOR EACH ROW EXECUTE FUNCTION factoryos_support_event_guard();
--> statement-breakpoint
-- Revisions and epochs only move forward; identity keys never change.
CREATE FUNCTION factoryos_support_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='support_access_user_epoch' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Support epochs are permanent'; END IF;
  IF NEW.user_id<>OLD.user_id OR NEW.security_epoch<OLD.security_epoch THEN RAISE EXCEPTION 'Support epoch can only increase'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.config_revision<OLD.config_revision OR NEW.authority_revision<OLD.authority_revision THEN RAISE EXCEPTION 'Support policy revisions can only increase'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_access_epoch_guard BEFORE UPDATE OR DELETE ON support_access_user_epoch FOR EACH ROW EXECUTE FUNCTION factoryos_support_revision_guard();
--> statement-breakpoint
CREATE TRIGGER support_access_policy_guard BEFORE UPDATE OR DELETE ON support_access_policy FOR EACH ROW EXECUTE FUNCTION factoryos_support_revision_guard();
