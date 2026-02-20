---
name: use-graphite
description: Manage stacked pull request workflows with the Graphite CLI (gt). Use when tasks involve branch and PR operations in a Graphite-initialized repository, including creating branches, submitting PRs, updating mid-stack changes, syncing with trunk, resolving restack conflicts, or collaborating on teammate stacks. In Graphite repos, prefer gt branch/PR commands over git push and gh pr create.
---

# Use Graphite

Run this skill to keep Graphite repositories on the Graphite workflow instead of ad-hoc git/gh PR flows.

## 1. Detect Graphite State First

1. Run `bash scripts/graphite-detect.sh`.
2. If `enabled=true`, use the Graphite workflow below.
3. If `enabled=false`, stop and use standard `git`/`gh` commands.
4. Capture current state:
   - `gt log short`
   - `git status --short`
   - `git branch --show-current`

## 2. Use Graphite Commands for Branch and PR Lifecycle

In Graphite-enabled repositories, prefer:

- `gt create` for creating a new stacked branch + commit.
- `gt modify` for updating branch commits.
- `gt submit` and `gt submit --stack` for PR creation/updates.
- `gt sync` and `gt restack` for syncing and restacking.
- `gt checkout`, `gt up`, `gt down`, `gt top`, `gt bottom` for navigation.
- `gt get`, `gt freeze`, `gt unfreeze` for teammate stacks.

Keep using `git` for inspection/staging workflows such as `git status`, `git diff`, `git add`, and `git stash`.

Avoid replacing Graphite stack operations with raw `git push`, `gh pr create`, or manual rebases unless explicitly requested.

## 3. Execute the Standard Workflow

### Single PR

1. Make code changes.
2. Run project verification locally (tests/lint/typecheck/build as relevant).
3. Stage and create branch+commit with Graphite:
   - `gt create -am "feat: ..."`
4. Submit PR:
   - `gt submit`

### Stacked PRs

1. Implement logical slice 1, verify locally.
2. Create first stacked branch:
   - `gt create -am "feat: part 1"`
3. Repeat for each dependent slice:
   - `gt create -am "feat: part 2"`
   - `gt create -am "feat: part 3"`
4. Submit the stack:
   - `gt submit --stack`

### Address Mid-Stack Feedback

1. Move to target branch:
   - `gt checkout <branch>`
2. Apply fixes.
3. Update commit(s):
   - `gt modify -a` (amend existing commit), or
   - `gt modify --commit -am "fix: ..."` (new commit)
4. Resubmit:
   - `gt submit` or `gt submit --stack`

### Sync With Trunk

1. Run:
   - `gt sync`
2. If sync reports unresolved restacks, run:
   - `gt checkout <branch-with-conflict>`
   - `gt restack`
3. Resolve conflicts, then continue with:
   - `gt add .`
   - `gt continue`
4. If needed, cancel an in-progress rebase:
   - `gt abort`

## 4. Collaborate on Shared Stacks

1. Pull teammate branch/stack:
   - `gt get <branch-or-pr>`
2. Build on top:
   - `gt create -am "feat: ..."`
3. Keep branches in sync:
   - `gt sync`
   - `gt get` for new teammate branches
4. Use frozen branches to avoid accidental edits to teammate branches:
   - `gt freeze <branch>`
   - `gt unfreeze <branch>`

## 5. Recover From Common Issues

- `gt: command not found`: install via `brew install withgraphite/tap/graphite` or `npm install -g @withgraphite/graphite-cli@stable`.
- Not authenticated: run `gt auth --token <token>` (token from `https://app.graphite.com/activate`).
- Branch created outside Graphite: run `gt track` (or `gt track <branch>`).
- Graphite metadata confusion: use `gt track` to repair parent tracking, then `gt restack`.

## References

Load `references/graphite-cli-cheatsheet.md` when command aliases/flags or edge-case behavior is needed.
