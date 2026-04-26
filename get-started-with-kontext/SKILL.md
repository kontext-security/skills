---
name: get-started-with-kontext
description: "Set up Kontext for exactly two v1 products: Claude Code on this machine, or a long-running Anthropic Go agent in this repo."
---

# Get Started with Kontext

Ask this first, exactly:

```text
What are you setting up?

1. Claude Code on this machine
2. Long-running Go agent in this repo
```

Do not mention PKCE, public clients, confidential clients, service accounts, org keys, or internal patcher modes in the first prompt.

The browser setup screen owns the product-specific mode choice:

- CLI setup
- Go setup: remove hardcoded provider credentials and add tool-call telemetry
- Go setup: keep existing provider credentials and add tool-call telemetry only

For Go setup, do not ask the user to choose again in chat. The browser handoff must return one of:

- `credential_injection` for "remove hardcoded creds and add telemetry for toolcalls"
- `telemetry_only` for "only add telemetry for toolcalls"

## Claude Code on this machine

V1 supports macOS only.

1. Detect the OS with `uname -s`.
2. If it is not `Darwin`, stop and say:
   `Claude Code setup is macOS-only in Kontext v1.`
3. Install or verify `kontext-cli`:
   - If `kontext` exists in `PATH`, run `kontext --help` and `kontext --version`.
   - Otherwise install with the official Homebrew path:
     `brew install kontext-security/tap/kontext`
4. End by saying:

```text
Kontext CLI is installed.

Start Claude Code through Kontext with:
kontext start --agent claude
```

Do not create aliases, wrapper scripts, or shell rc edits. Do not patch Go code.

## Long-running Go agent in this repo

Use this branch only for Anthropic Go SDK agents that run unattended from a repo.

Explain the local inspection once:

```text
I’m going to inspect this Go repo, print one setup link for you to open, then patch and verify it after the browser setup finishes. I do not read or print secret values.
```

Then run the flow exactly. Do not freehand patch Go code.

### 1. Inspect

Run:

```bash
node <this-skill-dir>/scripts/inspect-go-repo.mjs
```

If the script reports `missing_git_remote` or `unsupported_git_remote`, stop and report that long-running Go setup needs a hosted git remote.

If `supported` is false, continue browser setup only if the user still wants app/provider setup, but do not rewrite code.

Show a concise summary:

```text
Found Anthropic Go SDK usage in:
- <file paths>

Suggested provider:
- <display name>, handle: <handle>
```

### 2. Browser Setup And Local Env Handoff

Run this as a long-running command:

```bash
node <this-skill-dir>/scripts/run-local-setup.mjs
```

Relay the printed setup URL to the user. Do not open the URL yourself. Do not use Playwright, browser-use, computer-use, `open`, or any browser automation for this step unless the user explicitly asks you to drive the browser in that same message. Do not ask the user to copy secrets.

The browser page owns app setup and the Go mode choice. Provider setup is required only when the user chooses credential replacement. Provider setup is skipped when the user chooses telemetry-only, because that mode intentionally preserves the repo's existing Anthropic key path. The browser sends runtime env values plus `setupMode`. The browser must not post to localhost.

Wait until the command exits successfully. It must create:

```text
.env or the repo's existing env file
.kontext-setup-state.json
```

Never print the env file, `KONTEXT_CLIENT_SECRET`, or command output containing secret values.

### 3. Deterministic Go Patch

Run:

```bash
node <this-skill-dir>/scripts/patch-go-anthropic.mjs
```

The patcher owns:

- adding `github.com/kontext-security/kontext-go@v0.3.0`
- adding the env file and `.kontext-setup-state.json` to `.gitignore`
- replacing direct `ANTHROPIC_API_KEY` Anthropic SDK usage only when credential injection is enabled
- preserving existing Anthropic env-key usage when telemetry-only setup is selected
- adding `kontext.Start(...)`
- using the exact selected provider handle when credential injection is enabled
- adding request telemetry
- wrapping the supported tool boundary
- running `gofmt`, `go mod tidy`, and `go test ./...`

If the patcher fails, report the exact unsupported shape. Do not guess another rewrite.

### 4. Verify Runtime Shape

For credential-injection setup, run:

```bash
env -u ANTHROPIC_API_KEY sh -c 'set -a; . "$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(\".kontext-setup-state.json\", \"utf8\")).envFile || \".env\")")"; set +a; go run ./cmd/agent'
```

For telemetry-only setup, keep the repo's existing Anthropic environment available and run:

```bash
sh -c 'set -a; . "$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(\".kontext-setup-state.json\", \"utf8\")).envFile || \".env\")")"; set +a; go run ./cmd/agent'
```

If this command would print sensitive values, stop. Normal agent output is okay; the env file itself must not be printed.

If telemetry-only setup is selected and this Codex process cannot see `ANTHROPIC_API_KEY`, do not rerun browser setup and do not ask the user to switch to credential injection. That is not a setup failure. Report that code patching and tests passed, and that the runtime smoke must be launched from the user's shell where their existing Anthropic key is exported. Give the exact command above without printing any env values.

### Final Response

Final response must include no secrets and must be factual:

```text
Kontext is installed.

Mode: <credential_injection or telemetry_only>
Provider: <selected-provider-handle or none>
Runtime env: <env file from .kontext-setup-state.json>
Files patched:
- <paths>
Tests: passed
Runtime: <credential injection started without ANTHROPIC_API_KEY, or tracing-only started with the repo's existing provider env>
```

## Privacy Rules

- Never print `KONTEXT_CLIENT_SECRET`.
- Never paste env-file contents into the transcript.
- Never commit runtime env files.
- Never ask the user to paste secrets into chat.
- Local env handoff requires the user clicking the explicit finish button in the browser.
