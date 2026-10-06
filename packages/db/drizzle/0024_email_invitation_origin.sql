ALTER TABLE "invitation" ADD COLUMN "origin" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_origin_check" CHECK ("invitation"."origin" in ('member','platform_owner'));--> statement-breakpoint
-- Recover original/replacement platform sources even if operational mail was pruned.
UPDATE invitation i SET origin='platform_owner'
WHERE EXISTS (SELECT 1 FROM email_delivery d WHERE d.invitation_id=i.id AND d.tenant_id=i.tenant_id AND d.purpose='owner_invitation')
 OR EXISTS (SELECT 1 FROM audit_event a WHERE a.action='platform.owner_invitation.renew'
    AND (a.target_id=i.id::text OR a.before->>'invitationId'=i.id::text))
 OR EXISTS (SELECT 1 FROM audit_event a WHERE a.action='platform.tenant.create'
    AND a.target_id=i.tenant_id::text AND a.actor_user_id=i.invited_by
    AND lower(a.after->>'ownerEmail')=i.email AND i.created_at<=a.occurred_at);
--> statement-breakpoint
CREATE FUNCTION factoryos_invitation_origin_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.origin IS DISTINCT FROM OLD.origin THEN RAISE EXCEPTION 'Invitation origin is immutable'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitation_origin_frozen BEFORE UPDATE ON invitation
FOR EACH ROW EXECUTE FUNCTION factoryos_invitation_origin_frozen();
