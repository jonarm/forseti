# Deploying an independent instance

## Reference platform: Vercel and Neon

Each instance needs its own GitHub fork/checkout, Vercel project, PostgreSQL
database, authentication secret, and any optional integration accounts. This
repository has no runtime dependency on the original owner's project or domains.
The release remains experimental; use synthetic data and read
[known limitations](known-limitations.md).

1. Fork `jonarm/forseti` or import your own copy into a **new** Vercel project.
2. Choose Next.js and Node.js 24. Commit the lockfile and use `npm ci` for installs.
3. Provision your own Neon database. For previews, use a separate disposable
   database or Neon branch. Never assume a Vercel preview is isolated merely
   because its application URL is different.
4. Configure `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, and the application's
   production `BETTER_AUTH_URL` in the correct project/environment. Configure
   optional services only when you intend to use them. See [environment variables](environment.md).
5. Confirm the target database and review the migrations. In an
   administrative hosted shell configured for that database, run `npm run db:migrate`.
   This is a database-changing operation, separate from deployment.
6. Deploy with `npm run vercel-build` (equivalent to `npm run build`). Builds do
   **not** run migrations, install demo data, initialize reference definitions,
   or invoke the trash purge.
7. Open the app, create your account and organisation, and note its slug.
8. In your administrative shell, explicitly run:

   ```sh
   npm run reference:init -- --organization your-organization-slug
   ```

   The command uses injected environment variables or ignored `.env.local`.
   It requires an existing organisation and inserts only reference definitions.
   It does not create people, users, applicability decisions, or demo records.
   Existing definitions are preserved. If connectivity fails partway through,
   rerun the same command after resolving it.
9. Run the deployment verification checklist below. A green deployment alone
   does not establish authentication, persistence, tenant isolation, or readiness.

Run administrative commands in a local or hosted shell with credentials stored
in its secure settings. Keep credentials out of pull requests and repository files.

## Authentication and custom domains

Production authentication resolves `BETTER_AUTH_URL`, then the Vercel production
URL, then the deployment URL. Previews use their own `VERCEL_URL` first, even when
the production custom domain is configured. Explicit Vercel hostnames are also
trusted; wildcard Vercel domains are not used.

If the project's primary domain is a marketing site, set `BETTER_AUTH_URL` to the
actual application origin. Register provider callback URLs against that origin.
The public app serves the application on the operator's host; it does not forward
visitors to the original owner's marketing or application domains.

## Retention scheduling

`vercel.json` declares a daily `GET /api/cron/purge-trash` schedule at 04:00 UTC.
If `CRON_SECRET` is unset the handler returns 503 without deleting records.
Enabling the job permanently removes records whose trash retention has expired;
review the 30-day policy and backups before enabling it. Vercel sends the configured
secret as a bearer token. Set your own secret if you enable the schedule; do not
assume the platform has generated one for you.

On other hosts, configure your own scheduler to call the same endpoint with the
bearer header, using a secure secret binding. Do not put the token in a URL.
No automatic scheduling on those hosts has been verified by this project.

## Other Node.js hosting

The existing non-Neon driver supports ordinary PostgreSQL. A host needs Node.js
24, HTTPS termination, access to the database, and support for Next.js's Node
runtime. Install development dependencies to compile the Tailwind styles:

```sh
npm ci --include=dev
npm run build
npm start
```

Supply runtime variables through the hosting platform. Migrations and reference
initialization remain explicit administrative operations; running `npm start`
does neither. Static-only hosting is unsuitable because the app requires server
rendering, authentication, and API routes. Other platforms have not been
end-to-end certified. Bundled fonts avoid a build-time Google Fonts requirement.

## Optional synthetic demonstration

The default setup uses your own account and reference definitions. If you want
the fictional Meridian Analytics workspace, use a disposable database and explicitly
set `ALLOW_DEMO_SEED=1` and a private `DEMO_PASSWORD` in its ignored `.env.local`.
Then run `npm run seed`. Demo account emails are `demo@forseti.local`,
`lead@forseti.local`, `owner@forseti.local`, `reviewer@forseti.local`, and
`auditor@forseti.local`; they use the operator-provided password for newly created
accounts. Existing account passwords are not reset by rerunning the seed.

The seed upserts demo records, resets demo memberships, and rewrites demo link
tables. It is not a backup/restore tool or a migration. Never run `db:reset` or
`seed` against work you want to preserve.

## Deployment verification

Use a disposable preview database for checks that write records:

- Confirm anonymous pages and APIs require sign-in as intended.
- Create an account and organisation, then verify the reference initializer targets only it.
- Sign in, sign out, and sign in again; verify organisation selection persists.
- Test any configured OAuth provider's full callback flow.
- Create/edit a system, refresh, and verify persisted fields remain.
- Test a viewer account and a second organisation for permission/tenant boundaries.
- Upload representative evidence under the 4 MB total batch limit and inspect its preview.
- Verify preview-only actions are clearly labelled; public sharing is unavailable.
- Check deployment logs and configured retention/Redis behaviour without exposing secrets.

Full browser authentication, live Neon compatibility, provider callbacks, Vercel
upload behaviour, and actual scheduler execution remain deployment-validation
requirements. Local builds and unit tests are distinct evidence.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing variable error | Required variables are set in the correct Vercel environment; redeploy after edits. |
| Invalid origin or missing login cookie | Application origin and OAuth callbacks match the browser URL. Do not configure localhost on Vercel. |
| No standard in scope | Run the reference initializer explicitly for the existing organisation's exact slug. |
| Missing relation/column | Schema initialization was explicitly performed against this deployment's database. Do not run a migration until the target is verified. |
| Preview-only changes disappear | This is a documented workflow limitation, not a failed database save. |
| Upload returns 413 | Keep the whole multipart batch below 4 MB of file data; use smaller batches. |
| Cron returns 503 | Retention is disabled because `CRON_SECRET` is absent. Enable only after reviewing its destructive behaviour. |
