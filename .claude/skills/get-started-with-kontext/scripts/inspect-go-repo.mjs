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
    const url = new URL(value);
    host = url.host;
    path = url.pathname.replace(/^\/+/, "");
  }
  path = path.replace(/\.git$/, "");
  return { host, path };
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === ".git" ||
      entry === "vendor" ||
      entry === "node_modules" ||
      entry === ".claude"
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

let remote = "";
try {
  remote = git(["config", "--get", "remote.origin.url"]);
} catch {
  console.log(JSON.stringify({ ok: false, reason: "missing_git_remote" }, null, 2));
  process.exit(2);
}

const parsed = parseRemote(remote);
const repoBasename = basename(parsed.path);
const fingerprint = createHash("sha256")
  .update(`${remote}\n${repoBasename}`)
  .digest("hex")
  .slice(0, 32);

const goFiles = walk(process.cwd());
const hits = [];
const generated = [];
for (const file of goFiles) {
  const text = readFileSync(file, "utf8");
  if (/Code generated|DO NOT EDIT/i.test(text.slice(0, 600))) {
    generated.push(file);
    continue;
  }
  if (
    text.includes("github.com/anthropics/anthropic-sdk-go") ||
    text.includes("anthropic.NewClient") ||
    text.includes("option.WithAPIKey") ||
    text.includes("ANTHROPIC_API_KEY") ||
    text.includes("ProviderAnthropic")
  ) {
    hits.push(file);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      repo: {
        remote,
        repoFingerprint: fingerprint,
        repoBasename,
        gitRemoteHost: parsed.host,
        gitRemotePath: parsed.path,
      },
      supported: hits.length > 0,
      anthropicFiles: hits,
      skippedGeneratedFiles: generated,
      unsupportedReason:
        hits.length > 0
          ? undefined
          : "No supported Anthropic Go SDK credential shape was found.",
    },
    null,
    2,
  ),
);
