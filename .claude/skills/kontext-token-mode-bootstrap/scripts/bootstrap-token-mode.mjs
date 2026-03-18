#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

const VALID_AUTH_MODES = new Set(["oauth", "user_token", "server_token", "none"]);
const execFileAsync = promisify(execFile);

function normalizeBaseUrl(value) {
  return value.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
}

function normalizeUrl(value) {
  return value.replace(/\/$/, "");
}

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }

  return value;
}

function parseOptionalTrimmed(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredTrimmed(name, value) {
  const normalized = parseOptionalTrimmed(required(name, value));
  if (!normalized) {
    throw new Error(`${name} must not be empty.`);
  }

  return normalized;
}

function parseStringArray(name, raw, fallback) {
  if (!raw) {
    return fallback;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }

  return parsed.map((value) => value.trim()).filter(Boolean);
}

function parseBoolean(name, value, fallback) {
  const normalized = parseOptionalTrimmed(value);
  if (!normalized) {
    return fallback;
  }

  const lower = normalized.toLowerCase();
  if (["1", "true", "yes"].includes(lower)) {
    return true;
  }
  if (["0", "false", "no"].includes(lower)) {
    return false;
  }

  throw new Error(`${name} must be one of: true, false, 1, 0, yes, no.`);
}

function normalizeAuthMode(value) {
  const normalized = parseOptionalTrimmed(value);
  if (!normalized) {
    return undefined;
  }

  if (!VALID_AUTH_MODES.has(normalized)) {
    throw new Error(
      `KONTEXT_INTEGRATION_AUTH_MODE must be one of: ${Array.from(VALID_AUTH_MODES).join(", ")}`,
    );
  }

  return normalized;
}

function buildOauthConfig({ provider, issuer, scopes }) {
  const oauth = {};

  if (provider) {
    oauth.provider = provider;
  }
  if (issuer) {
    oauth.issuer = issuer;
  }
  if (Array.isArray(scopes) && scopes.length > 0) {
    oauth.scopes = scopes;
  }

  return Object.keys(oauth).length > 0 ? oauth : undefined;
}

function buildIntegrationPayload(input) {
  const payload = {};

  if (input.name !== undefined) {
    payload.name = input.name;
  }
  if (input.url !== undefined) {
    payload.url = input.url;
  }
  if (input.authMode !== undefined) {
    payload.authMode = input.authMode;
  }
  if (input.oauth !== undefined) {
    payload.oauth = input.oauth;
  }
  if (input.serverToken !== undefined) {
    payload.serverToken = input.serverToken;
  }

  return payload;
}

function buildApplicationOauthPayload({
  redirectUris,
  pkceRequired,
  scopes,
  allowedResources,
}) {
  const payload = {
    type: "public",
    redirectUris,
    pkceRequired,
    scopes,
  };

  if (Array.isArray(allowedResources) && allowedResources.length > 0) {
    payload.allowedResources = allowedResources;
  }

  return payload;
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function requestToken({ baseUrl, resource, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "management:all",
    audience: resource,
  });

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Service account authentication failed (${response.status}): ${message}`,
    );
  }

  const payload = await response.json();
  return payload.access_token;
}

async function apiRequest({ baseUrl, token, method, path: requestPath, body }) {
  const response = await fetch(`${baseUrl}/api/v1${requestPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${method} ${requestPath} failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function listAllApplications({ baseUrl, token }) {
  const items = [];
  let cursor;

  while (true) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications${query}`,
    });

    items.push(...(response.items ?? []));
    if (!response.nextCursor) {
      return items;
    }

    cursor = response.nextCursor;
  }
}

async function listAllIntegrations({ baseUrl, token }) {
  const items = [];
  let cursor;

  while (true) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/integrations${query}`,
    });

    items.push(...(response.items ?? []));
    if (!response.nextCursor) {
      return items;
    }

    cursor = response.nextCursor;
  }
}

async function resolveOrCreateApplication({
  baseUrl,
  token,
  applicationId,
  applicationName,
  createApplication,
  redirectUris,
  pkceRequired,
  scopes,
  allowedResources,
}) {
  let application;
  let oauth;
  let created = false;
  let updated = false;
  let allowedResourcesNote = null;

  if (applicationId) {
    const response = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications/${applicationId}`,
    });
    application = response.application;
  } else {
    application = (await listAllApplications({ baseUrl, token })).find(
      (item) => item.name === applicationName,
    );
  }

  if (!application) {
    if (!createApplication) {
      throw new Error(
        `Application named "${applicationName}" was not found. Set KONTEXT_CREATE_APPLICATION=true to create it.`,
      );
    }

    if (redirectUris.length === 0) {
      throw new Error(
        "KONTEXT_APPLICATION_REDIRECT_URIS_JSON is required when creating a public application.",
      );
    }

    const createdResponse = await apiRequest({
      baseUrl,
      token,
      method: "POST",
      path: "/applications",
      body: {
        name: applicationName,
        oauth: buildApplicationOauthPayload({
          redirectUris,
          pkceRequired,
          scopes,
          allowedResources,
        }),
      },
    });

    application = createdResponse.application;
    oauth = createdResponse.oauth;
    created = true;
  } else {
    const oauthResponse = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications/${application.id}/oauth`,
    });
    oauth = oauthResponse.oauth;
  }

  if (oauth.type !== "public") {
    throw new Error(
      `Application "${application.name}" is a ${oauth.type} client. Token mode bootstrap requires a public application.`,
    );
  }

  if (!created) {
    const patch = {};

    if (oauth.pkceRequired !== pkceRequired) {
      patch.pkceRequired = pkceRequired;
    }

    const currentScopes = Array.isArray(oauth.scopes) ? oauth.scopes : [];
    if (!arraysEqual(currentScopes, scopes)) {
      patch.scopes = scopes;
    }

    if (redirectUris.length > 0) {
      const currentRedirectUris = Array.isArray(oauth.redirectUris)
        ? oauth.redirectUris
        : [];
      if (!arraysEqual(currentRedirectUris, redirectUris)) {
        patch.redirectUris = redirectUris;
      }
    }

    if (allowedResources.length > 0) {
      allowedResourcesNote =
        "Existing application reused. allowedResources were not mutated by this script.";
    }

    if (Object.keys(patch).length > 0) {
      const patched = await apiRequest({
        baseUrl,
        token,
        method: "PATCH",
        path: `/applications/${application.id}/oauth`,
        body: patch,
      });
      oauth = patched.oauth;
      updated = true;
    }
  }

  return {
    application,
    oauth,
    created,
    updated,
    allowedResourcesNote,
  };
}

function buildDesiredIntegration({
  integrationName,
  integrationUrl,
  integrationAuthMode,
  oauthProvider,
  oauthIssuer,
  oauthScopes,
  serverToken,
}) {
  const resolvedServerToken = parseOptionalTrimmed(serverToken);
  if (resolvedServerToken && integrationAuthMode !== "server_token") {
    throw new Error(
      "KONTEXT_SERVER_TOKEN can only be used when KONTEXT_INTEGRATION_AUTH_MODE=server_token.",
    );
  }

  if (
    (oauthProvider || oauthIssuer || (oauthScopes && oauthScopes.length > 0)) &&
    integrationAuthMode !== "oauth"
  ) {
    throw new Error(
      "OAuth fields can only be used when KONTEXT_INTEGRATION_AUTH_MODE=oauth.",
    );
  }

  return {
    name: integrationName,
    url: integrationUrl,
    authMode: integrationAuthMode,
    oauth: buildOauthConfig({
      provider: oauthProvider,
      issuer: oauthIssuer,
      scopes: oauthScopes,
    }),
    serverToken: resolvedServerToken,
  };
}

async function resolveExistingIntegration({
  baseUrl,
  token,
  integrationId,
  integrationName,
}) {
  if (integrationId) {
    const response = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/integrations/${integrationId}`,
    });
    return response.integration;
  }

  if (!integrationName) {
    return null;
  }

  return (
    (await listAllIntegrations({ baseUrl, token })).find(
      (item) => item.name === integrationName,
    ) ?? null
  );
}

function shouldUpdateIntegration(existing, desired) {
  if (!existing) {
    return false;
  }

  if (desired.name !== undefined && desired.name !== existing.name) {
    return true;
  }
  if (
    desired.url !== undefined &&
    normalizeUrl(desired.url) !== normalizeUrl(existing.url)
  ) {
    return true;
  }
  if (
    desired.authMode !== undefined &&
    desired.authMode !== (existing.authMode ?? "none")
  ) {
    return true;
  }
  if (desired.oauth) {
    const existingScopes = Array.isArray(existing.oauth?.scopes)
      ? existing.oauth.scopes
      : [];
    const desiredScopes = Array.isArray(desired.oauth.scopes)
      ? desired.oauth.scopes
      : [];

    if ((desired.oauth.provider ?? null) !== (existing.oauth?.provider ?? null)) {
      return true;
    }
    if ((desired.oauth.issuer ?? null) !== (existing.oauth?.issuer ?? null)) {
      return true;
    }
    if (!arraysEqual(desiredScopes, existingScopes)) {
      return true;
    }
  }
  if (desired.serverToken !== undefined) {
    return true;
  }

  return false;
}

async function upsertIntegration({
  baseUrl,
  token,
  existing,
  desired,
  validateIntegration,
}) {
  let integration = existing;
  let created = false;
  let updated = false;

  if (!integration) {
    if (!desired.name || !desired.url) {
      throw new Error(
        "Creating an integration requires KONTEXT_INTEGRATION_NAME and KONTEXT_INTEGRATION_URL.",
      );
    }

    const createdResponse = await apiRequest({
      baseUrl,
      token,
      method: "POST",
      path: "/integrations",
      body: buildIntegrationPayload({
        name: desired.name,
        url: desired.url,
        authMode: desired.authMode ?? "none",
        oauth: desired.oauth,
        serverToken: desired.serverToken,
      }),
    });

    integration = createdResponse.integration;
    created = true;
  } else if (shouldUpdateIntegration(integration, desired)) {
    const updatedResponse = await apiRequest({
      baseUrl,
      token,
      method: "PATCH",
      path: `/integrations/${integration.id}`,
      body: buildIntegrationPayload({
        name: desired.name,
        url: desired.url,
        authMode: desired.authMode,
        oauth: desired.oauth,
        serverToken: desired.serverToken,
      }),
    });

    integration = updatedResponse.integration;
    updated = true;
  }

  let validation = null;
  if (validateIntegration) {
    validation = await apiRequest({
      baseUrl,
      token,
      method: "POST",
      path: `/integrations/${integration.id}/validate`,
    });
  }

  const refreshed = (
    await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/integrations/${integration.id}`,
    })
  ).integration;

  return {
    integration: refreshed,
    created,
    updated,
    validation,
  };
}

async function ensureAttached({ baseUrl, token, applicationId, integrationId }) {
  const attached = await apiRequest({
    baseUrl,
    token,
    method: "GET",
    path: `/applications/${applicationId}/integrations`,
  });

  const attachedIds = new Set(attached.integrationIds ?? []);
  if (attachedIds.has(integrationId)) {
    return false;
  }

  await apiRequest({
    baseUrl,
    token,
    method: "POST",
    path: `/applications/${applicationId}/integrations/${integrationId}`,
  });

  return true;
}

async function writeEnvValue({ outputFile, variableName, value }) {
  const absolutePath = path.resolve(outputFile);
  await ensureFileIsNotTracked(absolutePath);
  let contents = "";

  try {
    contents = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const line = `${variableName}=${value}`;
  const pattern = new RegExp(`^${escapeRegex(variableName)}=.*$`, "m");
  let nextContents;

  if (pattern.test(contents)) {
    nextContents = contents.replace(pattern, line);
  } else if (contents.length === 0) {
    nextContents = `${line}\n`;
  } else {
    const separator = contents.endsWith("\n") ? "" : "\n";
    nextContents = `${contents}${separator}${line}\n`;
  }

  await fs.writeFile(absolutePath, nextContents, "utf8");
  return absolutePath;
}

async function ensureFileIsNotTracked(absolutePath) {
  let repoRoot;

  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.dirname(absolutePath),
    });
    repoRoot = result.stdout.trim();
  } catch {
    return;
  }

  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..")) {
    return;
  }

  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", relativePath], {
      cwd: repoRoot,
    });
    throw new Error(
      `Refusing to write ${absolutePath} because it is tracked by git. Use a local-only env file instead.`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Refusing to write")
    ) {
      throw error;
    }
  }
}

function buildRuntimeSummary(integrationName) {
  return {
    retrievalMethod: "kontext.require(integration, token)",
    integrationName,
    firstTimeConnect: "hosted_connect",
    note: "Pass the authenticated Kontext token into runtime code and handle IntegrationConnectionRequiredError for first-time connect.",
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "api-base-url": { type: "string" },
      "service-account-client-id": { type: "string" },
      "service-account-client-secret": { type: "string" },
      "application-id": { type: "string" },
      "application-name": { type: "string" },
      "create-application": { type: "boolean", default: false },
      "application-redirect-uris": { type: "string" },
      "application-scopes": { type: "string" },
      "application-pkce-required": { type: "string" },
      "application-allowed-resources": { type: "string" },
      "integration-id": { type: "string" },
      "integration-name": { type: "string" },
      "integration-url": { type: "string" },
      "integration-auth-mode": { type: "string" },
      "integration-oauth-provider": { type: "string" },
      "integration-oauth-issuer": { type: "string" },
      "integration-oauth-scopes": { type: "string" },
      "server-token": { type: "string" },
      "validate-integration": { type: "boolean", default: false },
      "output-env-file": { type: "string" },
      "public-client-id-env-name": { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positionals.join(" ")}`);
  }

  const baseUrl = normalizeBaseUrl(
    values["api-base-url"] ||
      process.env.KONTEXT_API_BASE_URL ||
      "https://api.kontext.dev",
  );
  const resource = process.env.MANAGEMENT_API_RESOURCE || `${baseUrl}/api/v1`;
  const serviceAccountClientId = requiredTrimmed(
    "KONTEXT_SERVICE_ACCOUNT_CLIENT_ID",
    values["service-account-client-id"] ||
      process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_ID,
  );
  const serviceAccountClientSecret = requiredTrimmed(
    "KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET",
    values["service-account-client-secret"] ||
      process.env.KONTEXT_SERVICE_ACCOUNT_CLIENT_SECRET,
  );
  const applicationId = parseOptionalTrimmed(
    values["application-id"] || process.env.KONTEXT_APPLICATION_ID,
  );
  const applicationName = parseOptionalTrimmed(
    values["application-name"] || process.env.KONTEXT_APPLICATION_NAME,
  );
  const createApplication =
    values["create-application"] ||
    process.env.KONTEXT_CREATE_APPLICATION === "true";
  const redirectUris = parseStringArray(
    "KONTEXT_APPLICATION_REDIRECT_URIS_JSON",
    values["application-redirect-uris"] ||
      process.env.KONTEXT_APPLICATION_REDIRECT_URIS_JSON,
    [],
  );
  const applicationScopes = parseStringArray(
    "KONTEXT_APPLICATION_SCOPES_JSON",
    values["application-scopes"] || process.env.KONTEXT_APPLICATION_SCOPES_JSON,
    ["mcp:invoke"],
  );
  const pkceRequired = parseBoolean(
    "KONTEXT_APPLICATION_PKCE_REQUIRED",
    values["application-pkce-required"] ||
      process.env.KONTEXT_APPLICATION_PKCE_REQUIRED,
    true,
  );
  const allowedResources = parseStringArray(
    "KONTEXT_APPLICATION_ALLOWED_RESOURCES_JSON",
    values["application-allowed-resources"] ||
      process.env.KONTEXT_APPLICATION_ALLOWED_RESOURCES_JSON,
    ["mcp-gateway"],
  );
  const integrationId = parseOptionalTrimmed(
    values["integration-id"] || process.env.KONTEXT_INTEGRATION_ID,
  );
  const integrationName = parseOptionalTrimmed(
    values["integration-name"] || process.env.KONTEXT_INTEGRATION_NAME,
  );
  const integrationUrl = parseOptionalTrimmed(
    values["integration-url"] || process.env.KONTEXT_INTEGRATION_URL,
  );
  const integrationAuthMode = normalizeAuthMode(
    values["integration-auth-mode"] ||
      process.env.KONTEXT_INTEGRATION_AUTH_MODE,
  );
  const oauthProvider = parseOptionalTrimmed(
    values["integration-oauth-provider"] ||
      process.env.KONTEXT_INTEGRATION_OAUTH_PROVIDER,
  );
  const oauthIssuer = parseOptionalTrimmed(
    values["integration-oauth-issuer"] ||
      process.env.KONTEXT_INTEGRATION_OAUTH_ISSUER,
  );
  const oauthScopesRaw =
    values["integration-oauth-scopes"] ||
    process.env.KONTEXT_INTEGRATION_OAUTH_SCOPES_JSON;
  const oauthScopes = oauthScopesRaw
    ? parseStringArray("KONTEXT_INTEGRATION_OAUTH_SCOPES_JSON", oauthScopesRaw, [])
    : undefined;
  const serverToken = values["server-token"] || process.env.KONTEXT_SERVER_TOKEN;
  const validateIntegration =
    values["validate-integration"] ||
    process.env.KONTEXT_VALIDATE_INTEGRATION === "true";
  const outputEnvFile = parseOptionalTrimmed(
    values["output-env-file"] || process.env.KONTEXT_OUTPUT_ENV_FILE,
  );
  const publicClientIdEnvName =
    parseOptionalTrimmed(
      values["public-client-id-env-name"] ||
        process.env.KONTEXT_PUBLIC_CLIENT_ID_ENV_NAME,
    ) || "NEXT_PUBLIC_KONTEXT_CLIENT_ID";

  if (!applicationId && !applicationName) {
    throw new Error(
      "Set KONTEXT_APPLICATION_ID or KONTEXT_APPLICATION_NAME to resolve the target application.",
    );
  }

  const token = await requestToken({
    baseUrl,
    resource,
    clientId: serviceAccountClientId,
    clientSecret: serviceAccountClientSecret,
  });

  const applicationResult = await resolveOrCreateApplication({
    baseUrl,
    token,
    applicationId,
    applicationName,
    createApplication,
    redirectUris,
    pkceRequired,
    scopes: applicationScopes,
    allowedResources,
  });

  const desired = buildDesiredIntegration({
    integrationName,
    integrationUrl,
    integrationAuthMode,
    oauthProvider,
    oauthIssuer,
    oauthScopes,
    serverToken,
  });

  const existingIntegration = await resolveExistingIntegration({
    baseUrl,
    token,
    integrationId,
    integrationName,
  });

  if (
    !existingIntegration &&
    desired.name === undefined &&
    desired.url === undefined
  ) {
    throw new Error(
      "Set KONTEXT_INTEGRATION_ID or KONTEXT_INTEGRATION_NAME to attach an existing integration, or provide KONTEXT_INTEGRATION_NAME plus KONTEXT_INTEGRATION_URL to create a new one.",
    );
  }

  const integrationResult = await upsertIntegration({
    baseUrl,
    token,
    existing: existingIntegration,
    desired,
    validateIntegration,
  });

  const attachedNow = await ensureAttached({
    baseUrl,
    token,
    applicationId: applicationResult.application.id,
    integrationId: integrationResult.integration.id,
  });

  let envOutput = null;
  if (outputEnvFile) {
    const writtenFile = await writeEnvValue({
      outputFile: outputEnvFile,
      variableName: publicClientIdEnvName,
      value: applicationResult.oauth.clientId,
    });
    envOutput = {
      file: writtenFile,
      variable: publicClientIdEnvName,
      value: applicationResult.oauth.clientId,
    };
  }

  const result = {
    application: {
      id: applicationResult.application.id,
      name: applicationResult.application.name,
      oauthType: applicationResult.oauth.type,
      clientId: applicationResult.oauth.clientId,
      redirectUris: applicationResult.oauth.redirectUris ?? [],
      scopes: applicationResult.oauth.scopes ?? [],
      pkceRequired: applicationResult.oauth.pkceRequired,
      created: applicationResult.created,
      updated: applicationResult.updated,
      allowedResourcesNote: applicationResult.allowedResourcesNote,
    },
    integration: {
      id: integrationResult.integration.id,
      name: integrationResult.integration.name,
      url: integrationResult.integration.url,
      authMode: integrationResult.integration.authMode,
      oauth: integrationResult.integration.oauth ?? null,
      serverTokenConfigured:
        integrationResult.integration.serverTokenConfigured ?? false,
      created: integrationResult.created,
      updated: integrationResult.updated,
      attached: attachedNow ? "attached_now" : "already_attached",
      validation: integrationResult.validation,
    },
    runtime: buildRuntimeSummary(integrationResult.integration.name),
    envOutput,
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Token-mode bootstrap configured.");
  console.log("");
  console.log("Application:");
  console.log(`- Name: ${result.application.name}`);
  console.log(`- Application ID: ${result.application.id}`);
  console.log(`- OAuth type: ${result.application.oauthType}`);
  console.log(`- Client ID: ${result.application.clientId}`);
  console.log(`- PKCE required: ${result.application.pkceRequired ? "yes" : "no"}`);
  console.log(
    `- Redirect URIs: ${
      result.application.redirectUris.length > 0
        ? result.application.redirectUris.join(", ")
        : "none"
    }`,
  );
  console.log(
    `- Scopes: ${
      result.application.scopes.length > 0
        ? result.application.scopes.join(", ")
        : "none"
    }`,
  );
  console.log(
    `- Status: ${
      result.application.created
        ? "created"
        : result.application.updated
          ? "updated"
          : "reused"
    }`,
  );
  if (result.application.allowedResourcesNote) {
    console.log(`- Note: ${result.application.allowedResourcesNote}`);
  }

  console.log("");
  console.log("Integration:");
  console.log(`- Name: ${result.integration.name}`);
  console.log(`- Integration ID: ${result.integration.id}`);
  console.log(`- URL: ${result.integration.url}`);
  console.log(`- Auth mode: ${result.integration.authMode}`);
  if (result.integration.oauth) {
    console.log(
      `- OAuth provider: ${result.integration.oauth.provider ?? "not set"}`,
    );
    console.log(
      `- OAuth issuer: ${result.integration.oauth.issuer ?? "not set"}`,
    );
    if (Array.isArray(result.integration.oauth.scopes)) {
      console.log(
        `- OAuth scopes: ${
          result.integration.oauth.scopes.length > 0
            ? result.integration.oauth.scopes.join(", ")
            : "none"
        }`,
      );
    }
  }
  if (result.integration.authMode === "server_token") {
    console.log(
      `- Shared token configured: ${
        result.integration.serverTokenConfigured ? "yes" : "no"
      }`,
    );
  }
  console.log(
    `- Status: ${
      result.integration.created
        ? "created"
        : result.integration.updated
          ? "updated"
          : "reused"
    }`,
  );
  console.log(`- App attachment: ${result.integration.attached}`);
  if (result.integration.validation) {
    console.log(
      `- Validation: ${result.integration.validation.status}${
        result.integration.validation.message
          ? ` (${result.integration.validation.message})`
          : ""
      }`,
    );
  }

  console.log("");
  console.log("Runtime:");
  console.log(`- Retrieval method: ${result.runtime.retrievalMethod}`);
  console.log(`- Integration name: ${result.runtime.integrationName}`);
  console.log(`- First-time connect: ${result.runtime.firstTimeConnect}`);
  console.log(`- Notes: ${result.runtime.note}`);

  if (result.envOutput) {
    console.log("");
    console.log("Env output:");
    console.log(`- File: ${result.envOutput.file}`);
    console.log(`- Variable: ${result.envOutput.variable}`);
    console.log(`- Value: ${result.envOutput.value}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Failed to bootstrap token-mode configuration.",
  );
  process.exit(1);
});
