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

## Claude Code on this machine

V1 supports macOS only.

1. Detect the OS with `uname -s`.
2. If it is not `Darwin`, stop and say:
   `Claude Code setup is macOS-only in Kontext v1.`
3. Install or verify `kontext-cli`:
   - If `kontext` exists in `PATH`, run `kontext --help` or `kontext version` if supported.
   - Otherwise install with the official Homebrew path:
     `brew install kontext-security/tap/kontext`
4. End by running, or instructing the user to run:

```bash
kontext start --agent claude
```

Do not patch Go code. Do not install aliases. Do not edit shell rc files.

## Long-running Go agent in this repo

Use this branch only for Anthropic Go SDK agents that run unattended from a repo.

Explain the local inspection once:

```text
I’m going to inspect this Go repo, open one browser setup link, then patch and verify it automatically. I do not read or print secret values.
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

Relay the printed setup URL to the user. Do not ask them to copy secrets. The browser page owns provider creation/selection and sends `.env.kontext` back to the local receiver after the user clicks the finish button.

Wait until the command exits successfully. It must create:

```text
.env.kontext
.kontext-setup-state.json
```

Never print `.env.kontext`, `KONTEXT_CLIENT_SECRET`, or command output containing secret values.

### 3. Deterministic Go Patch

Run:

```bash
node <this-skill-dir>/scripts/patch-go-anthropic.mjs
```

The patcher owns:

- adding `github.com/kontext-security/kontext-go@v0.2.0`
- adding `.env`, `.env.*`, and `.kontext-setup-state.json` to `.gitignore`
- replacing direct Anthropic env-key usage
- adding `kontext.Start(...)`
- using the exact selected provider handle
- adding request telemetry
- wrapping the supported tool boundary
- running `gofmt`, `go mod tidy`, and `go test ./...`

If the patcher fails, report the exact unsupported shape. Do not guess another rewrite.

### 4. Verify Runtime Shape

Run:

```bash
env -u ANTHROPIC_API_KEY sh -c 'set -a; . ./.env.kontext; set +a; go run ./cmd/agent'
```

If this command would print sensitive values, stop. Normal agent output is okay; the env file itself must not be printed.

### Final Response

Final response must include no secrets and must be factual:

```text
Kontext is installed.

Provider: <selected-provider-handle>
Runtime env: .env.kontext
Files patched:
- <paths>
Tests: passed
Runtime: started without ANTHROPIC_API_KEY
```

## Privacy Rules

- Never print `KONTEXT_CLIENT_SECRET`.
- Never paste `.env.kontext` into the transcript.
- Never commit `.env.kontext`.
- Never ask the user to paste secrets into chat.
- Browser-to-local env handoff requires the user clicking the explicit finish button.
