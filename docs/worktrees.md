# Worktrees

One trunk, and a checkout per thread of work. The clone at
`OneDrive/Documents/AI/forseti` is `main` — reviews, hotfixes and migrations
happen there and nowhere else. Everything with a branch name gets its own
directory.

```
<OneDrive>\Documents\AI\forseti\      main — trunk, reviews, migrations
%USERPROFILE%\code\forseti-wt\wt-1\   a thread
%USERPROFILE%\code\forseti-wt\wt-2\   another
```

The worktree root is derived from `%USERPROFILE%`, not written down, so the
script is not one machine committed to the repo. Set `FORSETI_WT_ROOT` to put
them on another disk.

## Why the worktrees are not next to the clone

A worktree does not have to be a sibling. Its `.git` is a one-line pointer back
into `…\forseti\.git\worktrees\<name>\`, a few kilobytes, so the repository and
all its history stay in OneDrive and stay backed up.

What moves out is the regenerable part. Each worktree carries its own
`node_modules` (~880MB) and `.next` (~590MB), because neither is shareable
between checkouts. Two threads inside the synced folder would hand OneDrive
about 4GB of build output to replicate, and OneDrive holding a lock on a file
part-way through `npm ci` or `next build` fails as an unexplained IO error
rather than as anything naming OneDrive. Keeping the output outside the synced
tree removes the whole class.

One thing to set once, on the clone: right-click the `forseti` folder →
**Always keep on this device**. If Files On-Demand ever turns tracked files into
placeholders, builds fail the same opaque way.

## Starting one

```powershell
.\scripts\new-worktree.ps1 -Name wt-1 -Branch feat/whatever
```

`git worktree add` alone gives you tracked files and nothing else, which is not
enough to boot. The script also supplies the three untracked things this repo
needs, each of which fails without naming itself:

- **`.env.local`** — copied from the clone. Without `DATABASE_URL` and
  `BETTER_AUTH_SECRET` the app throws at *import*, several layers from the cause.
- **`BETTER_AUTH_URL`** — rewritten to the worktree's own port. A worktree served
  on `:3001` while better-auth believes it lives on `:3000` breaks cookies and
  OAuth callbacks, and presents as an auth bug rather than a config one.
- **`node_modules`** — `npm ci`, per worktree.

`.claude/settings.local.json` comes across too, so permission grants don't need
re-approving per checkout.

**Ports follow the name.** `wt-1` → 3001, `wt-2` → 3002; a name with no digit in
it has to pass `-Port`. Then `npm run dev -- -p 3001`.

## One database, many worktrees

Every worktree inherits the same `DATABASE_URL`, and `docker-compose.yml` pins
`container_name: forseti-postgres` on port 5432 — so there is exactly one local
Postgres, and all of them share it.

**Run `db:migrate`, `db:reset` and `seed` from the main clone only.** Two
worktrees migrating concurrently corrupt each other's expectations, and
`_journal.json` conflicts between branches are worse than the merge conflict
they look like. A branch that adds a migration applies it from `main` after it
lands, not from the worktree that wrote it.

If a thread ever needs true isolation, a Neon branch per worktree is the clean
answer — a second local container on a second port is not, because the compose
file names one.

## Finishing one

```powershell
$wt = "$env:USERPROFILE\code\forseti-wt\wt-1"
git -C $wt push -u origin feat/whatever
# open the PR, let CI go green, merge it
git worktree remove $wt
git branch -d feat/whatever
git worktree prune
```

`git branch -d` is lowercase on purpose: it is incapable of deleting an unmerged
branch, so a refusal is information, not an obstacle. Reaching for `-D` at that
prompt is how work gets thrown away.

`git worktree remove` refuses if the checkout is dirty. That is also the point —
check what is uncommitted before adding `--force`.

It also, on Windows, cannot unlink `.next` while anything still holds a handle on
it. It reports success anyway and leaves an empty directory, which then collides
with the next `new-worktree.ps1 -Name wt-1`. The script tells the two cases
apart; the fix is `Remove-Item -Recurse -Force <path>`.

## Landing on main

History is linear and stays that way:

```powershell
git checkout main
git pull                      # pull.ff=only globally, so divergence surfaces
git merge --ff-only feat/whatever
```

`--ff-only` refuses rather than quietly writing a merge commit. If it refuses,
the branch needs rebasing onto `main` — from its own worktree, before it lands.

CI (`.github/workflows/ci.yml`) runs lint, tests and the build on every pull
request. With several branches in flight, that run is the only thing that has
actually seen the merged result; the machine that built it was checked out
somewhere else.
