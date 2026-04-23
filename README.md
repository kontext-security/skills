# Kontext Skills

Skills for Kontext.dev workflows and SDK integration.

## Install

```bash
npx skills add kontext-dev/skills
```

Auto-detects your AI harness (Claude Code, Cursor, Gemini CLI, etc.) and installs to the right location.

## Public Skills

### kontext-sdk

Integrate the Kontext identity control plane into TypeScript applications using `@kontext-dev/js-sdk`.

**Covers**: Server SDK (Express + MCP), Client SDK (auth flows), Vercel AI SDK adapter, React hooks, Cloudflare Agents, and Management API.
**Triggers on**: Imports of `@kontext-dev/js-sdk`, mentions of Kontext SDK, or requests to add identity or credential management to AI agent architectures.

---

### kontext-byoa-setup

Configure Bring your own auth on a confidential Kontext application with a service account.

**Triggers on**: Requests to configure hosted connect for an app that already has its own login, set issuer/JWKS/audience for JWT trust, or create or rotate the BYOA API key.

**Does**: Resolves the application, verifies it is confidential, configures JWT trust for `POST /partner/connect-session`, optionally provisions known integrations like GitHub, and returns the Application ID plus BYOA setup summary.

**Does not**: Retrieve credentials with the server SDK. That should stay a separate skill.

**Usage**: Ask to use `$kontext-byoa-setup` when setting up Bring your own auth through the Management API.

---

### kontext-sdk-credentials

Set up and retrieve server-side integration credentials for a confidential Kontext application.

**Triggers on**: Requests to create or update a confidential app for server-side credential retrieval, attach an existing template integration, ensure a known integration like GitHub, create or update a custom remote integration with authMode oauth, user_token, server_token, or none, or fetch GitHub, Google, or other integration credentials from backend code using clientId, clientSecret, and userId.

**Does**: Uses the service account to set up the app and remote integrations for server SDK retrieval, covers template and custom remote integrations across all server-side `Kontext.require(...)` auth modes, and uses the server SDK flow to retrieve either user-managed or admin-managed shared credentials later.

**Does not**: Configure Bring your own auth or create hosted connect sessions.

**Usage**: Ask to use `$kontext-sdk-credentials` when setting up remote integrations for server SDK credential retrieval or retrieving credentials from the server side.

---

### kontext-token-mode-bootstrap

Bootstrap a public Kontext application for token-mode runtime credential exchange with a service account.

**Triggers on**: Requests to replace hardcoded end-user provider tokens with `kontext.require(integration, token)`, bootstrap a public PKCE app, ensure and attach a user-chosen integration, or write the public client ID into a local env file.

**Does**: Uses the service account to create or reuse a public PKCE app, ensures a generic integration from caller-supplied provider details, attaches it to the app, writes the public client ID into a local env file when asked, and guides the runtime cutover to token mode.

**Does not**: Configure Bring your own auth or confidential `userId` retrieval. Those stay in separate skills.

**Usage**: Ask to use `$kontext-token-mode-bootstrap` when removing hardcoded end-user credentials and moving an app to Kontext token mode.

---

### kontext-go-integrator

Integrate Kontext into Go agents using `github.com/anthropics/anthropic-sdk-go`.

**Covers**: Anthropic Go SDK client creation, Kontext credential resolution, request telemetry, prompt tracking, manual tool dispatcher wrapping with `ObserveTool`, and ToolRunner wrapping with `WrapTools`.
**Triggers on**: Go repos importing `github.com/anthropics/anthropic-sdk-go`, requests to add Kontext to an Anthropic Go agent, or requests to get traces from a Go SDK agent.

**Usage**: Ask to use `$kontext-go-integrator` when adding Kontext to an Anthropic Go SDK agent.
