# Deployment

## Environment

`.env.local` is not deployed — Vercel needs the same variables set in project
settings:

- `DATABASE_URL` (Neon) — throws at import if missing.
- `BETTER_AUTH_SECRET` — throws at import if missing.
- `ANTHROPIC_API_KEY`.
- Upstash Redis, either naming convention: `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` / `KV_REST_API_TOKEN`.

`DATABASE_URL` and `BETTER_AUTH_SECRET` throwing at import is deliberate, so a
misconfiguration fails at startup rather than mid-render.

## `BETTER_AUTH_URL`, and the sign-in failure it causes

**Do not copy `.env.example`'s value into Vercel.** It ships
`BETTER_AUTH_URL=http://localhost:3000`, which is right locally and breaks every
deployment: Better Auth validates the browser's `Origin` header against
`baseURL` plus `trustedOrigins`, so a localhost base URL refuses every sign-in
with `Invalid origin: https://<your deployment>`. The message names the browser's
URL — the one part that is correct — which is why this costs an afternoon.

On Vercel either leave it unset, or set it to a custom production domain.
`auth-origins.ts` resolves the rest:

| Environment | Base URL | Also trusted |
|---|---|---|
| Preview | its own `VERCEL_URL` | branch alias, production domain |
| Production | `BETTER_AUTH_URL`, else `VERCEL_PROJECT_PRODUCTION_URL` | `VERCEL_URL`, branch alias |
| Local | unset — better-auth defaults to localhost:3000 | nothing |

**A preview resolves to itself, ahead of any configured value.** Its hostname is
regenerated every push, so it is the one case that cannot be configured and must
be derived. A localhost value is ignored whenever `VERCEL` is set, because no
deployment is served from localhost and the value therefore cannot have been
meant.

Trusted origins are an explicit list, never `https://*.vercel.app` — that
wildcard would work and would trust every site anyone has ever deployed to
Vercel. `auth-origins.test.ts` pins all of this, including the exact preview
hostname that shipped broken.

## Two domains, one project

`theforseti.ai` is the marketing page. `demo.theforseti.ai` is the product. Both
are attached to this same Vercel project, so both resolve to the same deployment
and the same bundle — nothing but the `Host` header separates them, which is why
the split lives in `src/proxy.ts` rather than in a route. `src/app/page.tsx`
cannot see the hostname before it has already decided what `/` means.

| Request | What happens |
|---|---|
| `theforseti.ai/` | rewritten to `public/landing.html` — the URL stays the bare domain |
| `theforseti.ai/<anything else>` | 308 to `https://demo.theforseti.ai/<same path>` |
| `demo.theforseti.ai/*` | the application, session cookie checked as before |
| a preview, or localhost | the application — the host test is equality, never a substring |

Both hostnames are constants in `proxy.ts`, not environment variables. There is
one of each, both bought on purpose, and a `LANDING_HOST` in the dashboard would
move a routing decision somewhere no reader of that file would look — with an
unset value silently serving the application at the marketing domain.

`/api` is excluded from the matcher and is therefore **not** forwarded from the
marketing host. That exclusion survives the split deliberately: forwarding an
upload would mean proxy buffering the body to decide nothing, and the marketing
page has no reason to call the API. It posts nowhere.

The two hosts share the registrable domain `theforseti.ai`, which makes them
look like they share a session. They do not: Better Auth sets a host-only
cookie — no `Domain` attribute — so the cookie issued at
`demo.theforseti.ai` is never sent to `theforseti.ai`. The marketing page is
served to an anonymous visitor whatever their session, which is what the
landing route wants and why it never reads the cookie at all.

Nothing here adds `theforseti.ai` to `trustedOrigins` deliberately — the
landing page posts nowhere, so the right to act on a tenant's session would
buy it nothing.

**But it is trusted today, and you should know why.** `resolveTrustedOrigins`
unions `VERCEL_PROJECT_PRODUCTION_URL`, and Vercel holds `theforseti.ai` as
this project's production domain. So the marketing host is in the list as a
side effect of that setting, and setting `BETTER_AUTH_URL` does not remove it —
`configuredBaseURL` decides only the first entry. Taking it back out means
either making `demo.theforseti.ai` the production domain in the dashboard, or
filtering `LANDING_HOST` out of `resolveTrustedOrigins` on the grounds that the
app is never served there and so can never legitimately originate a request.
The second is a posture change and belongs in its own commit.

### The sign-in this split broke, and why the code no longer guesses

This shipped and failed in production:
`ERROR [Better Auth]: Invalid origin: https://demo.theforseti.ai`.

`resolveBaseURL` fell back to `VERCEL_PROJECT_PRODUCTION_URL`, which is
`theforseti.ai` — the marketing domain. So `baseURL` was a host that serves one
static page and forwards everything else, while every sign-in arrived from the
application host, and Better Auth refused each one. The message names the
application domain, which is the one part of the arrangement that was right.

The fix is that the code stopped guessing. `deployedAppOrigin` resolves to
`APP_ORIGIN` from `lib/domains.ts` whenever `VERCEL` is set, ahead of the
production-domain fallback, and the same value joins `trustedOrigins`. The
assumption that broke was never written down: before the split, "the project's
production domain" and "where the app answers" were the same string, and
`auth-origins.ts` was written on that. They are different hosts now.

It has to be `baseURL` and not only `trustedOrigins`. `/api` is excluded from
the proxy matcher, so `theforseti.ai/api/auth/callback/<provider>` is *served*
on the marketing host rather than forwarded: with `baseURL` pointing there, an
OAuth callback lands on `theforseti.ai` and sets a host-only cookie on it, and
the redirect afterwards forwards to `demo.theforseti.ai`, where that cookie does
not exist.

**Setting `BETTER_AUTH_URL=https://demo.theforseti.ai` is still worth doing** —
it is the explicit path and it wins over the constant. It is no longer load
bearing, which is the point: an unset variable is now a safety net rather than
an outage.

If `GOOGLE_*` or `MICROSOFT_*` are set, their redirect URIs are
`<BETTER_AUTH_URL>/api/auth/callback/<provider>` and have to be re-registered in
each provider's console against `https://demo.theforseti.ai`.

## Redis is not optional in production

Without it the rate limiter is inert, and an unconfigured deployment is
indistinguishable from a working one until the bill arrives — the guarded routes
return exactly the same responses either way. `rate-limit.ts` logs a warning once
in production for that reason. Verifying it the other way round means exhausting a
real limit, and every one of those requests is a paid Opus call.

## Function duration

A route that calls a model sets `maxDuration = 300`, which needs a plan that
allows a 300-second function. `maxDuration` must always exceed the SDK `timeout`
the prompt module passes, or the platform kills the request before the client can
report a clean timeout. No route sets it today — the AI management system's model
calls are not wired yet — so this is the rule the first one has to follow.

## Migrations

`npm run db:migrate` applies `drizzle/`. A hand-written migration must keep
`_journal.json` ascending by `when` — see the `schema-change` skill for the trap
and its recovery.

## Local database

`docker-compose.yml` provides local Postgres:

```bash
npm run db:up      # start, wait for health
npm run db:reset   # down -v, up, migrate, seed
npm run db:down
```
