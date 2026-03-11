#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";

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

function requiredTrimmed(name, value) {
  const normalized = required(name, value).trim();
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

async function resolveTargetIntegration({
  baseUrl,
  token,
  integrationId,
  integrationName,
  customIntegrationName,
  customIntegrationUrl,
  serverToken,
  validateIntegration,
}) {
  const allIntegrations = await listAllIntegrations({ baseUrl, token });

  let integration = null;
  if (integrationId) {
    integration = (
      await apiRequest({
        baseUrl,
        token,
        method: "GET",
        path: `/integrations/${integrationId}`,
      })
    ).integration;
  } else if (integrationName) {
    integration =
      allIntegrations.find((item) => item.name === integrationName) ?? null;
  }

  const wantsCustomIntegration =
    Boolean(customIntegrationName) ||
    Boolean(customIntegrationUrl) ||
    Boolean(serverToken);

  let created = false;
  let updated = false;

  if (wantsCustomIntegration) {
    const targetName = customIntegrationName ?? integration?.name;
    const targetUrl = customIntegrationUrl ?? integration?.url;
    const trimmedServerToken = requiredTrimmed(
      "KONTEXT_SERVER_TOKEN",
      serverToken,
    );

    if (!targetName) {
      throw new Error(
        "KONTEXT_CUSTOM_INTEGRATION_NAME is required when creating a custom integration.",
      );
    }

    if (!targetUrl) {
      throw new Error(
        "KONTEXT_CUSTOM_INTEGRATION_URL is required when creating a custom integration.",
      );
    }

    if (!integration) {
      const createdResponse = await apiRequest({
        baseUrl,
        token,
        method: "POST",
        path: "/integrations",
        body: {
          name: targetName,
          url: targetUrl,
          authMode: "server_token",
          serverToken: trimmedServerToken,
        },
      });
      integration = createdResponse.integration;
      created = true;
    } else {
      const updatedResponse = await apiRequest({
        baseUrl,
        token,
        method: "PATCH",
        path: `/integrations/${integration.id}`,
        body: {
          name: targetName,
          url: targetUrl,
          authMode: "server_token",
          serverToken: trimmedServerToken,
        },
      });
      integration = updatedResponse.integration;
      updated = true;
    }
  }

  if (!integration) {
    throw new Error(
      "Set KONTEXT_INTEGRATION_ID or KONTEXT_INTEGRATION_NAME to attach an existing integration, or provide KONTEXT_CUSTOM_INTEGRATION_NAME, KONTEXT_CUSTOM_INTEGRATION_URL, and KONTEXT_SERVER_TOKEN to create or update a custom shared-token integration.",
    );
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
      "custom-integration-name": { type: "string" },
      "custom-integration-url": { type: "string" },
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
  const applicationId =
    values["application-id"] || process.env.KONTEXT_APPLICATION_ID;
  const applicationName =
    values["application-name"] || process.env.KONTEXT_APPLICATION_NAME;
  const createApplication =
    values["create-application"] ||
    process.env.KONTEXT_CREATE_APPLICATION === "true";
  const redirectUris = parseStringArray(
    "KONTEXT_APPLICATION_REDIRECT_URIS_JSON",
    values["application-redirect-uris"] ||
      process.env.KONTEXT_APPLICATION_REDIRECT_URIS_JSON,
    [],
  );
  const integrationId =
    values["integration-id"] || process.env.KONTEXT_INTEGRATION_ID;
  const integrationName =
    values["integration-name"] || process.env.KONTEXT_INTEGRATION_NAME;
  const customIntegrationName =
    values["custom-integration-name"] ||
    process.env.KONTEXT_CUSTOM_INTEGRATION_NAME;
  const customIntegrationUrl =
    values["custom-integration-url"] ||
    process.env.KONTEXT_CUSTOM_INTEGRATION_URL;
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

  const integrationResult = await resolveTargetIntegration({
    baseUrl,
    token,
    integrationId,
    integrationName,
    customIntegrationName,
    customIntegrationUrl,
    serverToken,
    validateIntegration,
  });

  const attachedNow = await ensureAttached({
    baseUrl,
    token,
    applicationId: applicationResult.application.id,
    integrationId: integrationResult.integration.id,
  });

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
      serverTokenConfigured:
        integrationResult.integration.serverTokenConfigured ?? false,
      created: integrationResult.created,
      updated: integrationResult.updated,
      attached: attachedNow ? "attached_now" : "already_attached",
      validation: integrationResult.validation,
    },
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
  console.log(
    `- Shared token configured: ${
      result.integration.serverTokenConfigured ? "yes" : "no"
    }`,
  );
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
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Failed to configure server credential integration.",
  );
  process.exit(1);
});
