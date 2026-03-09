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
  const integration = required(
    "KONTEXT_INTEGRATION",
    values.integration || process.env.KONTEXT_INTEGRATION,
  );
  const userId = required(
    "PLATFORM_USER_ID",
    values["user-id"] || process.env.PLATFORM_USER_ID,
  ).trim();

  if (!userId) {
    throw new Error("PLATFORM_USER_ID must not be empty.");
  }

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
    const isMissingConnection =
      payload?.error === "integration_required" ||
      String(payload?.error_description || "")
        .toLowerCase()
        .includes("not connected");

    if (isMissingConnection) {
      throw new Error(
        `The platform user has not connected ${integration} yet. Complete the hosted connect flow first.`,
      );
    }

    throw new Error(
      payload?.error_description ||
        `Credential retrieval failed: ${response.status}`,
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
      typeof result.expiresIn === "number" ? `${result.expiresIn}s` : "unknown"
    }`,
  );

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
