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

Before touching code, explain briefly why the local repo is being inspected:

```text
I’m going to inspect this local Go repo so Kontext can find where provider credentials are used and patch the exact call sites. I only read source files and git metadata; I do not read or print secret values.
```

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
node <this-skill-dir>/scripts/inspect-go-repo.mjs
```

2. If the script reports `missing_git_remote`, stop and ask the user to add a git remote before long-running Go setup.
3. Show a concise pre-patch summary:

```text
I found a supported Anthropic Go setup in:
- <file paths>

I also found these credential references and provider suggestions:
- ANTHROPIC_API_KEY -> Anthropic, handle: anthropic

Kontext will create the runtime app automatically. In the browser, you only need to create or select the provider this agent should use.
```

If `providerSuggestions` contains more than one item, list every suggestion. If it contains no items, say that no credential env vars were found and that the browser will still let the user create/select a provider.

4. Run:

```bash
node <this-skill-dir>/scripts/setup-url.mjs
```

5. Do not open the printed browser URL yourself. Do not use Playwright, browser-use, computer-use, or `open` for this step unless the user explicitly asks you to drive the browser. Show the URL to the user and ask them to open it.
6. Tell the user:

```text
Open this setup URL in your browser:
<browserUrl>

Create or select the suggested provider for this agent, then choose “Use for this agent”.
After provider selection, copy the environment variables from the browser page into your runtime secret store.

When the browser page says setup is complete, come back and say: done.
```

7. Wait for the user to say setup is done, then check setup state for the selected provider handle. Never copy `KONTEXT_CLIENT_SECRET` into the transcript, files, logs, or snapshots.
8. Add the Kontext Go module with:

```bash
go get github.com/kontext-security/kontext-go@v0.2.0
```

9. Patch with the exact selected handle:

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

10. Add `TrackPrompt(...)` only when the prompt variable is obvious.
11. Wrap the existing tool boundary with `ObserveTool(...)` or `WrapTools(...)`.
12. Preserve the existing Anthropic loop and tool semantics.
13. Run:

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
