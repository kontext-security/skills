---
name: kontext-mcp
description: Explain how Kontext works with MCP and Skills as complementary layers. Use when discussing agent auth, MCP integration, credential management for agents, or how to make MCP calls production-ready without hardcoding API keys. Triggers on questions about agent identity, OAuth for agents, or Kontext positioning.
---

# Kontext + MCP + Skills

Kontext is the **Identity Control Plane for AI Applications**. It handles OAuth, credential vaulting, and audit trails so developers can focus on building.

## Quick Positioning

**The problem**: Every team building AI applications hits the same wall — agents need access to external services, but hardcoding API keys is insecure, managing OAuth is painful, and security teams block deployment because there's no visibility.

**The solution**: Stop sharing your GH_TOKEN with robots. Kontext provides secure, just-in-time infrastructure for AI applications to access user data.

**The tagline**: "You handle the logic; we handle OAuth, credential vaulting, and audit trails."

## The Three-Layer Stack

```
Skills   → What to do (knowledge, workflows, procedures)
MCP      → How to access tools (protocol, discovery, schemas)
Kontext  → Identity control plane (OAuth, credentials, audit)
```

See [architecture.md](references/architecture.md) for the full diagram.

## What Kontext Actually Does

Kontext sits between your AI applications and external integrations (GitHub, Linear, Slack, your APIs):

| Capability | What It Means |
|------------|---------------|
| **User Authorization** | OAuth with PKCE — users consent to what agents can access |
| **Secure Credentials** | Tokens stored in encrypted vault, injected at runtime |
| **Audit Trail** | Every tool call is logged |
| **MCP Protocol** | Works with any MCP client, any LLM framework |

### Traditional Auth vs Kontext

| Feature | Traditional | Kontext |
|---------|-------------|---------|
| Trust Anchor | Static API Key | User Consent (OAuth) |
| Credential Storage | Env var (plaintext) | Encrypted Vault |
| Access | Permanent until revoked | Scoped & Audited |
| Scope | All or Nothing | Per-Integration |

## For Skill Developers

If you're building skills that use MCP servers (via mcporter or directly), Kontext means:

1. **No API keys in skills** — Don't embed `LINEAR_API_KEY` in your skill
2. **User-consented access** — The user authorizes once, agent gets scoped tokens
3. **Automatic audit** — Every tool call logged without extra code
4. **Runtime injection** — Credentials injected when needed, not stored in code

### Example: Skill + mcporter + Kontext

```typescript
// Without Kontext: hardcoded key, no audit, full access
LINEAR_API_KEY=sk_live_xxx npx mcporter call linear.create_issue ...

// With Kontext: user-consented, scoped, audited
import { KontextMcp } from '@kontext-dev/sdk';

const kontext = new KontextMcp({
  clientId: 'your-client-id',
  redirectUri: 'http://localhost:3333/callback',
  onAuthRequired: async (authUrl) => {
    await open(authUrl.toString());
    return await waitForCallback();
  },
});

// User authorizes once, then:
const result = await kontext.callTool('linear_create_issue', {
  title: 'Bug report',
  team: 'ENG',
});
// → Logged, scoped, revocable
```

## When Explaining Kontext

1. **Start with the problem** — "Every team hits the same wall: agents need access but API keys are insecure"
2. **The one-liner** — "Stop sharing your GH_TOKEN with robots"
3. **What it does** — OAuth, credential vaulting, audit trails
4. **The comparison** — Static keys vs user consent, env vars vs encrypted vault
5. **For developers** — "You handle the logic; we handle the auth"

## References

- **Architecture diagram**: See [architecture.md](references/architecture.md)
- **Integration patterns**: See [patterns.md](references/patterns.md)
- **SDK docs**: https://docs.kontext.dev
