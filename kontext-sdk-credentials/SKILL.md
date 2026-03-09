---
name: kontext-sdk-credentials
description: Retrieve a stored integration credential from a confidential Kontext application for a known platform user ID. Use when asked to fetch GitHub, Google, or other integration tokens from the server side with clientId, clientSecret, and userId, or to verify that a user has already connected an integration. Do not use this skill to configure Bring your own auth or create hosted connect sessions.
---

# Kontext Server Credential Retrieval

Use this skill to retrieve a stored integration credential for a known user from a **confidential** Kontext application.

This skill only covers **retrieval**:
- verify the application can authenticate as a confidential client
- fetch a stored credential for a specific integration and platform user ID
- explain clearly when the user still needs to connect the integration first

This skill does **not** cover:
- configuring Bring your own auth
- creating or rotating the BYOA API key
- creating hosted connect sessions

If the user needs setup, use `kontext-byoa-setup` first.

## What this feature is

After a user has already connected GitHub, Google, or another integration, the backend can retrieve that stored credential later with:
- the app's **OAuth Client ID**
- the app's **OAuth Client Secret**
- the platform's own stable **userId**

In normal app code, this is:

```ts
const credential = await kontext.require("github", {
  userId: "platform-user-123",
});
```

This skill focuses on the server-side retrieval step only.

## Required inputs

Read these from the environment:
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
- By default, do not print the full retrieved access token unless the user explicitly asks for it or the command is being piped directly into another local process.
- If retrieval fails because the user has not connected the integration yet, explain that plainly instead of retrying blindly.

## Workflow

1. Validate the required environment variables are present.
2. Run the bundled helper script:

```bash
node scripts/require-credential.mjs
```

3. If the helper reports that the integration is not connected:
   - tell the user the platform user still needs to connect that integration first
   - do not mix in BYOA setup unless they ask
4. Summarize the result.

## Preferred command pattern

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

## Notes for the agent

- Use straightforward language.
- In user-facing text, call `PLATFORM_USER_ID` the platform's own user ID.
- Do not tell the user to store a Kontext internal user ID.
- If retrieval fails with an integration-required style error, say the user still needs to connect the integration through the hosted connect flow.
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
- Expires in: <seconds or unknown>

Only show the raw access token if the user explicitly asked for it.
