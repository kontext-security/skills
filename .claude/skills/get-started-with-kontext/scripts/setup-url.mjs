#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";

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
    if (!url.host) {
      return null;
    }
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
  console.error(
    "Long-running Go setup requires a hosted git remote such as GitHub.",
  );
  process.exit(2);
}

const repoBasename = basename(parsed.path);
const repoFingerprint = createHash("sha256")
  .update(`${remote}\n${repoBasename}`)
  .digest("hex")
  .slice(0, 32);

const appUrl = (process.env.KONTEXT_APP_URL || "https://app.kontext.security").replace(
  /\/$/,
  "",
);
const url = new URL(`${appUrl}/get-started/setup`);
url.searchParams.set("repoFingerprint", repoFingerprint);
url.searchParams.set("repoBasename", repoBasename);
url.searchParams.set("gitRemoteHost", parsed.host);
url.searchParams.set("gitRemotePath", parsed.path);
const providerSuggestions = scanProviderSuggestions();
if (providerSuggestions.length > 0) {
  url.searchParams.set("providerSuggestions", JSON.stringify(providerSuggestions));
}

console.log(
  JSON.stringify(
    {
      browserUrl: url.toString(),
      repoFingerprint,
      repoBasename,
      gitRemoteHost: parsed.host,
      gitRemotePath: parsed.path,
      providerSuggestions,
    },
    null,
    2,
  ),
);

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
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (entry.endsWith(".go")) {
      files.push(full);
    }
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
    const current = suggestions.get(suggestion.handle) || {
      ...suggestion,
      env: [],
      files: [],
    };
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
    if (pattern.test(envName)) {
      return { displayName, handle, authMethod: "org_key" };
    }
  }
  const base = envName
    .replace(/_(API_KEY|TOKEN|ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/, "")
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  const displayName = base
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    displayName: displayName || envName,
    handle: base.join("-") || envName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    authMethod: "org_key",
  };
}
