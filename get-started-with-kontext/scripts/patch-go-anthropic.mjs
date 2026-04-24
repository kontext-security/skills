#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const statePath = ".kontext-setup-state.json";
if (!existsSync(statePath)) {
  console.error("Missing .kontext-setup-state.json. Run run-local-setup.mjs first.");
  process.exit(2);
}

const setupState = JSON.parse(readFileSync(statePath, "utf8"));
const providerHandle = setupState.selectedProviderHandle;
if (!providerHandle || typeof providerHandle !== "string") {
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
patchFile(target, providerHandle);

execFileSync("gofmt", ["-w", target], { stdio: "inherit" });
execFileSync("go", ["mod", "tidy"], { stdio: "inherit" });
execFileSync("go", ["test", "./..."], { stdio: "inherit" });

console.log(
  JSON.stringify(
    {
      patchedFiles: [target],
      providerHandle,
      runtimeEnvFile: setupState.envFile || ".env",
      tests: "passed",
    },
    null,
    2,
  ),
);

function patchFile(file, handle) {
  let text = readFileSync(file, "utf8");
  if (text.includes("github.com/kontext-security/kontext-go")) {
    writeFileSync(file, text.replace(/const anthropicProviderHandle = "[^"]+"/, `const anthropicProviderHandle = "${handle}"`));
    return;
  }

  text = patchImports(text);
  text = insertProviderConst(text, handle);
  text = patchRunFunction(text);
  text = patchClient(text);
  text = patchToolBoundary(text);
  writeFileSync(file, text);
}

function patchImports(text) {
  text = text.replace(/\n\s*"github\.com\/anthropics\/anthropic-sdk-go\/option"\n/, "\n");
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

function insertProviderConst(text, handle) {
  const importBlock = text.match(/import\s*\([\s\S]*?\)\n/);
  if (!importBlock) throw new Error("Import block disappeared during patching.");
  return text.replace(importBlock[0], `${importBlock[0]}\nconst anthropicProviderHandle = "${handle}"\n`);
}

function patchRunFunction(text) {
  const marker = "func Run(ctx context.Context, prompt string) (string, error) {\n";
  if (!text.includes(marker)) {
    throw new Error("Supported v1 patching expects func Run(ctx context.Context, prompt string) (string, error).");
  }
  const serviceName = sanitizeServiceName(setupState.repoBasename || "go-agent");
  const bootstrap = `${marker}\tkx, err := kontext.Start(ctx, kontext.Config{
\t\tServiceName:  "${serviceName}",
\t\tEnvironment:  "local",
\t\tClientID:     os.Getenv("KONTEXT_CLIENT_ID"),
\t\tClientSecret: os.Getenv("KONTEXT_CLIENT_SECRET"),
\t\tURL:          os.Getenv("KONTEXT_URL"),
\t\tCredentials: kontext.CredentialsConfig{
\t\t\tMode:      kontext.CredentialModeProvide,
\t\t\tProviders: []kontext.Provider{anthropicProviderHandle},
\t\t},
\t})
\tif err != nil {
\t\treturn "", err
\t}
\tdefer kx.End(ctx)

`;
  return text.replace(marker, bootstrap);
}

function patchClient(text) {
  return text.replace(
    /anthropic\.NewClient\(\s*option\.WithAPIKey\(os\.Getenv\("ANTHROPIC_API_KEY"\)\),?\s*\)/,
    `anthropic.NewClient(
\t\tkxanthropic.WithCredentialsFor(kx, anthropicProviderHandle),
\t\tkxanthropic.WithRequestTelemetry(kx),
\t)`,
  );
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
