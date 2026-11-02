# Architecture

Forseti is a Next.js application with server-rendered pages, API Route Handlers,
and organisation-scoped PostgreSQL storage.

## Code map

| Location | Responsibility |
| --- | --- |
| `src/app/(app)/` | Authenticated pages and workspace UI |
| `src/app/api/` | Authentication and application endpoints |
| `src/lib/session.ts` | Session, active organisation, and permission guards |
| `src/lib/permissions.ts` | Role definitions and effective permissions |
| `src/lib/ai-store.ts` | Organisation-scoped reads and writes |
| `src/lib/ams/` | Domain types, calculations, imports, and exports |
| `src/lib/evidence/` | Document identification and extraction |
| `src/db/` and `drizzle/` | Database schema and migrations |

## Authentication and tenancy

Better Auth manages accounts, sessions, and organisation membership.
`requireOrgContext()` resolves page context; `requireOrgForApi()` resolves API
context. Mutating application routes use `requirePermission()` before processing
input. The proxy checks cookie presence for redirects; it does not authorize requests.

Store accessors receive `organizationId` and scope queries to that organisation.
Domain primary keys and foreign keys include organisation scope, including join
tables. `amsPage()` loads context and workspace data for authenticated pages;
`WorkspaceProvider` supplies records and UI permissions to client components.
Server-side guards enforce access independently of UI controls.

## Permissions

The five roles are `platform_admin`, `governance_lead`, `system_owner`, `reviewer`,
and `auditor`. Reviewer and system-owner permissions are separate. Role overrides
are organisation-scoped and evaluated through `can()` and `uiPermissions()`.
Permission-read failures block protected operations instead of restoring defaults.

Platform administration, Better Auth membership grants, and prohibited grants
are protected from ordinary overrides. Review assignments identify people for
individual review stages; they do not create additional roles. Business contact
records (`ai_person`) are distinct from authenticated user accounts.

## Storage and data flow

Drizzle uses Neon's HTTP driver for hosts ending in `.neon.tech` and the `pg`
wire-protocol driver for other PostgreSQL hosts. Neon's HTTP driver does not
support interactive transactions. Not all multi-step operations are transactional.

`readWorkspace()` combines organisation-scoped accessors and filters relationships
to deleted systems. Use cases link to multiple systems through `ai_use_case_system`.
Risk and oversight overrides live on these links; domain helpers resolve the
baseline and per-system values.

Framework definitions, clause trees, controls, and applicability are stored as
data. Systems, evidence, risks, and other business records belong to the organisation;
applicability decisions are scoped to a framework and control.

## Audit, deletion, and concurrency

Store mutations accept an actor and record audit events. Audit-first operations
can leave a record of an attempted write if the domain write fails. Better Auth
membership changes are audited through plugin hooks after their operations.
Activity events are append-only.

The eight registers support soft deletion and restoration. Workspace reads filter
deleted records and dependent relationships. The retention job purges expired trash
per organisation when configured. Version-checked edits reject stale writes with
HTTP 409; this is not universal transactional protection.

## Derived data and drafting

Readiness, coverage, risk ratings, and confidence are computed from workspace data.
Domain modules own thresholds and status colours; components consume those results.
Active drafting routes generate deterministic suggestions from records and do not
call an AI model. Legacy Anthropic integration remains in the repository.

Evidence upload routes store metadata and extracted text, then discard original
bytes. See [evidence processing](evidence-pipeline.md) for validation and extraction.

## Validation

Vitest suites cover permissions, tenant boundaries, audit behaviour, migrations,
record operations, and document handling. Database suites apply migrations in
in-memory PGlite instances. See [testing](testing.md) and
[current limitations](known-limitations.md) for the limits of this coverage.
