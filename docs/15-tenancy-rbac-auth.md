# 15 · Tenancy, Auth, RBAC and SuperAdmin

Decisions 002, 009, 010, 015. This is what Phase 0 builds.

## 1. Tenancy model

```
platform (FactoryOS installation)
 ├─ platform_admin (SuperAdmin users)
 └─ tenant (e.g. "Azeonics Group")          ← SaaS boundary, billing, feature flags
     ├─ membership (user ↔ tenant, status, is_owner)
     │    └─ role_assignment (role, scope: tenant | entity[] | plant[])
     ├─ role (tenant-defined; system roles seeded)
     ├─ legal_entity (PAN, CIN, parent_entity_id for subsidiaries, FY start month)
     │    ├─ gst_registration (GSTIN, state, type: regular|sez_unit|sez_developer|composition|isd,
     │    │                    einvoice_applicable_from, irp_provider, ewb_provider, returns_provider,
     │    │                    credential_ref)
     │    └─ plant (address, entity, gst_registration)
     └─ audit_event (append-only)
```

- **Request context** = `{ userId, tenantId, entityIds (allowed), activeEntityId, permissions }`,
  resolved once per request from the session plus the `x-tenant-id` / `x-entity-id` headers, and
  validated against the user's memberships and role scopes.
- Users can belong to multiple tenants (useful later for CAs and consultants). Tenant switcher appears
  only if there is more than one.
- **Subsidiary relation**: `legal_entity.parent_entity_id` (EarthNow → Azeonics) drives
  consolidation and inter-company rules.
- **SEZ / multi-state** are modelled now via `gst_registration.type` and `state_code`.
- **E-invoice applicability** is a date on the GST registration (`einvoice_applicable_from`,
  2027-04-01 for Azeonics) rather than a boolean.
- Phase 1 adds **Postgres RLS** on `tenant_id` / `entity_id` as defence-in-depth.

## 2. Authentication (Better Auth)

| Feature | Phase 0 | Later |
|---|---|---|
| Email + password (argon2/scrypt hashing) | ✓ | |
| Email verification & password reset | Durable encrypted SMTP queue when configured; reset links never logged | Verification remains optional; disabled mail retains private metadata only. Live sender/service configuration and inbox acceptance remain separate |
| Sessions (HTTP-only secure cookie, rotation, list & revoke) | ✓ | |
| MFA: TOTP + backup codes | ✓ | enforce per role/tenant |
| Passkeys (WebAuthn) | Optional existing-account personal passkeys; disabled by default; native TOTP/backup recovery retained | Requires fixed HTTPS origin/RP and real personal-device acceptance |
| Google / Microsoft SSO | Optional explicitly linked existing accounts; disabled by default; native TOTP retained | Requires OAuth app configuration and real provider acceptance |
| Rate limiting on auth endpoints | ✓ | |
| Invitation flow (tenant admin invites by email) | ✓ | |

Better Auth is mounted in the NestJS API at `/api/auth/*`. The web app calls it via the Better Auth
client. The API reads the session on every request.

### Optional personal passkeys (decision 045)

`PASSKEY_ENABLED=false` is the default. Set `PASSKEY_RP_ID` to the canonical web hostname and, when needed, `PASSKEY_ALLOWED_ORIGINS` to exact origins already trusted by auth. Production uses HTTPS; explicit localhost HTTP is restricted to development/test. The per-user limit is configurable from 1 to 20 (default 10).

Enrollment, rename and removal require a current completed session younger than five minutes and actual password confirmation. The same single-use proof is sent on options GET and verification POST. Enrollment requires discoverable credentials and verified user verification; it creates no session and changes no profile. Explicit passkey sign-in applies the existing native TOTP, backup-code and trusted-device policy. Private pending sessions cannot authorize personal, tenant or platform operations; required evidence commits before authority/cookies.

The security page shows only owned names and dates, handles current-account changes and keeps password recovery available. Disabled or old-RP credentials remain removable after fresh local proof. Removing a key revokes its pending/completed sourced sessions; losing the last key does not remove the password. Password reset retains keys and invalidates older pending MFA proof. Use your own phone/security key on a shared computer; no device-ownership certification is inferred.

Additive migrations `0032_passkey_security` and `0033_passkey_ceremony_bounds` preserve historical password/SSO rows. Apply reviewed migrations before starting the new API against that database. Test fixtures use owned disposable databases and an original hash/count/activation baseline; software/browser fixtures are separate from live proxy/HTTPS/RP and real-device acceptance.

## 3. RBAC

- **Permission** = `module.resource.action`, e.g. `accounts.voucher.submit`,
  `settings.user.invite`, `compliance.gst_return.file`. All permissions live in one catalog
  (`packages/auth/src/permissions.ts`) with a label and description. The UI permission matrix is
  generated from it.
- **Actions:** `read`, `create`, `update`, `submit`, `cancel`, `approve`, `delete`, `export`,
  `file` (statutory filing), `manage` (settings).
- **Role** = named set of permissions, defined per tenant. System roles are seeded and can be
  copied, not edited:

| System role | Purpose |
|---|---|
| Owner | Everything in the tenant, including billing and deleting entities |
| Administrator | Users, roles, entities, settings. No statutory filing |
| Finance Controller | All accounts + compliance including `compliance.gst_return.file` |
| Accountant | Vouchers, invoices, prepare returns, no filing, no cancel of submitted docs |
| Purchase | Suppliers, POs, GRNs |
| Sales | Customers, quotations, orders, invoices (draft) |
| Stores | Stock receipts/issues, transfers, counts, gate passes |
| Production Planner | BOM, routing, WOs, scheduling |
| Operator | Own job cards only (shop floor) |
| Quality | Inspections, NCR, FAI, calibration |
| Auditor (read-only) | Read + export everything, no writes |

- **Scope** per role assignment: `tenant` (all entities) or a list of entities (later plants and
  warehouses). Effective permissions for a request = union of the user's roles whose scope covers the
  active entity.
- **Maker-checker:** approval rules (Phase 1) reference permissions plus thresholds, and a document's
  creator can never approve it.
- **Guard usage** (API): `@RequirePermission('settings.user.invite')` on controllers; the guard
  checks the request context. UI hides what the user can't do, but the API is the authority.

## 4. SuperAdmin (platform operator)

- Stored in `platform_admin` (user id + level `superadmin | support`). Not a tenant role, so it can
  never be granted from inside a tenant.
- Capabilities: create/suspend tenants, assign plans and feature flags, view platform audit log and
  system health, **impersonate** a tenant user.
- **Impersonation guardrails:** reason required, 30-minute expiry, visible banner, cannot read
  credentials/secrets, every action recorded with both identities, tenant owner can see impersonation
  history.
- First SuperAdmin is created by a CLI seed command (`pnpm --filter @factoryos/api seed:superadmin`),
  never by a public endpoint.

## 5. Audit

`audit_event`: `id, occurred_at, tenant_id, entity_id, actor_user_id, impersonator_user_id,
action, target_type, target_id, before (jsonb), after (jsonb), ip, user_agent, reason,
prev_hash, hash`. Append-only (no update/delete grants in production). Hash-chained per tenant so
tampering is detectable.
