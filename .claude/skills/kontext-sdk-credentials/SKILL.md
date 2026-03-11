---
name: kontext-sdk-credentials
description: Configure and retrieve server-side integration credentials for a confidential Kontext application. Use when asked to create or update a confidential app for server SDK retrieval, attach an existing integration, create or update a custom remote integration with authMode oauth, user_token, server_token, or none, ensure a known template like GitHub, or implement TypeScript code that calls Kontext.require(...) with clientId, clientSecret, and userId. Do not use this skill to configure Bring your own auth or create hosted connect sessions.
---

# Kontext Server Credential Lifecycle

Use this skill when the work is about the **server-side credential retrieval** flow built around `Kontext.require(...)`.

This skill covers the full remote integration lifecycle for that flow:
- create or resolve a **confidential** application used by the server SDK
- attach an existing integration to that application
- create or update a custom remote integration with auth mode:
  - `oauth`
  - `user_token`
  - `server_token`
  - `none`
- ensure a known integration recipe when the exact canonical config is known, for example `github`
- implement TypeScript with the Management SDK for setup and the Server SDK for runtime retrieval
- explain whether the next action belongs to an admin or an end user

This skill does **not** cover:
- Bring your own auth or external auth
- issuer, JWKS, audience, partner API keys, or avoiding double auth
- hosted connect session creation

If the user wants to trust their own auth system and skip double auth, use `kontext-byoa-setup` instead.

## Scope boundary

This skill is about remote integrations that use `Kontext.require(...)`.

That means:
- `oauth`, `user_token`, and `server_token` are fully in scope
- `none` is in scope for app attachment and config updates, but there is no runtime credential to retrieve

Keep `internal_mcp_credentials` out of this skill unless the user explicitly asks for that separate `requireCredentials(...)` flow.

## What this feature is

The same server-side retrieval call can return three practical credential models:
- a user OAuth credential the user connected earlier
- a user-managed API key or PAT from a `user_token` integration
- an admin-managed shared server token from a `server_token` integration

The runtime retrieval call uses:
- the app's **OAuth Client ID**
- the app's **OAuth Client Secret**
- the platform's own stable **userId**

In TypeScript:

```ts
import { Kontext } from "@kontext-dev/js-sdk/server";

const kontext = new Kontext({
  clientId: process.env.KONTEXT_CLIENT_ID!,
  clientSecret: process.env.KONTEXT_CLIENT_SECRET!,
});

const credential = await kontext.require("github", {
  userId: "platform-user-123",
});
```

Behavior by auth mode:
- `oauth`: end user must connect first, then `Kontext.require(...)` returns that user's OAuth credential
- `user_token`: end user must save their own API key or PAT first, then `Kontext.require(...)` returns that user's bearer token
- `server_token`: admin sets one shared token, then every end user of attached apps can retrieve it immediately with the same `Kontext.require(...)` call
- `none`: there is nothing to retrieve with `Kontext.require(...)`

Important: this skill is about **credential setup and retrieval**. It is not the place to teach BYOA JWT trust or hosted connect bootstrap.

## Required inputs

For **admin setup** with a service account:
- `KONTEXT_API_BASE_URL` (optional, defaults to `https://api.kontext.dev`)
- `MANAGEMENT_API_RESOURCE` (optional, defaults to `${KONTEXT_API_BASE_URL}/api/v1`)
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_ID`
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET`
- `KONTEXT_APPLICATION_ID`, or `KONTEXT_APPLICATION_NAME`

Optional application setup:
- `KONTEXT_CREATE_APPLICATION=true`
- `KONTEXT_APPLICATION_REDIRECT_URIS_JSON`

Target integration selection:
- `KONTEXT_INTEGRATION_ID`, or `KONTEXT_INTEGRATION_NAME`
- `KONTEXT_KNOWN_INTEGRATION`

Optional integration mutation:
- `KONTEXT_INTEGRATION_URL`
- `KONTEXT_INTEGRATION_AUTH_MODE`
- `KONTEXT_INTEGRATION_OAUTH_PROVIDER`
- `KONTEXT_INTEGRATION_OAUTH_ISSUER`
- `KONTEXT_INTEGRATION_OAUTH_SCOPES_JSON`
- `KONTEXT_SERVER_TOKEN`
- `KONTEXT_VALIDATE_INTEGRATION=true`

For **runtime retrieval**:
- `KONTEXT_API_BASE_URL` (optional, defaults to `https://api.kontext.dev`)
- `KONTEXT_CLIENT_ID`
- `KONTEXT_CLIENT_SECRET`
- `KONTEXT_INTEGRATION`
- `PLATFORM_USER_ID`

Optional:
- `KONTEXT_SHOW_TOKEN=true`

## Secret handling rules

Follow these rules strictly:

- Never print `KONTEXT_CLIENT_SECRET` unless the user explicitly asks.
- Never print `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET` unless the user explicitly asks.
- Never print `KONTEXT_SERVER_TOKEN` unless the user explicitly asks.
- Never write secrets or live tokens to tracked files.
- Never commit secrets or live tokens.
- By default, do not print the full retrieved access token unless the user explicitly asks for it.
- If retrieval fails because the user has not connected the integration yet, explain that plainly instead of retrying blindly.
- If retrieval fails because the shared server token is missing or broken, say that an admin must update the integration configuration.

## Workflow

1. Decide whether the user needs:
   - admin setup
   - runtime retrieval
   - or both
2. For admin setup, run the bundled setup helper:

```bash
node scripts/manage-credential-integration.mjs
```

3. For runtime retrieval, run the bundled retrieval helper:

```bash
node scripts/require-credential.mjs
```

4. If setup is about an existing integration:
   - resolve it by exact ID or exact name
   - attach it to the app
   - if mutation inputs are present, update that integration before attachment
5. If setup is about a known template integration:
   - use `KONTEXT_KNOWN_INTEGRATION` when the skill has an exact recipe, for example `github`
   - do not invent recipe values for unknown templates
6. If setup is about a custom remote integration:
   - create it when missing
   - otherwise patch it with the supplied auth-mode-specific fields
7. If runtime retrieval fails with `integration_required`:
   - for `oauth` or `user_token`, tell the user the end user still needs to connect that integration
   - for `server_token`, tell the user to verify the app knows that platform user and the integration is attached
8. If runtime retrieval fails with `invalid_target` mentioning the shared server token:
   - tell the user an admin must update the shared token
9. Summarize the result.

## Preferred command pattern

Create a confidential app if it does not exist yet:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_NAME="My Server App" \
KONTEXT_CREATE_APPLICATION=true \
KONTEXT_APPLICATION_REDIRECT_URIS_JSON='["http://localhost:3000/callback"]' \
node scripts/manage-credential-integration.mjs
```

Attach an existing integration to an app:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="github" \
node scripts/manage-credential-integration.mjs
```

Ensure the known GitHub integration and attach it:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_KNOWN_INTEGRATION=github \
node scripts/manage-credential-integration.mjs
```

Create or update a custom OAuth integration:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="Linear" \
KONTEXT_INTEGRATION_URL="https://mcp.linear.app/sse" \
KONTEXT_INTEGRATION_AUTH_MODE=oauth \
node scripts/manage-credential-integration.mjs
```

Create or update a custom per-user PAT integration:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="My API" \
KONTEXT_INTEGRATION_URL="https://mcp.example.com" \
KONTEXT_INTEGRATION_AUTH_MODE=user_token \
node scripts/manage-credential-integration.mjs
```

Create or update a custom shared-token integration:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="Zapier Notion" \
KONTEXT_INTEGRATION_URL="https://mcp.example.com" \
KONTEXT_INTEGRATION_AUTH_MODE=server_token \
KONTEXT_SERVER_TOKEN=... \
node scripts/manage-credential-integration.mjs
```

Create or update a remote integration with no credential exchange:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="DeepWiki" \
KONTEXT_INTEGRATION_URL="https://mcp.deepwiki.com/mcp" \
KONTEXT_INTEGRATION_AUTH_MODE=none \
node scripts/manage-credential-integration.mjs
```

Retrieve a credential later from the server side:

```bash
KONTEXT_API_BASE_URL=https://api.kontext.dev \
KONTEXT_CLIENT_ID=app_... \
KONTEXT_CLIENT_SECRET=app_secret_... \
KONTEXT_INTEGRATION=github \
PLATFORM_USER_ID=platform-user-123 \
node scripts/require-credential.mjs
```

If the raw token is explicitly needed:

```bash
KONTEXT_SHOW_TOKEN=true node scripts/require-credential.mjs --json
```

## Exact TypeScript SDK shapes

Create a confidential app with the Management SDK:

```ts
import { KontextManagementClient } from "@kontext-dev/js-sdk/management";

const management = new KontextManagementClient({
  baseUrl: process.env.KONTEXT_API_BASE_URL ?? "https://api.kontext.dev",
  credentials: {
    clientId: process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_ID!,
    clientSecret: process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET!,
  },
});

const { application, oauth } = await management.applications.create({
  name: "My Server App",
  oauth: {
    type: "confidential",
    redirectUris: ["http://localhost:3000/callback"],
  },
});
```

Create a custom OAuth integration:

```ts
const { integration } = await management.integrations.create({
  name: "Linear",
  url: "https://mcp.linear.app/sse",
  authMode: "oauth",
});

await management.applications.attachIntegration(application.id, integration.id);
```

Create a custom per-user PAT integration:

```ts
const { integration } = await management.integrations.create({
  name: "My API",
  url: "https://mcp.example.com",
  authMode: "user_token",
});

await management.applications.attachIntegration(application.id, integration.id);
```

Create a custom shared-token integration:

```ts
const { integration } = await management.integrations.create({
  name: "Zapier Notion",
  url: "https://mcp.example.com",
  authMode: "server_token",
  serverToken: process.env.KONTEXT_SERVER_TOKEN!,
});

await management.applications.attachIntegration(application.id, integration.id);
```

Create a remote integration with no credential exchange:

```ts
const { integration } = await management.integrations.create({
  name: "DeepWiki",
  url: "https://mcp.deepwiki.com/mcp",
  authMode: "none",
});

await management.applications.attachIntegration(application.id, integration.id);
```

Update an existing integration:

```ts
await management.integrations.update("int_123", {
  authMode: "server_token",
  serverToken: process.env.KONTEXT_SERVER_TOKEN!,
});
```

Attach an existing integration by lookup:

```ts
const integrations = await management.integrations.list();
const github = integrations.items.find((item) => item.name === "github");

if (!github) {
  throw new Error("GitHub integration not found");
}

await management.applications.attachIntegration(application.id, github.id);
```

Retrieve runtime credentials with the Server SDK:

```ts
import { Kontext } from "@kontext-dev/js-sdk/server";

const kontext = new Kontext({
  clientId: process.env.KONTEXT_CLIENT_ID!,
  clientSecret: process.env.KONTEXT_CLIENT_SECRET!,
});

const credential = await kontext.require("github", {
  userId: platformUserId,
});

const response = await fetch("https://api.github.com/user", {
  headers: {
    Authorization: credential.authorization,
  },
});
```

Runtime notes:
- `oauth`: retrieval works after the user authorizes the integration
- `user_token`: retrieval works after the user stores their PAT or API key
- `server_token`: retrieval works immediately for all end users of attached apps after the admin sets the token
- `none`: do not call `Kontext.require(...)` because there is no credential to exchange

## Notes for the agent

- Use straightforward language.
- Keep the skill scoped to server-side credential retrieval and the admin setup needed to make that retrieval work.
- Do not drift into BYOA, external-auth trust, or hosted connect session bootstrap.
- For known integrations, only use exact recipes the skill actually knows.
- For existing integrations, prefer exact ID lookup when changing auth mode or renaming.
- If `authMode` changes, the backend hard-cuts over and clears old per-user connections.
- If `server_token` is misconfigured, that is an admin problem, not an end-user problem.
- In user-facing text, call `PLATFORM_USER_ID` the platform's own user ID.

## Success output

Return a short summary in this shape:

Server credential integration configured.

Application:
- Name: <application name>
- Application ID: <application id>
- Client ID: <client id>

Integration:
- Name: <integration name>
- Integration ID: <integration id>
- Auth mode: <auth mode>
- App attachment: <attached_now or already_attached>

Runtime:
- Retrieval method: <Kontext.require or not applicable>
- End-user action: <required or not required>

Only show secrets or raw access tokens if the user explicitly asked for them.
