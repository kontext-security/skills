# The Three-Layer Stack

Skills, MCP, and Kontext are complementary layers — not competitors.

```
┌─────────────────────────────────────────────────────────────┐
│  SKILLS                                                     │
│  What to do                                                 │
│  ─────────────────────────────────────────────────────────  │
│  • Domain knowledge (brand voice, business rules)           │
│  • Workflows (how to triage, how to deploy)                 │
│  • Procedures (step-by-step processes)                      │
│  • Output formats (templates, schemas)                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP (Model Context Protocol)                               │
│  How to access tools                                        │
│  ─────────────────────────────────────────────────────────  │
│  • Tool discovery (what's available)                        │
│  • Schema definition (what params, what returns)            │
│  • Transport (stdio, HTTP, SSE)                             │
│  • Protocol standardization (interop across tools)          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  KONTEXT                                                    │
│  Identity Control Plane                                     │
│  ─────────────────────────────────────────────────────────  │
│  • User Authorization (OAuth with PKCE, user consent)       │
│  • Secure Credentials (encrypted vault, runtime injection)  │
│  • Audit Trail (every tool call logged)                     │
│  • MCP Protocol (works with any client, any LLM)            │
└─────────────────────────────────────────────────────────────┘
```

## Why All Three?

### Skills without MCP
The agent knows *what* to do but can't *do* anything. It can write a perfect issue description but can't create the issue in Linear.

### MCP without Skills
The agent can call tools but doesn't know *when* or *how*. It has access to Linear but doesn't know your triage workflow or priority rules.

### MCP without Kontext
The agent can call tools but:
- Auth is hardcoded (`LINEAR_API_KEY=sk_live_xxx`)
- No visibility into what it's doing
- No user consent — just a static key
- No audit trail
- Works in demos, breaks in production

### The Full Stack
```
Skill: "When a user reports a bug, create a Linear issue..."
  │
  ▼
MCP: linear.create_issue(title, description, priority, team)
  │
  ▼
Kontext: User authorized → token injected → call logged → scoped access
```

## Traditional Auth vs Kontext

| Feature | Traditional | Kontext |
|---------|-------------|---------|
| Trust Anchor | Static API Key | User Consent (OAuth) |
| Credential Storage | Env var (plaintext) | Encrypted Vault (Managed) |
| Access | Permanent until revoked | Scoped & Audited |
| Scope | All or Nothing | Per-Integration |

## The Production Gap

Everyone debates Skills vs MCP. But both assume auth is solved.

**The real questions:**
- Where do credentials come from?
- Who authorized this access?
- What did the agent actually do?
- How do I revoke access?

**Kontext answers:**
- Credentials from encrypted vault, injected at runtime
- User authorized via OAuth with PKCE
- Every tool call logged with full audit trail
- Revoke per-user, per-integration, instantly

## The Narrative

> "Skills tell the agent what to do. MCP gives access to tools. Kontext handles identity — OAuth, credentials, audit — so you don't have to."

Or the one-liner:

> "Stop sharing your GH_TOKEN with robots."

## Code Comparison

```typescript
// ❌ Traditional: hardcoded key, no audit, full access forever
LINEAR_API_KEY=sk_live_xxx npx mcporter call linear.create_issue ...

// ✓ Kontext: user-consented, scoped, audited, revocable
import { KontextMcp } from '@kontext-dev/sdk';

const kontext = new KontextMcp({
  clientId: 'your-client-id',
  redirectUri: 'http://localhost:3333/callback',
  onAuthRequired: async (authUrl) => {
    await open(authUrl.toString());
    return await waitForCallback();
  },
});

// User authorizes once, then agent can call tools
const tools = await kontext.listTools();
const result = await kontext.callTool('github_list_repos', { owner: 'acme' });
// → Every call logged, scoped to what user authorized
```
