---
name: kontext-byoa-setup
description: Configure Bring your own auth on a confidential Kontext application via the Management API using a service account. Use when asked to set up hosted connect for an application that already has its own login system, configure JWT trust with issuer, JWKS URL, and audience, or create or rotate the BYOA API key. Do not use this skill for retrieving credentials with the server SDK.
---

# Kontext Bring Your Own Auth Setup

Use this skill to configure **Bring your own auth** on an existing confidential Kontext application.

This skill only covers **setup**:
- resolve the target application
- verify it is confidential
- configure JWT trust
- create or rotate the BYOA API key
- return the values needed for hosted connect

This skill does **not** cover:
- retrieving credentials with the server SDK
- rotating the application's OAuth client secret unless the user explicitly asks
- clicking through the dashboard when the Management API can do the job

## What this feature is

Bring your own auth is for products whose users already sign in in their own app.

After setup, that product backend can call `POST /partner/connect-session` with:
- the Kontext **Application ID**
- the product user's JWT
- the **BYOA API key**

Kontext verifies that JWT and returns a hosted `connectUrl` so the user can connect integrations without a separate Kontext login.

Do not drift into the server SDK retrieval flow in this skill. If the user also asks about retrieving credentials later, treat that as a separate workflow.

## Required credentials

This skill requires a **service account** for the Kontext Management API.

Read these from the environment:
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_ID`
- `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET`
- `KONTEXT_API_BASE_URL` (optional, defaults to `https://api.kontext.dev`)
- `MANAGEMENT_API_RESOURCE` (optional, defaults to `${KONTEXT_API_BASE_URL}/api/v1`)

Target application:
- `KONTEXT_APPLICATION_ID`, or
- `KONTEXT_APPLICATION_NAME`

Required BYOA inputs:
- `BYOA_ISSUER`
- `BYOA_JWKS_URL`
- `BYOA_AUDIENCE`

Optional BYOA inputs:
- `BYOA_PARTNER_API_KEY`
- `BYOA_ALLOWED_RETURN_URLS`
- `BYOA_REQUIRED_CLAIMS_JSON`
- `BYOA_ALLOWED_ALGORITHMS`
- `BYOA_MAX_TOKEN_AGE_SECONDS`
- `BYOA_ROTATE_API_KEY=true`

Safe defaults:
- `BYOA_ALLOWED_ALGORITHMS=["RS256"]`
- `BYOA_MAX_TOKEN_AGE_SECONDS=600`
- `BYOA_REQUIRED_CLAIMS_JSON={}`
- `BYOA_ALLOWED_RETURN_URLS=[]`

## Secret handling rules

Follow these rules strictly:

- Never print `KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET` unless the user explicitly asks.
- Never write service account credentials to tracked files.
- Never commit service account credentials, JWTs, BYOA API keys, or client secrets.
- Never paste secrets into docs, examples, test fixtures, PR descriptions, or comments.
- Prefer existing environment variables or a secret manager.
- If a new BYOA API key is generated, show it once in the final result and clearly say it must be saved now.
- Do not rotate the application OAuth client secret unless the user explicitly asks.
- Do not store secrets in `.env` files unless they are already local-only and gitignored.

If the service account credentials are missing, stop and tell the user to create a service account in:
`Settings -> Service Accounts`

## Workflow

1. Validate service account credentials are present.
2. Resolve the target application by ID or exact name.
3. Fetch the application's OAuth config and verify it is **confidential**.
4. Collect BYOA values:
   - `issuer`
   - `jwksUrl`
   - `audience`
   - optional advanced settings
5. Run the bundled setup script:

```bash
node scripts/configure-byoa.mjs
```

6. Read the script output and summarize the result for the user.

## Preferred command pattern

The bundled script supports environment variables directly. Typical usage:

```bash
KONTEXT_API_BASE_URL=http://localhost:4000 \
KONTEXT_SERVICE_ACCOUNT_CLIENT_ID=... \
KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET=... \
KONTEXT_APPLICATION_ID=... \
BYOA_ISSUER=http://localhost:4100 \
BYOA_JWKS_URL=http://localhost:4100/.well-known/jwks.json \
BYOA_AUDIENCE=platform-x \
node scripts/configure-byoa.mjs
```

Advanced settings are optional:

```bash
BYOA_ALLOWED_RETURN_URLS='["http://localhost:3000/callback"]' \
BYOA_REQUIRED_CLAIMS_JSON='{"tenant":"demo"}' \
BYOA_ALLOWED_ALGORITHMS='["RS256"]' \
BYOA_MAX_TOKEN_AGE_SECONDS=600 \
node scripts/configure-byoa.mjs
```

## Notes for the agent

- Use straightforward language.
- Call the feature **Bring your own auth** in user-facing text.
- Do not use “partner auth”, “partner connect”, or “external auth” in user-facing explanations.
- Do not assume the exported management SDK types include `externalAuth` on `UpdateApplicationInput`.
- The bundled script updates the application via the Management API directly for that reason.

## Success output

Return a short summary in this shape:

Bring your own auth configured.

Application:
- Name: <application name>
- Application ID: <application id>

Bring your own auth:
- Status: enabled
- Issuer: <issuer>
- JWKS URL: <jwksUrl>
- Audience: <audience>
- Allowed return URLs: <urls or none>

Use this next:
- Application ID is for `POST /partner/connect-session`

BYOA API key (save now):
- <only show this if it was created or rotated in this run>
