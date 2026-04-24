# Kontext Skills

One public onboarding skill for Kontext v1.

## Install

```bash
npx skills add kontext-security/skills
```

If you want a non-interactive install for all supported agents:

```bash
npx skills add kontext-security/skills --all
```

Then tell your agent:

```text
Use the Get Started with Kontext skill.
```

## Public Skill

### get-started-with-kontext

Sets up exactly one of:

1. Claude Code on this machine
2. Long-running Go agent in this repo

Claude Code setup is macOS-only in v1 and uses `kontext-cli`.

Long-running Go setup is for Anthropic Go SDK agents. It opens one browser setup session, creates or repairs the runtime app, lets you choose the custom provider for the agent, and patches supported Go repos with the exact selected provider handle.

Runtime secrets are revealed only in the browser setup page. They are not written to the repo or echoed into the agent transcript.
