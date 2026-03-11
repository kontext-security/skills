---
name: kontext-sdk-credentials
description: Set up and retrieve server-side integration credentials for a confidential Kontext application. Use when asked to create or update an app for server SDK retrieval, attach an existing integration, create or update a custom shared-token integration with a service account, or implement TypeScript code that calls Kontext.require(...) with clientId, clientSecret, and userId. Do not use this skill to configure Bring your own auth or create hosted connect sessions.
---

# Kontext Server Credential Setup and Retrieval

Use this skill when the work is about **server-side credential retrieval** for a **confidential** Kontext application.

This skill covers two adjacent workflows:
- **admin setup with a service account** so the app and integrations are ready
- **server SDK retrieval** with `Kontext.require(...)`

This skill covers:
- creating or resolving a confidential application used by the server SDK
- attaching an existing integration to that app
- creating or updating a custom integration with `authMode: "server_token"`
- rotating the shared server token on that custom integration
- implementing server-side TypeScript that retrieves the credential later with `Kontext.require(...)`
- explaining clearly whether the next action belongs to an admin or an end user

This skill does **not** cover:
- configuring Bring your own auth or external auth
- setting issuer, JWKS, audience, or partner API keys
- creating hosted connect sessions

If the user wants to trust their own auth system and avoid double auth, use `kontext-byoa-setup` instead. Keep that skill separate.

## What this feature is

Server-side credential retrieval can use two credential models:
- a user-managed credential the user connected earlier, for example OAuth or user API key
- an admin-managed shared server token that is already available to every end user of the attached app

The runtime retrieval call is:
- the app's **OAuth Client ID**
- the app's **OAuth Client Secret**
- the platform's own stable **userId**

The admin setup side uses:
- a **service account** for the Management API
- the target **application**
- either an existing integration to attach or a custom integration to create/update
- an optional **shared server token** for `server_token` mode

The backend later retrieves the credential with:
- the app's **OAuth Client ID**
- the app's **OAuth Client Secret**
- the platform's own stable **userId**

In the server SDK, that looks like:

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

What changes with shared server tokens:
- end users do not connect anything for that integration
- the same `kontext.require(...)` call returns the shared token directly
- `expires_in` may be omitted, which is expected for shared admin-managed tokens

Important: this skill is about **credential setup and retrieval**. It is not the right place to teach BYOA JWT trust or hosted connect bootstrap.

## Required inputs

For **admin setup** with a service account, read these from the environment:
- `KONTEXT_API_BASE_URL` (optional, defaults to `https://api.kontext.dev`)
- `MANAGEMENT_API_RESOURCE` (optional, defaults to `${KONTEXT_API_BASE_URL}/api/v1`)
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_ID`
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET`
- `KONTEXT_APPLICATION_ID`, or `KONTEXT_APPLICATION_NAME`

Optional app setup inputs:
- `KONTEXT_CREATE_APPLICATION=true`
- `KONTEXT_APPLICATION_REDIRECT_URIS_JSON`

Attach an existing integration:
- `KONTEXT_INTEGRATION_ID`, or `KONTEXT_INTEGRATION_NAME`

Create or update a custom shared-token integration:
- `KONTEXT_CUSTOM_INTEGRATION_NAME`
- `KONTEXT_CUSTOM_INTEGRATION_URL`
- `KONTEXT_SERVER_TOKEN`

Optional setup flags:
- `KONTEXT_VALIDATE_INTEGRATION=true`

For **server-side retrieval**, read these from the environment:
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
- Never write client secrets or returned access tokens to tracked files.
- Never commit secrets or live tokens.
- Never print `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET` unless the user explicitly asks.
- Never print a shared `KONTEXT_SERVER_TOKEN` unless the user explicitly asks.
- By default, do not print the full retrieved access token unless the user explicitly asks for it or the command is being piped directly into another local process.
- If retrieval fails because the user has not connected the integration yet, explain that plainly instead of retrying blindly.
- If retrieval fails because the shared server token is missing or broken, say that an admin must update the integration configuration.

## Workflow

1. Decide whether the user needs:
   - admin setup
   - server-side retrieval
   - or both
2. For admin setup, run the bundled setup helper:

```bash
node scripts/manage-shared-integration.mjs
```

3. For server-side retrieval, run the bundled retrieval helper:

```bash
node scripts/require-credential.mjs
```

4. If setup is about an existing integration:
   - resolve it by exact ID or exact name
   - attach it to the app
   - do not pretend there is a separate “template integration” API primitive if the job is really just attaching an existing integration
5. If setup is about a custom shared-token integration:
   - create it when missing
   - otherwise patch it with `authMode: "server_token"` and the new `serverToken`
   - attach it to the app
6. If the retrieval helper reports that the integration is not connected:
   - for user-managed integrations, tell the user the platform user still needs to connect that integration first
   - if the integration is supposed to use a shared server token, tell the user to verify the platform user exists in the app and that the integration is attached
   - do not mix in BYOA setup unless they ask
7. If the retrieval helper reports that the shared server token is misconfigured:
   - tell the user an admin needs to update the shared server token
   - do not mix in BYOA setup unless they ask
8. Summarize the result.

## Preferred command pattern

Create a confidential app if it does not exist yet:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_NAME="My Server App" \
KONTEXT_CREATE_APPLICATION=true \
KONTEXT_APPLICATION_REDIRECT_URIS_JSON='["http://localhost:3000/callback"]' \
node scripts/manage-shared-integration.mjs
```

Attach an existing integration to an app:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_NAME="GitHub" \
node scripts/manage-shared-integration.mjs
```

Create or update a custom shared-token integration and attach it:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_CUSTOM_INTEGRATION_NAME="Zapier Notion" \
KONTEXT_CUSTOM_INTEGRATION_URL="https://mcp.example.com" \
KONTEXT_SERVER_TOKEN=... \
node scripts/manage-shared-integration.mjs
```

Retrieve the credential later from the server side:

```bash
KONTEXT_API_BASE_URL=http://localhost:4000 \
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

Use the Management SDK for app and integration setup:

```ts
import { KontextManagementClient } from "@kontext-dev/js-sdk/management";

const management = new KontextManagementClient({
  baseUrl: process.env.KONTEXT_API_BASE_URL ?? "https://api.kontext.dev",
  credentials: {
    clientId: process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_ID!,
    clientSecret: process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET!,
  },
});

const { integration } = await management.integrations.create({
  name: "Zapier Notion",
  url: "https://mcp.example.com",
  authMode: "server_token",
  serverToken: process.env.KONTEXT_SERVER_TOKEN!,
});

await management.applications.attachIntegration("app_123", integration.id);
```

Update an existing integration to shared-token mode:

```ts
await management.integrations.update("int_123", {
  authMode: "server_token",
  serverToken: process.env.KONTEXT_SERVER_TOKEN!,
});
```

Use the server SDK for runtime retrieval:

```ts
import { Kontext } from "@kontext-dev/js-sdk/server";

const kontext = new Kontext({
  clientId: process.env.KONTEXT_CLIENT_ID!,
  clientSecret: process.env.KONTEXT_CLIENT_SECRET!,
});

const credential = await kontext.require("Zapier Notion", {
  userId: platformUserId,
});

const response = await fetch("https://upstream.example.com/api", {
  headers: {
    Authorization: credential.authorization,
  },
});
```

## Notes for the agent

- Use straightforward language.
- In user-facing text, call `PLATFORM_USER_ID` the platform's own user ID.
- Do not tell the user to store a Kontext internal user ID.
- Keep BYOA out of scope unless the user explicitly asks about trusting their own auth or avoiding double auth.
- A “template integration” here usually means an existing integration you can resolve and attach. Do not invent a special template API.
- For confidential app creation, use `oauth.type = "confidential"` and at least one redirect URI.
- For custom shared-token integrations, use `authMode: "server_token"` and `serverToken`.
- If retrieval fails with an `integration_required` style error, do not assume it is always a user-connect problem. Shared-token integrations can also fail here when the app does not know that platform user yet.
- If retrieval fails with an `invalid_target` error mentioning the shared server token, tell the user this is an admin configuration issue, not an end-user action.
- Do not drift into BYOA setup in this skill.

## Success output

Return a short summary in this shape:

Credential retrieved.

Application auth:
- OAuth Client ID: <client id>

Request:
- Integration: <integration>
- Platform user ID: <user id>

Result:
- Token type: <type>
- Expires in: <seconds or not provided>
- Notes: <only include when `expires_in` is not provided; mention that this can happen for admin-managed shared tokens>

Only show the raw access token if the user explicitly asked for it.
