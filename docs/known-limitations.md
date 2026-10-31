# Current limitations

This is a public **evaluation release**, not a completed compliance workflow.
Use synthetic data. A framework readiness percentage is a derived signal, not a
certification or legal conclusion.

| Area | Current boundary |
| --- | --- |
| Assessments | Record creation, reviewer assignment, and accepting a draft suggestion have server paths. Manual answer editing and advancing sign-off in the renderer are local previews and disappear on refresh. System assessment status has no completed persistent approval workflow. |
| Evidence | Upload, metadata/preview storage, links and citations persist. Original bytes are discarded; scans can have no text preview. Verification/rejection on the record screen is local only, so new evidence cannot be persistently verified through that control. |
| Findings | Creation, filing, import/export, delete and restore exist. Root cause, corrective action, verification and closure editing remain local previews. |
| Intake | Submission and decision records persist. Endorsement/noting do not automatically create an inventory record or assessment; those are separate manual steps. |
| Trust centre | Internal/external views are authenticated previews. Public sharing is unavailable; no public share link is generated or copied. |
| Audit pack / SoA export | Document previews do not implement completed downloadable PDF generation. Generic record exports are separate supported operations. |
| Drafting | The active draft helpers assemble deterministic text and confidence/provenance from records. They do not invoke a model. Legacy model/File API plumbing is retained, not advertised as an active feature. |
| Fresh organisations | Reference initialization installs only framework definitions. It deliberately creates no people, users, policies or applicability claims. People/ownership administration and the full governance bootstrap are not complete. |
| Email and account recovery | No email transport is configured in application code; invitations are not delivered and email verification is disabled. Administrative account creation exists, but this is not a completed recovery/verification workflow. |
| Lifecycle | Retirement does not consistently remove a system from every readiness/attention calculation. Finding/risk handoffs and some governance relationships still require further work. |
| Rate limiting | Optional Redis; requests proceed when it is missing or fails. This is not a guaranteed cost cap. |
| Concurrency | Not every multi-step operation is transactional; Neon's HTTP driver has no interactive transactions. Audit-first operations can record a failed attempted write. |
| Hosting | Vercel/Neon are the reference target, but no live deployment of the new public repository was configured or validated during this work. Alternative Node/PostgreSQL hosting has not been end-to-end certified. |

## Deliberate safety boundaries

- Builds do not migrate, seed, initialize reference data, or purge trash.
- Demo seeding requires explicit opt-in and an operator-chosen password.
- Unknown permission state blocks protected requests; a successful empty lookup uses defaults.
- Authentication and redirects stay within the operator's configured instance.
- Date-sensitive calculations use the current UTC calendar date, not the old sample date.
- Evidence uploads are limited to 4 MB total per batch to leave request-envelope headroom.
- The retention endpoint refuses to run without a configured bearer secret.

The older lifecycle/design notes are useful historical context, but this file
is the current feature-boundary summary. Completing persistence, account/people
bootstrap, and production operations is separate feature work; this cleanup
does not silently implement or claim those capabilities.
