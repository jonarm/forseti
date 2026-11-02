# Workspace components

Shared components for the authenticated workspace pages in `src/app/(app)/`.
Pages load organisation-scoped records through `amsPage()` and pass data and UI
permissions to `WorkspaceProvider`.

- Domain types and calculations: `src/lib/ams/`.
- Data access: `src/lib/ai-store.ts`.
- Server-side authorization: `src/lib/session.ts`.
- UI permission definitions: `src/lib/permissions.ts`.

Persist changes through guarded API routes and refresh server data after success.
Label preview controls according to [current limitations](../../../../docs/known-limitations.md).

See [architecture](../../../../docs/architecture.md),
[workflow](../../../../docs/lifecycle.md), and
[development setup](../../../../README.md#quick-start).
