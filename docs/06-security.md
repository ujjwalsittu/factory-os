# 06 · Security

Aerospace customers send controlled drawings; a breach is existential. Security is designed in.

## Identity & access

- **Auth**: email + password with mandatory **MFA (TOTP/WebAuthn passkeys)**; **SSO via Google
  Workspace / Microsoft Entra** (OIDC) **[confirm which]**; short-lived sessions; device list & revoke.
- **Shop-floor login**: badge/QR + PIN on shared tablets, scoped to that work center.
- **RBAC + ABAC**: roles grant permissions on doc types/actions (`read`, `create`, `submit`,
  `cancel`, `approve`, `export`); attributes restrict scope — **entity, plant, warehouse, project,
  customer**. Example: a test engineer sees only service orders for campaigns assigned to them.
- **Field-level security**: costs, margins, salaries, bank details hidden by permission.
- **Maker-checker / segregation of duties**: creator cannot approve own PO/payment; configurable
  value thresholds.
- **Postgres RLS** as defence-in-depth for tenant/entity isolation.
- API keys / service accounts for integrations, scoped and expiring.

## Data protection

- TLS everywhere (incl. MQTT); encryption at rest (DB, object storage).
- **Envelope encryption** (KMS) for secrets: GSP creds, bank API creds, DSC metadata.
- **Customer IP vault**: drawings/CAD/NC programs per customer project, need-to-know ACLs,
  watermarking on download/view, download audit, optional view-only.
- Export-control flag on items/projects (SCOMET/ITAR-like) restricting who can view **[confirm]**.
- **DPDP Act 2023**: personal data inventory, consent for portal users, retention and erasure.
- Backups: PITR, encrypted, restore drill quarterly; data stays in India region.

## Audit

- Append-only, **hash-chained audit log**: who, what (field-level before/after), when, from where
  (IP/device), why (reason required for cancel/amend). Satisfies the Companies Act audit-trail rule.
- Login/permission-change/export events logged separately; anomaly alerts (bulk export, off-hours).

## Physical / plant security integrated into flows

- **Gate pass** for every material leaving or entering (returnable / non-returnable), verified by
  scan at the security desk against challan/invoice/EWB.
- Visitor log + cleanroom access log (badge integration later).
- Tool crib / high-value item issue with signature.

## Application security

- OWASP ASVS L2 as baseline; Zod validation at every boundary; parameterised SQL only.
- Dependency scanning, secret scanning, SAST in CI; signed container images.
- Rate limiting, CSRF protection, strict CSP.
- Edge agent: outbound-only connection, mutual TLS, per-device certs, signed updates.
