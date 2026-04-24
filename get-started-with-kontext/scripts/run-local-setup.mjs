#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";

const appUrl = (process.env.KONTEXT_APP_URL || "https://app.kontext.security").replace(/\/$/, "");
const timeoutMs = Number(process.env.KONTEXT_SETUP_TIMEOUT_MS || 15 * 60 * 1000);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseRemote(raw) {
  const value = raw.trim();
  let host = "";
  let path = "";
  if (value.startsWith("git@")) {
    const match = value.match(/^git@([^:]+):(.+)$/);
    host = match?.[1] || "";
    path = match?.[2] || "";
  } else {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!url.host) return null;
    host = url.host;
    path = url.pathname.replace(/^\/+/, "");
  }
  path = path.replace(/\.git$/, "");
  return { host, path };
}

let remote = "";
try {
  remote = git(["config", "--get", "remote.origin.url"]);
} catch {
  console.error("Long-running Go setup requires a git remote. Add one and rerun this skill.");
  process.exit(2);
}

const parsed = parseRemote(remote);
if (!parsed) {
  console.error("Long-running Go setup requires a hosted git remote such as GitHub.");
  process.exit(2);
}

const repoBasename = basename(parsed.path);
const repoFingerprint = createHash("sha256")
  .update(`${remote}\n${repoBasename}`)
  .digest("hex")
  .slice(0, 32);
const nonce = randomBytes(24).toString("base64url");
const allowedCallbackOrigins = new Set([
  new URL(appUrl).origin,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedCallbackOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/kontext/setup/complete") {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64_000) req.destroy();
  });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body);
      if (payload.nonce !== nonce) {
        res.writeHead(403);
        res.end("invalid nonce");
        return;
      }
      const env = payload.runtimeEnv || {};
      const required = ["KONTEXT_CLIENT_ID", "KONTEXT_CLIENT_SECRET", "KONTEXT_URL"];
      for (const key of required) {
        if (typeof env[key] !== "string" || env[key].trim() === "") {
          res.writeHead(400);
          res.end(`missing ${key}`);
          return;
        }
      }

      const envFile = selectEnvFile();
      upsertEnvFile(envFile, {
        KONTEXT_CLIENT_ID: env.KONTEXT_CLIENT_ID,
        KONTEXT_CLIENT_SECRET: env.KONTEXT_CLIENT_SECRET,
        KONTEXT_URL: env.KONTEXT_URL,
      });
      chmodSync(envFile, 0o600);
      ensureGitignore(envFile);

      const state = {
        selectedProviderHandle: payload.selectedProviderHandle || null,
        selectedProviderDisplayName: payload.selectedProviderDisplayName || null,
        runtimeAppName: payload.runtimeAppName || null,
        envFile,
        repoBasename,
        gitRemoteHost: parsed.host,
        gitRemotePath: parsed.path,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(".kontext-setup-state.json", `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Kontext setup saved.</h1><p>Return to your agent.</p>");
      console.log(`\nUpdated ${envFile} for provider: ${state.selectedProviderHandle || "unknown"}`);
      console.log("Return to the agent. It will patch and verify the Go repo now.");
      server.close(() => process.exit(0));
    } catch (err) {
      res.writeHead(400);
      res.end(err instanceof Error ? err.message : "invalid request");
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("Failed to start local setup receiver.");
    process.exit(1);
  }
  const callbackUrl = `http://127.0.0.1:${address.port}/kontext/setup/complete`;
  const url = new URL(`${appUrl}/get-started/setup`);
  url.searchParams.set("repoFingerprint", repoFingerprint);
  url.searchParams.set("repoBasename", repoBasename);
  url.searchParams.set("gitRemoteHost", parsed.host);
  url.searchParams.set("gitRemotePath", parsed.path);
  url.searchParams.set("providerSuggestions", JSON.stringify(scanProviderSuggestions()));
  url.searchParams.set("localCallbackUrl", callbackUrl);
  url.searchParams.set("localCallbackNonce", nonce);

  console.log("Open this setup URL in your browser:");
  console.log(url.toString());
  console.log("");
  console.log("Waiting for the browser to save the runtime env file...");
});

const timer = setTimeout(() => {
  console.error("Timed out waiting for browser setup.");
  server.close(() => process.exit(1));
}, timeoutMs);
timer.unref?.();

function selectEnvFile() {
  for (const candidate of [".env", ".env.local", ".env.development", ".env.kontext"]) {
    if (existsSync(candidate)) return candidate;
  }
  return ".env";
}

function upsertEnvFile(path, values) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const next = lines
    .filter((line, index) => !(line === "" && index === lines.length - 1))
    .map((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      if (!match || !(match[1] in values)) return line;
      seen.add(match[1]);
      return `${match[1]}=${values[match[1]]}`;
    });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  writeFileSync(path, `${next.join("\n")}\n`, { mode: 0o600 });
}

function ensureGitignore(envFile) {
  let text = "";
  try {
    text = readFileSync(".gitignore", "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/).filter((line, index, arr) => !(line === "" && index === arr.length - 1));
  for (const line of [envFile, ".env", ".env.*", "!.env.example", ".kontext-setup-state.json"]) {
    if (!lines.includes(line)) lines.push(line);
  }
  writeFileSync(".gitignore", `${lines.join("\n")}\n`);
}

function scanProviderSuggestions() {
  const credentialUses = new Map();
  for (const file of walk(process.cwd())) {
    const text = readFileSync(file, "utf8");
    if (/Code generated|DO NOT EDIT/i.test(text.slice(0, 600))) continue;
    for (const envName of findCredentialEnvNames(text)) {
      const current = credentialUses.get(envName) || { envName, files: [] };
      current.files.push(file);
      credentialUses.set(envName, current);
    }
  }
  return providerSuggestionsFromCredentials(Array.from(credentialUses.values()));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === ".git" ||
      entry === "vendor" ||
      entry === "node_modules" ||
      entry === ".claude" ||
      entry === ".agents"
    ) {
      continue;
    }
    const full = `${dir}/${entry}`;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (entry.endsWith(".go")) files.push(full);
  }
  return files;
}

function findCredentialEnvNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/os\.Getenv\(\s*"([^"]+)"\s*\)/g)) {
    if (isCredentialEnvName(match[1])) names.add(match[1]);
  }
  for (const match of text.matchAll(/"([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|TOKEN))"/g)) {
    if (isCredentialEnvName(match[1])) names.add(match[1]);
  }
  return [...names];
}

function isCredentialEnvName(name) {
  if (!name || name.startsWith("KONTEXT_")) return false;
  return (
    name.endsWith("_API_KEY") ||
    name.endsWith("_TOKEN") ||
    name === "AWS_ACCESS_KEY_ID" ||
    name === "AWS_SECRET_ACCESS_KEY"
  );
}

function providerSuggestionsFromCredentials(uses) {
  const suggestions = new Map();
  for (const use of uses) {
    const suggestion = providerSuggestionForEnv(use.envName);
    const current = suggestions.get(suggestion.handle) || { ...suggestion, env: [], files: [] };
    current.env.push(use.envName);
    current.files.push(...use.files);
    suggestions.set(suggestion.handle, current);
  }
  return [...suggestions.values()].map((suggestion) => ({
    ...suggestion,
    env: [...new Set(suggestion.env)].sort(),
    files: [...new Set(suggestion.files)].sort(),
  }));
}

function providerSuggestionForEnv(envName) {
  const known = [
    [/^ANTHROPIC_API_KEY$/, "Anthropic", "anthropic"],
    [/^OPENAI_API_KEY$/, "OpenAI", "openai"],
    [/^(GOOGLE|GEMINI)_API_KEY$/, "Google Gemini", "google-gemini"],
    [/^GROQ_API_KEY$/, "Groq", "groq"],
    [/^MISTRAL_API_KEY$/, "Mistral", "mistral"],
    [/^COHERE_API_KEY$/, "Cohere", "cohere"],
    [/^FIREWORKS_API_KEY$/, "Fireworks", "fireworks"],
    [/^TOGETHER_API_KEY$/, "Together AI", "together-ai"],
    [/^XAI_API_KEY$/, "xAI", "xai"],
    [/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/, "Amazon Bedrock", "amazon-bedrock"],
  ];
  for (const [pattern, displayName, handle] of known) {
    if (pattern.test(envName)) return { displayName, handle, authMethod: "org_key" };
  }
  const base = envName
    .replace(/_(API_KEY|TOKEN|ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/, "")
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  return {
    displayName: base.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || envName,
    handle: base.join("-") || envName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    authMethod: "org_key",
  };
}
