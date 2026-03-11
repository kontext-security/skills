#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";

const VALID_AUTH_MODES = new Set(["oauth", "user_token", "server_token", "none"]);

const KNOWN_INTEGRATION_RECIPES = {
  github: {
    key: "github",
    name: "github",
    url: "https://api.githubcopilot.com/mcp/",
    authMode: "oauth",
    oauth: {
      provider: "github",
    },
  },
};

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

function buildCreateOrUpdatePayload(input) {
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

async function requestToken({ baseUrl, resource, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "management:all",
    audience: resource,
  });

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

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

async function apiRequest({ baseUrl, token, method, path, body }) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
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
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
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
}) {
  if (applicationId) {
    const response = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications/${applicationId}`,
    });
    const oauth = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications/${applicationId}/oauth`,
    });
    return {
      application: response.application,
      oauth: oauth.oauth,
      created: false,
      createdClientSecret: null,
    };
  }

  const application = (await listAllApplications({ baseUrl, token })).find(
    (item) => item.name === applicationName,
  );

  if (application) {
    const oauth = await apiRequest({
      baseUrl,
      token,
      method: "GET",
      path: `/applications/${application.id}/oauth`,
    });
    return {
      application,
      oauth: oauth.oauth,
      created: false,
      createdClientSecret: null,
    };
  }

  if (!createApplication) {
    throw new Error(
      `Application named "${applicationName}" was not found. Set KONTEXT_CREATE_APPLICATION=true to create it.`,
    );
  }

  if (redirectUris.length === 0) {
    throw new Error(
      "KONTEXT_APPLICATION_REDIRECT_URIS_JSON is required when creating an application.",
    );
  }

  const created = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    path: "/applications",
    body: {
      name: applicationName,
      oauth: {
        type: "confidential",
        redirectUris,
        pkceRequired: true,
        scopes: ["mcp:invoke"],
        allowedResources: ["mcp-gateway"],
      },
    },
  });

  return {
    application: created.application,
    oauth: created.oauth,
    created: true,
    createdClientSecret: created.oauth.clientSecret ?? null,
  };
}

function resolveKnownRecipe(rawKey) {
  const key = parseOptionalTrimmed(rawKey)?.toLowerCase();
  if (!key) {
    return undefined;
  }

  const recipe = KNOWN_INTEGRATION_RECIPES[key];
  if (!recipe) {
    throw new Error(
      `Unsupported KONTEXT_KNOWN_INTEGRATION "${key}". Supported values: ${Object.keys(
        KNOWN_INTEGRATION_RECIPES,
      ).join(", ")}`,
    );
  }

  return recipe;
}

function buildDesiredConfig({
  recipe,
  integrationName,
  integrationUrl,
  integrationAuthMode,
  oauthProvider,
  oauthIssuer,
  oauthScopes,
  serverToken,
}) {
  const resolvedAuthMode = integrationAuthMode ?? recipe?.authMode ?? undefined;
  const resolvedOauth = buildOauthConfig({
    provider: oauthProvider ?? recipe?.oauth?.provider,
    issuer: oauthIssuer ?? recipe?.oauth?.issuer,
    scopes: oauthScopes ?? recipe?.oauth?.scopes,
  });
  const resolvedServerToken = parseOptionalTrimmed(serverToken);

  if (resolvedServerToken && resolvedAuthMode !== "server_token") {
    throw new Error(
      "KONTEXT_SERVER_TOKEN can only be used when KONTEXT_INTEGRATION_AUTH_MODE=server_token.",
    );
  }

  if (
    (oauthProvider || oauthIssuer || (oauthScopes && oauthScopes.length > 0)) &&
    resolvedAuthMode !== "oauth"
  ) {
    throw new Error(
      "OAuth fields can only be used when KONTEXT_INTEGRATION_AUTH_MODE=oauth.",
    );
  }

  return {
    name: integrationName ?? recipe?.name,
    url: integrationUrl ?? recipe?.url,
    authMode: resolvedAuthMode,
    oauth: resolvedOauth,
    serverToken: resolvedServerToken,
  };
}

function integrationMatchesRecipe(integration, recipe) {
  const targetUrl = normalizeUrl(recipe.url);
  if (normalizeUrl(integration.url) === targetUrl) {
    if (recipe.oauth?.provider) {
      return (
        (integration.oauth?.provider ?? "").toLowerCase() ===
        recipe.oauth.provider.toLowerCase()
      );
    }
    return true;
  }

  return integration.name === recipe.name;
}

async function resolveExistingIntegration({
  baseUrl,
  token,
  integrationId,
  integrationName,
  recipe,
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

  const allIntegrations = await listAllIntegrations({ baseUrl, token });

  if (integrationName) {
    const exact = allIntegrations.find((item) => item.name === integrationName);
    if (exact) {
      return exact;
    }
  }

  if (recipe) {
    return allIntegrations.find((item) => integrationMatchesRecipe(item, recipe)) ?? null;
  }

  return null;
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
    if (JSON.stringify(desiredScopes) !== JSON.stringify(existingScopes)) {
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
        "Creating an integration requires KONTEXT_INTEGRATION_NAME and KONTEXT_INTEGRATION_URL, or a supported KONTEXT_KNOWN_INTEGRATION recipe.",
      );
    }

    const createPayload = buildCreateOrUpdatePayload({
      name: desired.name,
      url: desired.url,
      authMode: desired.authMode ?? "none",
      oauth: desired.oauth,
      serverToken: desired.serverToken,
    });

    const createdResponse = await apiRequest({
      baseUrl,
      token,
      method: "POST",
      path: "/integrations",
      body: createPayload,
    });
    integration = createdResponse.integration;
    created = true;
  } else if (shouldUpdateIntegration(integration, desired)) {
    const updatePayload = buildCreateOrUpdatePayload({
      name: desired.name,
      url: desired.url,
      authMode: desired.authMode,
      oauth: desired.oauth,
      serverToken: desired.serverToken,
    });

    const updatedResponse = await apiRequest({
      baseUrl,
      token,
      method: "PATCH",
      path: `/integrations/${integration.id}`,
      body: updatePayload,
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

function buildRuntimeSummary(integration) {
  const authMode = integration.authMode ?? "none";

  if (authMode === "none") {
    return {
      retrievalMethod: "not_applicable",
      endUserAction: "not_required",
      note: "No runtime credential exchange is needed for authMode none.",
    };
  }

  if (authMode === "server_token") {
    return {
      retrievalMethod: "Kontext.require",
      endUserAction: "not_required",
      note: "Every end user of attached apps can retrieve the shared token immediately after the admin configures it.",
    };
  }

  return {
    retrievalMethod: "Kontext.require",
    endUserAction: "required",
    note: "Each end user must connect their own credential before runtime retrieval succeeds.",
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
      "integration-id": { type: "string" },
      "integration-name": { type: "string" },
      "known-integration": { type: "string" },
      "integration-url": { type: "string" },
      "integration-auth-mode": { type: "string" },
      "integration-oauth-provider": { type: "string" },
      "integration-oauth-issuer": { type: "string" },
      "integration-oauth-scopes": { type: "string" },
      "server-token": { type: "string" },
      "validate-integration": { type: "boolean", default: false },
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
  const resource =
    process.env.MANAGEMENT_API_RESOURCE || `${baseUrl}/api/v1`;
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
  const integrationId = parseOptionalTrimmed(
    values["integration-id"] || process.env.KONTEXT_INTEGRATION_ID,
  );
  const integrationName = parseOptionalTrimmed(
    values["integration-name"] || process.env.KONTEXT_INTEGRATION_NAME,
  );
  const knownIntegration = resolveKnownRecipe(
    values["known-integration"] || process.env.KONTEXT_KNOWN_INTEGRATION,
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
  const serverToken =
    values["server-token"] || process.env.KONTEXT_SERVER_TOKEN;
  const validateIntegration =
    values["validate-integration"] ||
    process.env.KONTEXT_VALIDATE_INTEGRATION === "true";

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
  });

  if (applicationResult.oauth.type !== "confidential") {
    throw new Error(
      `Application "${applicationResult.application.name}" is a ${applicationResult.oauth.type} client. Server-side credential retrieval requires a confidential application.`,
    );
  }

  const desired = buildDesiredConfig({
    recipe: knownIntegration,
    integrationName,
    integrationUrl,
    integrationAuthMode,
    oauthProvider,
    oauthIssuer,
    oauthScopes,
    serverToken,
  });

  const existing = await resolveExistingIntegration({
    baseUrl,
    token,
    integrationId,
    integrationName,
    recipe: knownIntegration,
  });

  if (
    !existing &&
    !knownIntegration &&
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
    existing,
    desired,
    validateIntegration,
  });

  const attachedNow = await ensureAttached({
    baseUrl,
    token,
    applicationId: applicationResult.application.id,
    integrationId: integrationResult.integration.id,
  });

  const runtime = buildRuntimeSummary(integrationResult.integration);
  const result = {
    application: {
      id: applicationResult.application.id,
      name: applicationResult.application.name,
      created: applicationResult.created,
      oauthType: applicationResult.oauth.type,
      clientId: applicationResult.oauth.clientId,
      clientSecret: applicationResult.createdClientSecret,
      redirectUris: applicationResult.oauth.redirectUris ?? [],
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
      knownRecipe: knownIntegration?.key ?? null,
    },
    runtime,
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Server credential integration configured.");
  console.log("");
  console.log("Application:");
  console.log(`- Name: ${result.application.name}`);
  console.log(`- Application ID: ${result.application.id}`);
  console.log(`- OAuth type: ${result.application.oauthType}`);
  console.log(`- Client ID: ${result.application.clientId}`);
  console.log(
    `- Redirect URIs: ${
      result.application.redirectUris.length > 0
        ? result.application.redirectUris.join(", ")
        : "none"
    }`,
  );
  if (result.application.clientSecret) {
    console.log(`- Client secret (save now): ${result.application.clientSecret}`);
  }

  console.log("");
  console.log("Integration:");
  console.log(`- Name: ${result.integration.name}`);
  console.log(`- Integration ID: ${result.integration.id}`);
  console.log(`- URL: ${result.integration.url}`);
  console.log(`- Auth mode: ${result.integration.authMode}`);
  if (result.integration.knownRecipe) {
    console.log(`- Known recipe: ${result.integration.knownRecipe}`);
  }
  if (result.integration.oauth) {
    console.log(
      `- OAuth provider: ${result.integration.oauth.provider ?? "not set"}`,
    );
    console.log(
      `- OAuth issuer: ${result.integration.oauth.issuer ?? "not set"}`,
    );
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
  console.log(`- End-user action: ${result.runtime.endUserAction}`);
  console.log(`- Notes: ${result.runtime.note}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Failed to configure credential integration.",
  );
  process.exit(1);
});
