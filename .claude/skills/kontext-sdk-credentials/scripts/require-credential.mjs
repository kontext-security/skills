#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";

const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const TOKEN_TYPE_USER_ID = "urn:kontext:user-id";

function normalizeBaseUrl(value) {
  return value
    .replace(/\/api\/v1\/?$/, "")
    .replace(/\/mcp\/?$/, "")
    .replace(/\/$/, "");
}

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
  return value;
}

function requiredTrimmed(name, value) {
  const normalized = required(name, value).trim();
  if (!normalized) {
    throw new Error(`${name} must not be empty.`);
  }
  return normalized;
}

function maskToken(token) {
  if (token.length <= 10) {
    return `${token.slice(0, 2)}***`;
  }

  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "api-base-url": { type: "string" },
      "client-id": { type: "string" },
      "client-secret": { type: "string" },
      integration: { type: "string" },
      "user-id": { type: "string" },
      "show-token": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const apiBaseUrl = normalizeBaseUrl(
    values["api-base-url"] ||
      process.env.KONTEXT_API_BASE_URL ||
      "https://api.kontext.dev",
  );
  const clientId = required(
    "KONTEXT_CLIENT_ID",
    values["client-id"] || process.env.KONTEXT_CLIENT_ID,
  );
  const clientSecret = required(
    "KONTEXT_CLIENT_SECRET",
    values["client-secret"] || process.env.KONTEXT_CLIENT_SECRET,
  );
  const integration = requiredTrimmed(
    "KONTEXT_INTEGRATION",
    values.integration || process.env.KONTEXT_INTEGRATION,
  );
  const userId = requiredTrimmed(
    "PLATFORM_USER_ID",
    values["user-id"] || process.env.PLATFORM_USER_ID,
  );

  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: userId,
    subject_token_type: TOKEN_TYPE_USER_ID,
    resource: integration,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${apiBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(async () => ({
    error: "invalid_response",
    error_description: await response.text(),
  }));

  if (!response.ok) {
    const errorDescription = String(payload?.error_description || "");
    const normalizedDescription = errorDescription.toLowerCase();
    const isMissingConnection =
      payload?.error === "integration_required" ||
      normalizedDescription.includes("not connected");
    const isSharedTokenMisconfigured =
      payload?.error === "invalid_target" &&
      normalizedDescription.includes("shared server token");

    if (isMissingConnection) {
      throw new Error(
        `No credential is available for platform user '${userId}' on integration '${integration}'. If this integration uses user-managed auth, the user still needs to connect it through hosted connect. If it is supposed to use a shared admin-managed server token, make sure this platform user is already known to the app.`,
      );
    }

    if (isSharedTokenMisconfigured) {
      throw new Error(
        `Integration '${integration}' is configured for a shared admin-managed server token, but that token is missing or unusable. Ask an admin to update the shared server token.`,
      );
    }

    throw new Error(
      errorDescription || `Credential retrieval failed: ${response.status}`,
    );
  }

  const result = {
    integration,
    userId,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in ?? null,
    accessToken: payload.access_token,
    authorization: `${payload.token_type} ${payload.access_token}`,
    scope: payload.scope ?? null,
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Credential retrieved.");
  console.log("");
  console.log("Request:");
  console.log(`- Integration: ${integration}`);
  console.log(`- Platform user ID: ${userId}`);
  console.log("");
  console.log("Result:");
  console.log(`- Token type: ${result.tokenType}`);
  console.log(
    `- Expires in: ${
      typeof result.expiresIn === "number"
        ? `${result.expiresIn}s`
        : "not provided"
    }`,
  );
  if (typeof result.expiresIn !== "number") {
    console.log(
      "- Notes: The API did not return expires_in. This can happen for admin-managed shared tokens and other long-lived credentials.",
    );
  }

  if (values["show-token"] || process.env.KONTEXT_SHOW_TOKEN === "true") {
    console.log(`- Access token: ${result.accessToken}`);
  } else {
    console.log(`- Access token: ${maskToken(result.accessToken)}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Credential retrieval failed.",
  );
  process.exit(1);
});
