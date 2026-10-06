# Server-only transactional email

Shared contracts, configuration, AES-256-GCM envelopes and fixed version-one templates.
Import from `@factoryos/email` in the API or worker; do not import it in browser code.
Queue/source/SMTP integration is delivered by later tasks in the approved email plan.

`EMAIL_MODE=disabled` is the default and does not require credentials or permit a worker.
SMTP mode needs the documented sender, host/port/TLS, a separate canonical base64
32-byte envelope key and the existing public auth/web URL and auth signing secret.
Provide SMTP username/password together when the service requires authentication.
Never put their values in browser settings, logs or tracked files.

Production transport requires implicit TLS or required STARTTLS with certificate
verification. Plaintext is permitted only for a loopback development/test SMTP sink.
The API and worker must use the same payload key and public auth configuration;
keep the old key available until its envelopes are cleared.

Use `validateEmailActionUrl` before rendering source links. Authentication URL paths
and callback origins are fixed. `emailAad` binds a delivery to its purpose and exact
source; `sealEmail`/`openEmail` do not allow plaintext payload recovery under another
key or scope. The 64KiB envelope limit counts UTF-8 bytes.

SMTP acceptance is not inbox delivery. No SMTP connection or real mail is sent by
this package's pure tests. Run `pnpm --filter @factoryos/email test` for those tests.
