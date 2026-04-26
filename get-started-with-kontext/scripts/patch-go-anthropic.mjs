#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const statePath = ".kontext-setup-state.json";
if (!existsSync(statePath)) {
  console.error("Missing .kontext-setup-state.json. Run run-local-setup.mjs first.");
  process.exit(2);
}

const setupState = JSON.parse(readFileSync(statePath, "utf8"));
const setupMode = setupState.setupMode || (setupState.selectedProviderHandle ? "credential_injection" : "telemetry_only");
const providerHandle = setupState.selectedProviderHandle;
if (setupMode === "credential_injection" && (!providerHandle || typeof providerHandle !== "string")) {
  console.error("Setup did not record a selected provider handle.");
  process.exit(2);
}

const goFiles = walk(process.cwd());
const target = goFiles.find((file) => {
  const text = readFileSync(file, "utf8");
  return (
    !/Code generated|DO NOT EDIT/i.test(text.slice(0, 600)) &&
    text.includes("github.com/anthropics/anthropic-sdk-go") &&
    text.includes("anthropic.NewClient") &&
    (text.includes("option.WithAPIKey") ||
      text.includes("ANTHROPIC_API_KEY") ||
      text.includes("github.com/kontext-security/kontext-go"))
  );
});

if (!target) {
  console.error(
    "No supported Anthropic Go SDK credential shape found. Expected anthropic.NewClient with option.WithAPIKey or ANTHROPIC_API_KEY.",
  );
  process.exit(2);
}

execFileSync("go", ["get", "github.com/kontext-security/kontext-go@v0.3.0"], {
  stdio: "inherit",
});

ensureGitignore();
patchFile(target, providerHandle, setupMode);

execFileSync("gofmt", ["-w", target], { stdio: "inherit" });
execFileSync("go", ["mod", "tidy"], { stdio: "inherit" });
execFileSync("go", ["test", "./..."], { stdio: "inherit" });

console.log(
  JSON.stringify(
    {
      patchedFiles: [target],
      setupMode,
      providerHandle: providerHandle || null,
      runtimeEnvFile: setupState.envFile || ".env",
      tests: "passed",
    },
    null,
    2,
  ),
);

function patchFile(file, handle, mode) {
  let text = readFileSync(file, "utf8");
  if (text.includes("github.com/kontext-security/kontext-go")) {
    if (mode === "credential_injection") {
      text = ensureProviderConst(text, handle);
      text = ensureCredentialConfig(text);
      text = patchClient(text, mode);
      text = patchToolBoundary(text);
      text = removeUnusedOptionImport(text);
    } else {
      text = ensureOptionImport(text);
      text = removeCredentialConfig(text);
      text = patchClient(text, mode);
      text = patchToolBoundary(text);
      text = removeProviderConst(text);
    }
    writeFileSync(file, text);
    return;
  }

  text = patchImports(text, mode);
  if (mode === "credential_injection") {
    text = insertProviderConst(text, handle);
  }
  text = patchRunFunction(text, mode);
  text = patchClient(text, mode);
  text = patchToolBoundary(text);
  if (mode === "credential_injection") {
    text = removeUnusedOptionImport(text);
  }
  writeFileSync(file, text);
}

function patchImports(text, mode) {
  if (mode === "credential_injection") {
    text = text.replace(/\n\s*"github\.com\/anthropics\/anthropic-sdk-go\/option"\n/, "\n");
  }
  const importBlock = text.match(/import\s*\(([\s\S]*?)\)/);
  if (!importBlock) {
    throw new Error("Only import blocks are supported for v1 Go patching.");
  }
  let imports = importBlock[1];
  if (!imports.includes("github.com/kontext-security/kontext-go")) {
    imports += '\n\tkontext "github.com/kontext-security/kontext-go"';
  }
  if (!imports.includes("github.com/kontext-security/kontext-go/anthropic")) {
    imports += '\n\tkxanthropic "github.com/kontext-security/kontext-go/anthropic"';
  }
  return text.replace(importBlock[0], `import (${imports}\n)`);
}

function ensureOptionImport(text) {
  if (text.includes('"github.com/anthropics/anthropic-sdk-go/option"')) return text;
  const importBlock = text.match(/import\s*\(([\s\S]*?)\)/);
  if (!importBlock) {
    throw new Error("Only import blocks are supported for v1 Go patching.");
  }
  return text.replace(importBlock[0], `import (${importBlock[1]}\n\t"github.com/anthropics/anthropic-sdk-go/option"\n)`);
}

function insertProviderConst(text, handle) {
  const importBlock = text.match(/import\s*\([\s\S]*?\)\n/);
  if (!importBlock) throw new Error("Import block disappeared during patching.");
  return text.replace(importBlock[0], `${importBlock[0]}\nconst anthropicProviderHandle = "${handle}"\n`);
}

function ensureProviderConst(text, handle) {
  if (/const anthropicProviderHandle = "[^"]+"/.test(text)) {
    return text.replace(/const anthropicProviderHandle = "[^"]+"/, `const anthropicProviderHandle = "${handle}"`);
  }
  return insertProviderConst(text, handle);
}

function removeProviderConst(text) {
  return text.replace(/\nconst anthropicProviderHandle = "[^"]+"\n/, "\n");
}

function ensureCredentialConfig(text) {
  if (text.includes("Credentials: kontext.CredentialsConfig")) return text;
  const urlLine = '\t\tURL:          os.Getenv("KONTEXT_URL"),\n';
  if (!text.includes(urlLine)) {
    throw new Error("Expected kontext.Config URL line when enabling credential injection.");
  }
  return text.replace(
    urlLine,
    `${urlLine}\t\tCredentials: kontext.CredentialsConfig{
\t\t\tMode:      kontext.CredentialModeProvide,
\t\t\tProviders: []kontext.Provider{anthropicProviderHandle},
\t\t},
`,
  );
}

function removeCredentialConfig(text) {
  return text.replace(
    /\n\t\tCredentials: kontext\.CredentialsConfig\{\n\t\t\tMode:\s+kontext\.CredentialModeProvide,\n\t\t\tProviders: \[\]kontext\.Provider\{anthropicProviderHandle\},\n\t\t},/,
    "",
  );
}

function patchRunFunction(text, mode) {
  const marker = "func Run(ctx context.Context, prompt string) (string, error) {\n";
  if (!text.includes(marker)) {
    throw new Error("Supported v1 patching expects func Run(ctx context.Context, prompt string) (string, error).");
  }
  const serviceName = sanitizeServiceName(setupState.repoBasename || "go-agent");
  const credentialsBlock =
    mode === "credential_injection"
      ? `\t\tCredentials: kontext.CredentialsConfig{
\t\t\tMode:      kontext.CredentialModeProvide,
\t\t\tProviders: []kontext.Provider{anthropicProviderHandle},
\t\t},
`
      : "";
  const bootstrap = `${marker}\tkx, err := kontext.Start(ctx, kontext.Config{
\t\tServiceName:  "${serviceName}",
\t\tEnvironment:  "local",
\t\tClientID:     os.Getenv("KONTEXT_CLIENT_ID"),
\t\tClientSecret: os.Getenv("KONTEXT_CLIENT_SECRET"),
\t\tURL:          os.Getenv("KONTEXT_URL"),
${credentialsBlock}
\t})
\tif err != nil {
\t\treturn "", err
\t}
\tdefer kx.End(ctx)

`;
  return text.replace(marker, bootstrap);
}

function patchClient(text, mode) {
  if (mode === "telemetry_only") {
    text = removeAnthropicCredentialInjectionOption(text);
    text = ensureAnthropicEnvAPIKeyOption(text);
    return insertAnthropicClientOption(text, "kxanthropic.WithRequestTelemetry(kx)");
  }
  text = removeAnthropicEnvAPIKeyOption(text);
  text = insertAnthropicClientOption(text, "kxanthropic.WithCredentialsFor(kx, anthropicProviderHandle)");
  return insertAnthropicClientOption(text, "kxanthropic.WithRequestTelemetry(kx)");
}

function insertAnthropicClientOption(text, optionCall) {
  if (text.includes(optionCall)) return text;
  const start = text.indexOf("anthropic.NewClient(");
  if (start === -1) {
    throw new Error("Expected anthropic.NewClient call.");
  }
  const argsStart = start + "anthropic.NewClient(".length;
  return `${text.slice(0, argsStart)}\n\t\t${optionCall},${text.slice(argsStart)}`;
}

function removeAnthropicEnvAPIKeyOption(text) {
  return text.replace(
    /\n?\s*option\.WithAPIKey\(\s*os\.Getenv\("ANTHROPIC_API_KEY"\)\s*\),?/,
    "",
  );
}

function ensureAnthropicEnvAPIKeyOption(text) {
  if (text.includes('option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY"))')) return text;
  return insertAnthropicClientOption(text, 'option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY"))');
}

function removeAnthropicCredentialInjectionOption(text) {
  return text.replace(
    /\n?\s*kxanthropic\.WithCredentialsFor\(kx,\s*anthropicProviderHandle\),?/,
    "",
  );
}

function removeUnusedOptionImport(text) {
  if (text.includes("option.")) return text;
  return text.replace(/\n\s*"github\.com\/anthropics\/anthropic-sdk-go\/option"\n/, "\n");
}

function patchToolBoundary(text) {
  return text.replace(
    /result, toolErr := dispatchTool\(ctx, block\.Name, block\.Input\)/,
    `result, toolErr := kxanthropic.ObserveTool(ctx, kx, block.Name, block.Input, func(toolCtx context.Context) (string, error) {
\t\t\t\treturn dispatchTool(toolCtx, block.Name, block.Input)
\t\t\t})`,
  );
}

function ensureGitignore() {
  let text = "";
  try {
    text = readFileSync(".gitignore", "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/).filter((line, index, arr) => !(line === "" && index === arr.length - 1));
  for (const line of [
    setupState.envFile || ".env",
    ".env",
    ".env.*",
    "!.env.example",
    ".kontext-setup-state.json",
  ]) {
    if (!lines.includes(line)) lines.push(line);
  }
  writeFileSync(".gitignore", `${lines.join("\n")}\n`);
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

function sanitizeServiceName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "go-agent";
}
