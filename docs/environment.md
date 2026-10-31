# Environment configuration

Configure each deployment independently. Never copy another operator's credentials.
Vercel environment values belong in the intended project's environment settings;
a hosted development shell can use ignored `.env.local` or injected variables.
Changing an environment value requires restarting the app.

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Your Neon or PostgreSQL connection string. Use TLS for remote connections. |
| `BETTER_AUTH_SECRET` | Yes | A unique, random authentication secret, at least 32 random bytes. Generate it in your secure environment, for example `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Required outside Vercel; recommended on production Vercel | Your application's full origin. Vercel previews resolve to their own URL automatically. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Recommended for Internet-facing use | Your Upstash Redis REST endpoint and token for route limits. `KV_REST_API_URL` / `KV_REST_API_TOKEN` are supported aliases. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional pair | Your own Google OAuth application. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Optional pair | Your own Microsoft OAuth application. |
| `CRON_SECRET` | Only if scheduled retention is enabled | Operator-generated bearer token protecting the destructive trash-purge job. Unset means the job refuses to run. |
| `ANTHROPIC_API_KEY` | Not required by current application routes | Retained legacy integration code; active drafts are deterministic and evidence ingest does not invoke a model. |
| `ALLOW_DEMO_SEED`, `DEMO_PASSWORD` | Only for explicit demo seeding | Opt-in flag (`1`) and operator-chosen demo password of at least 12 characters. No default password exists. |

`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, and
`VERCEL_PROJECT_PRODUCTION_URL` are supplied by Vercel. Do not fabricate them on
other platforms. Set `BETTER_AUTH_URL` explicitly there instead.

Never use a localhost `BETTER_AUTH_URL` for an Internet deployment. The URL must
identify the application, not a separate marketing site. Authentication trusts
only the configured application URL and the current deployment's explicit
Vercel origins; it does not automatically trust the original owner's domain.

## PostgreSQL drivers

Hosts ending in `.neon.tech` use Neon's HTTP driver. Other hosts use the standard
PostgreSQL wire protocol. A custom Neon hostname that does not end in `.neon.tech`
therefore selects the wire driver; use a connection string appropriate for it.

For the optional disposable Compose service only:

```text
DATABASE_URL=postgresql://forseti:forseti_local_dev@localhost:5432/forseti
```

Those are committed, local-only development credentials. Never reuse them for
remote or shared infrastructure. All other connection strings must be your own.

## Optional integrations

Social sign-in appears only when both variables for a provider are configured.
Register `<your application origin>/api/auth/callback/google` or
`<your application origin>/api/auth/callback/microsoft` in your provider account.
Email transport and password-recovery flows are not complete; see known limitations.

Redis failures currently allow requests to proceed and log the failure. The rate
limiter is a protective control, not a guaranteed spend or availability boundary.
