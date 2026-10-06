# @factoryos/worker

Background jobs: GSP/IRP/EWB calls, posting/reposting, billing runs, reports, notifications. Queue pending decision T3.

> Scaffold only — see [docs/](../../docs/README.md). No feature code until the plan is approved.

Email runs only with explicit `EMAIL_WORKER_ENABLED=true` and complete SMTP configuration.
The same process retains sandbox mock work and `--once`. Two separate worker processes
may claim email concurrently; the database caps active leases at two. SIGTERM stops new
claims and lets an in-flight transport complete within its bounded timeout. Acceptance
unknown never retries automatically. Run local SMTP/schema fixtures without real credentials.
