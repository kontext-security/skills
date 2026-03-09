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

**Does**: Resolves the application, verifies it is confidential, configures JWT trust for `POST /partner/connect-session`, and returns the Application ID plus BYOA setup summary.

**Does not**: Retrieve credentials with the server SDK. That should stay a separate skill.

**Usage**: Ask to use `$kontext-byoa-setup` when setting up Bring your own auth through the Management API.

---

### kontext-sdk-credentials

Retrieve a stored integration credential for a confidential Kontext application and a platform user ID.

**Triggers on**: Requests to fetch GitHub, Google, or other stored integration credentials from a backend using clientId, clientSecret, and userId, or to verify whether a user has already connected an integration.

**Does**: Authenticates the confidential app, exchanges `userId` for an integration-scoped token, and explains clearly when the user still needs to connect the integration first.

**Does not**: Configure Bring your own auth or create hosted connect sessions.

**Usage**: Ask to use `$kontext-sdk-credentials` when retrieving stored credentials from the server side.
