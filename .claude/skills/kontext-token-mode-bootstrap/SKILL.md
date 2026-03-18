---
name: kontext-token-mode-bootstrap
description: Bootstrap a public Kontext application for token-mode runtime credential exchange via the Management API using a service account. Use when replacing hardcoded end-user API tokens with `kontext.require(integration, token)`, creating or reusing a public PKCE app, ensuring and attaching a user-chosen provider integration, and optionally writing the public client ID into a local env file. Do not use this skill for confidential `userId` retrieval or Bring your own auth.
---

# Kontext Token Mode Bootstrap

Use this skill when the app should keep user credentials at runtime and stop relying on hardcoded provider tokens in source code or env.

This skill covers one path:
- bootstrap or reuse a **public** Kontext application with PKCE
- ensure or update a provider integration chosen by the caller
- attach that integration to the public app
- optionally write the **public client ID only** into a local env file
- rewrite runtime code to use token mode:

```ts
const credential = await kontext.require(integrationName, token);
```

This skill does **not** cover:
- confidential `kontext.require(integration, { userId })` retrieval
- Bring your own auth, issuer, JWKS, or partner connect bootstrap
- hardcoding a provider recipe like Gmail into the skill itself

If the request is about confidential backend retrieval with `userId`, use `kontext-sdk-credentials` instead.
If the request is about trusting the app's own auth system and avoiding double auth, use `kontext-byoa-setup` instead.

## Runtime Shape

Use this flow:

1. Admin or setup agent runs the bundled bootstrap script with a service account.
2. The script creates or reuses a **public** app with PKCE.
3. The script creates, updates, or reuses the target integration based on env inputs.
4. The script attaches that integration to the app.
5. The script prints the app client ID and can write it into a local env file.
6. The app signs the end user in with PKCE.
7. Runtime code passes the authenticated Kontext token into `kontext.require(...)`.
8. If the integration is not connected yet, handle `IntegrationConnectionRequiredError` and send the user to `connectUrl`.
9. Retry after connect and continue the task.

Provider-specific configuration belongs in the command inputs, not in this skill. The skill should stay generic.

## Required Inputs

Service account:
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_ID`
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET`
- `KONTEXT_API_BASE_URL` (optional, defaults to `https://api.kontext.dev`)
- `MANAGEMENT_API_RESOURCE` (optional, defaults to `${KONTEXT_API_BASE_URL}/api/v1`)

Target application:
- `KONTEXT_APPLICATION_ID`, or
- `KONTEXT_APPLICATION_NAME`

Create the app when missing:
- `KONTEXT_CREATE_APPLICATION=true`
- `KONTEXT_APPLICATION_REDIRECT_URIS_JSON='["http://localhost:3000/callback"]'`

Optional public-app settings:
- `KONTEXT_APPLICATION_SCOPES_JSON` defaults to `["mcp:invoke"]`
- `KONTEXT_APPLICATION_PKCE_REQUIRED` defaults to `true`
- `KONTEXT_APPLICATION_ALLOWED_RESOURCES_JSON` defaults to `["mcp-gateway"]` when creating a new app

Target integration:
- `KONTEXT_INTEGRATION_ID`, or
- `KONTEXT_INTEGRATION_NAME`

Create or update a generic integration:
- `KONTEXT_INTEGRATION_URL`
- `KONTEXT_INTEGRATION_AUTH_MODE`
- `KONTEXT_INTEGRATION_OAUTH_PROVIDER`
- `KONTEXT_INTEGRATION_OAUTH_ISSUER`
- `KONTEXT_INTEGRATION_OAUTH_SCOPES_JSON`
- `KONTEXT_SERVER_TOKEN`
- `KONTEXT_VALIDATE_INTEGRATION=true`

Optional env output:
- `KONTEXT_OUTPUT_ENV_FILE` such as `.env.local`
- `KONTEXT_PUBLIC_CLIENT_ID_ENV_NAME` defaults to `NEXT_PUBLIC_KONTEXT_CLIENT_ID`

## Secret Handling Rules

Follow these rules strictly:

- Never print `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET` unless the user explicitly asks.
- Never print `KONTEXT_SERVER_TOKEN` unless the user explicitly asks.
- Never write service account credentials, shared server tokens, or live provider credentials into tracked files.
- Only write the **public** client ID into env output files.
- Never commit secrets or live tokens.
- If the target env file is tracked, stop and tell the user instead of writing into it.

## Workflow

1. Confirm the request really wants token mode and a public PKCE app.
2. Find the hardcoded provider credential path in the app:
   - `Bearer ...`
   - `process.env.*TOKEN`
   - `process.env.*KEY`
   - literal provider access tokens
3. Run the bundled setup helper:

```bash
node scripts/bootstrap-token-mode.mjs
```

4. Read the output:
   - public app client ID
   - integration ID and name
   - whether the integration was created, updated, or reused
   - whether the env file was written
5. Replace the hardcoded credential path with token mode:

```ts
const credential = await kontext.require(integrationName, token);
```

6. If the runtime surface is an MCP server or backend route, keep the user token flowing into that server call.
7. If runtime code can hit a first-time-connect case, handle `IntegrationConnectionRequiredError` and use `err.connectUrl`.
8. Summarize the final setup and the exact runtime integration name.

## Preferred Command Pattern

Bootstrap a new public PKCE app, create a generic OAuth integration, attach it, and write the public client ID into `.env.local`:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_NAME="My Demo Agent" \
KONTEXT_CREATE_APPLICATION=true \
KONTEXT_APPLICATION_REDIRECT_URIS_JSON='["http://localhost:3000/callback"]' \
KONTEXT_INTEGRATION_NAME="My Provider" \
KONTEXT_INTEGRATION_URL="https://provider.example.com/mcp" \
KONTEXT_INTEGRATION_AUTH_MODE=oauth \
KONTEXT_INTEGRATION_OAUTH_PROVIDER="provider-name" \
KONTEXT_INTEGRATION_OAUTH_SCOPES_JSON='["scope-a","scope-b"]' \
KONTEXT_OUTPUT_ENV_FILE=.env.local \
KONTEXT_PUBLIC_CLIENT_ID_ENV_NAME=NEXT_PUBLIC_KONTEXT_DEMO_CLIENT_ID \
node scripts/bootstrap-token-mode.mjs
```

Attach an existing integration to an existing public app and only print the public client ID:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=app_... \
KONTEXT_INTEGRATION_ID=int_... \
node scripts/bootstrap-token-mode.mjs
```

Create or update a generic `user_token` integration:

```bash
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_NAME="My Agent" \
KONTEXT_CREATE_APPLICATION=true \
KONTEXT_APPLICATION_REDIRECT_URIS_JSON='["http://localhost:3000/callback"]' \
KONTEXT_INTEGRATION_NAME="My API" \
KONTEXT_INTEGRATION_URL="https://mcp.example.com" \
KONTEXT_INTEGRATION_AUTH_MODE=user_token \
node scripts/bootstrap-token-mode.mjs
```

## Runtime Integration Pattern

For client auth:

```ts
const client = createKontextClient({
  clientId: process.env.NEXT_PUBLIC_KONTEXT_CLIENT_ID!,
  redirectUri: `${window.location.origin}/callback`,
  onAuthRequired: (url) => {
    window.location.href = url.toString();
  },
});
```

For runtime credential exchange:

```ts
const kontext = new Kontext({
  clientId: process.env.NEXT_PUBLIC_KONTEXT_CLIENT_ID!,
  apiUrl: process.env.KONTEXT_API_URL,
});

const credential = await kontext.require("provider-integration", token);
```

First-time connect handling:

```ts
import { IntegrationConnectionRequiredError } from "@kontext-dev/js-sdk/errors";

try {
  const credential = await kontext.require("provider-integration", token);
} catch (error) {
  if (error instanceof IntegrationConnectionRequiredError && error.connectUrl) {
    window.location.href = error.connectUrl;
  }
  throw error;
}
```

## Prompt Template

Use this when the user wants a coding agent to remove hardcoded creds:

```text
Use $kontext-token-mode-bootstrap.

This app currently uses hardcoded end-user credentials for an external provider. Replace that with Kontext token mode.

Bootstrap:
- create or reuse a public Kontext application with PKCE
- create, update, or reuse the provider integration described by the current env inputs
- attach that integration to the public app
- write the public client ID into the local env file if KONTEXT_OUTPUT_ENV_FILE is set

Runtime:
- keep the end user on PKCE
- use kontext.require("<integration>", token) at runtime
- if the integration is not connected yet, use the hosted connect flow and continue after connect

Do not switch this to confidential userId mode.
Do not hardcode provider scopes into the skill. Read them from the current env or prompt.
```

## Success Output

Return a short summary in this shape:

Token-mode bootstrap configured.

Application:
- Name: <application name>
- Application ID: <application id>
- OAuth type: public
- Client ID: <public client id>

Integration:
- Name: <integration name>
- Integration ID: <integration id>
- Auth mode: <auth mode>
- Status: <created|updated|reused>
- App attachment: <attached_now|already_attached>

Runtime:
- Retrieval method: kontext.require(integration, token)
- First-time connect: hosted connect page

Env output:
- File: <only show when written>
- Variable: <only show when written>
