#!/usr/bin/env bash
set -euo pipefail

inside_git_repo=false
gt_installed=false
repo_initialized=false
enabled=false
git_dir=""
trunk_branch=""

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  inside_git_repo=true
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
fi

if command -v gt >/dev/null 2>&1; then
  gt_installed=true
fi

if [ "$inside_git_repo" = true ] && [ -n "$git_dir" ] && [ -f "$git_dir/.graphite_repo_config" ]; then
  repo_initialized=true

  if command -v rg >/dev/null 2>&1; then
    trunk_branch="$(rg -o --no-line-number '"trunk"\s*:\s*"[^"]+"' "$git_dir/.graphite_repo_config" 2>/dev/null | head -n1 | sed -E 's/.*"trunk"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
    if [ -z "$trunk_branch" ]; then
      trunk_branch="$(rg -o --no-line-number 'trunk\s*=\s*"?[A-Za-z0-9._/-]+"?' "$git_dir/.graphite_repo_config" 2>/dev/null | head -n1 | sed -E 's/.*trunk[[:space:]]*=[[:space:]]*"?([^" ]+)"?.*/\1/' || true)"
    fi
  else
    trunk_branch="$(grep -Eo '"trunk"[[:space:]]*:[[:space:]]*"[^"]+"' "$git_dir/.graphite_repo_config" 2>/dev/null | head -n1 | sed -E 's/.*"trunk"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
    if [ -z "$trunk_branch" ]; then
      trunk_branch="$(grep -Eo 'trunk[[:space:]]*=[[:space:]]*"?[A-Za-z0-9._/-]+"?' "$git_dir/.graphite_repo_config" 2>/dev/null | head -n1 | sed -E 's/.*trunk[[:space:]]*=[[:space:]]*"?([^" ]+)"?.*/\1/' || true)"
    fi
  fi
fi

if [ "$inside_git_repo" = true ] && [ "$gt_installed" = true ] && [ "$repo_initialized" = true ]; then
  enabled=true
fi

echo "enabled=$enabled"
echo "inside_git_repo=$inside_git_repo"
echo "gt_installed=$gt_installed"
echo "repo_initialized=$repo_initialized"

if [ -n "$git_dir" ]; then
  echo "git_dir=$git_dir"
fi

if [ -n "$trunk_branch" ]; then
  echo "trunk_branch=$trunk_branch"
fi
