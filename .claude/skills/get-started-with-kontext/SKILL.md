---
name: get-started-with-kontext
description: Set up Kontext for exactly two v1 products: Claude Code on this machine, or a long-running Anthropic Go agent in this repo.
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

### Supported rewrite shapes

- `github.com/anthropics/anthropic-sdk-go` client construction in application code
- direct Anthropic credential configuration such as `option.WithAPIKey(...)`
- `ANTHROPIC_API_KEY` environment-key usage
- existing Kontext Go examples using `ProviderAnthropic`

### Unsupported rewrite shapes

- custom raw HTTP clients for Anthropic
- non-Anthropic LLM clients
- multi-provider abstraction layers
- vendored code
- generated code
- tests, unless they are explicit integration fixtures

If unsupported, still complete browser setup and provider attachment, but do not rewrite code. Report what you found and why rewriting stopped.

### Setup flow

1. Run:

```bash
node .claude/skills/get-started-with-kontext/scripts/inspect-go-repo.mjs
```

2. If the script reports `missing_git_remote`, stop and ask the user to add a git remote before long-running Go setup.
3. Show a concise pre-patch summary:

```text
I found a supported Anthropic Go setup.

Planned changes:
1. Add confidential Kontext config loading.
2. Replace direct Anthropic API-key credentials with provider handle targeting.
3. Preserve request telemetry and ObserveTool usage.
4. Run gofmt, go mod tidy, and go test ./...
```

4. Run:

```bash
node .claude/skills/get-started-with-kontext/scripts/setup-url.mjs
```

5. Open the printed browser URL. The browser page handles login, runtime app create/repair, provider selection, provider attach, and one-time secret reveal.
6. Tell the user:

```text
Browser setup is open. Create or select the custom provider this agent should use, then choose “Use for this agent”.
Copy the environment variables from the browser page into the runtime environment for your Go agent.
```

7. Wait until setup state reports a selected provider handle. Never copy `KONTEXT_CLIENT_SECRET` into the transcript, files, logs, or snapshots.
8. Patch with the exact selected handle:

```go
kx, err := kontext.Start(ctx, kontext.Config{
    ServiceName: "...",
    Environment: "...",
    ClientID: os.Getenv("KONTEXT_CLIENT_ID"),
    ClientSecret: os.Getenv("KONTEXT_CLIENT_SECRET"),
    URL: os.Getenv("KONTEXT_URL"),
    Credentials: kontext.CredentialsConfig{
        Mode: kontext.CredentialModeProvide,
        Providers: []kontext.Provider{"<selected-provider-handle>"},
    },
})

client := anthropic.NewClient(
    kxanthropic.WithCredentialsFor(kx, "<selected-provider-handle>"),
    kxanthropic.WithRequestTelemetry(kx),
)
```

9. Add `TrackPrompt(...)` only when the prompt variable is obvious.
10. Wrap the existing tool boundary with `ObserveTool(...)` or `WrapTools(...)`.
11. Preserve the existing Anthropic loop and tool semantics.
12. Run:

```bash
gofmt -w <changed-go-files>
go mod tidy
go test ./...
```

Final response must include no secrets and must include:

```text
Configured:
- Runtime app: created/repaired
- Provider: <provider-handle>
- Go files patched: N
- Tests: passed/failed/skipped

Next:
1. Copy the environment variables from the browser setup page.
2. Start your Go agent with those variables set.
3. Do not set ANTHROPIC_API_KEY for this flow.
```

## Privacy rules

- Never run commands that print `KONTEXT_CLIENT_SECRET`.
- Never write `KONTEXT_CLIENT_SECRET` into generated files.
- Never include `KONTEXT_CLIENT_SECRET` in test snapshots.
- Never echo runtime secrets in the agent transcript.
- Secret rotation is an explicit browser action only.
