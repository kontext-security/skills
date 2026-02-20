# Graphite CLI Cheatsheet

Use this reference when you need exact `gt` command mappings, high-value flags, or conflict recovery steps.

## Quick setup

- Install CLI:
  - `brew install withgraphite/tap/graphite`
  - `npm install -g @withgraphite/graphite-cli@stable`
- Authenticate:
  - `gt auth --token <token>` (token from `https://app.graphite.com/activate`)
- Initialize repository:
  - `gt init`

## High-frequency workflow commands

- Show stack: `gt log short` (`gt ls`)
- Checkout branch: `gt checkout <branch>` (`gt co <branch>`)
- Create branch + commit from current changes: `gt create -am "message"` (`gt c -am "message"`)
- Amend current branch commit: `gt modify -a` (`gt m -a`)
- Add new commit to current branch: `gt modify --commit -am "message"` (`gt m -cam "message"`)
- Submit stack ancestors to current branch: `gt submit`
- Submit full stack including descendants: `gt submit --stack` (`gt ss`)
- Sync from remote trunk and restack what is conflict-free: `gt sync`
- Restack current stack explicitly: `gt restack`
- Fetch teammate branch/stack: `gt get <branch-or-pr>`
- Track non-Graphite branch: `gt track <branch>`

## Git and Graphite mapping

- `git checkout -b feature` -> `gt create feature`
- `git push` + `gh pr create` -> `gt submit`
- `git commit --amend` in stack workflow -> `gt modify`
- Manual rebasing stack branches -> `gt restack`

## Navigation

- Upstack: `gt up` (`gt u`)
- Downstack: `gt down` (`gt d`)
- Top of stack: `gt top` (`gt t`)
- Bottom of stack: `gt bottom` (`gt b`)
- Trunk checkout shortcut: `gt checkout --trunk`

## Collaboration and safety

- Pull full teammate stack: `gt get <branch>`
- Pull only downstack branches: `gt get --downstack <branch>`
- Freeze branch before building on coworker work: `gt freeze <branch>`
- Unfreeze when editing is needed: `gt unfreeze <branch>`

## Conflict recovery

- Continue interrupted Graphite operation after resolving conflicts:
  - `gt add .`
  - `gt continue` (or `gt continue -a`)
- Abort interrupted Graphite operation:
  - `gt abort`
- Recover from broken tracking metadata:
  - ensure branch is based correctly
  - rerun `gt track` (or `gt track --parent <tracked-parent>`)
  - run `gt restack`

## Useful submit flags

- `gt submit --stack`: include descendants
- `gt submit --update-only`: update only branches that already have PRs
- `gt submit --draft`: open new PRs as draft
- `gt submit --cli`: edit PR metadata in CLI
- `gt submit --web`: edit PR metadata in web UI
- `gt submit --publish`: publish PRs

## Useful sync/get flags

- `gt sync --no-restack`: sync without restacking
- `gt get --remote-upstack`: include remote upstack PR info
- `gt get --unfrozen`: fetch new branches in editable state
- `gt get --force`: overwrite local branches with remote source of truth

## Source docs

- `https://graphite.com/docs/get-started`
- `https://graphite.com/docs/cli-overview`
- `https://graphite.com/docs/cli-quick-start`
- `https://graphite.com/docs/cheatsheet`
- `https://graphite.com/docs/command-reference`
- `https://graphite.com/docs/configure-cli`
- `https://graphite.com/docs/install-the-cli`
- `https://graphite.com/docs/authenticate-with-github-app`
- `https://graphite.com/docs/create-a-pull-request`
- `https://graphite.com/docs/create-stack`
- `https://graphite.com/docs/navigate-stack`
- `https://graphite.com/docs/update-mid-stack-branches`
- `https://graphite.com/docs/sync-with-a-remote-repo`
- `https://graphite.com/docs/restack-branches`
- `https://graphite.com/docs/track-branches`
- `https://graphite.com/docs/collaborate-on-a-stack`
