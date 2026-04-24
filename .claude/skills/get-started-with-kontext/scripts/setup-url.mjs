#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";

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

console.log(
  JSON.stringify(
    {
      browserUrl: url.toString(),
      repoFingerprint,
      repoBasename,
      gitRemoteHost: parsed.host,
      gitRemotePath: parsed.path,
    },
    null,
    2,
  ),
);
