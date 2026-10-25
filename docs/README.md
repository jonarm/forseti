# Forseti documentation

`CLAUDE.md` holds the laws — one line each, no rationale. These files hold the
reasons. Procedures live in `.claude/skills/`.

The AI management system's own screens are documented next to their components
rather than here: that file is read while looking at the code it describes,
which is the whole argument for co-location.

| Read before | File |
| --- | --- |
| Changing any AI management system screen | [`src/app/(app)/_ams/README.md`](../src/app/%28app%29/_ams/README.md) |
| Changing the tenant boundary, auth, or framework scoping | [`architecture.md`](architecture.md) |
| Working on any stage of the AI lifecycle, or planning what to build next | [`lifecycle.md`](lifecycle.md) |
| Touching `src/lib/evidence/` or the upload route | [`evidence-pipeline.md`](evidence-pipeline.md) |
| Writing or changing tests | [`testing.md`](testing.md) |
| Deploying, or changing env requirements | [`deployment.md`](deployment.md) |
| Starting parallel work, or adding a git worktree | [`worktrees.md`](worktrees.md) |
| Choosing a model, an advisor or a sub-agent | [`model-strategy.md`](model-strategy.md) |

## Decisions

There are none open, and `decisions/` is currently empty — ADR-001 recorded the
GDPR toolkit's assessment-invalidation problem and retired with the toolkit.
Recreate the directory for the next choice that is **contested, dated, or
supersedes an earlier one**; those are the cases prose co-location handles badly.
Settled rules stay next to what they govern, in the files above, so you read them
when you open the thing they constrain. Do not migrate those here.

## Keeping these honest

A change that invalidates a doc updates it in the same commit. These files
describe the code as it is; the README spent several weeks claiming this was a
single-tenant app with no auth and a JSON-file store, which is how a stale doc
becomes worse than no doc.
