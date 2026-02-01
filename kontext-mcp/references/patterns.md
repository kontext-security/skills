# Patterns for Skill Developers

How to build skills that use MCP tools through Kontext.

## Pattern 1: Skills Should Not Contain Credentials

❌ **Bad: Credentials in skill**
```markdown
# Linear Triage Skill

Set LINEAR_API_KEY=sk_live_xxx before running...
```

✓ **Good: Skill assumes auth is handled**
```markdown
# Linear Triage Skill

Prerequisites: User has authorized Linear via Kontext.

## Workflow
1. Fetch open issues: linear.list_issues
2. Assess priority based on severity
3. Create issue: linear.create_issue
```

The skill defines *what* to do. Kontext handles *how* to authenticate.

## Pattern 2: User Authorization Flow

When your skill needs access to external services:

```typescript
import { KontextMcp } from '@kontext-dev/sdk';
import { toAiSdkTools } from '@kontext-dev/sdk/ai';

// Initialize Kontext
const kontext = new KontextMcp({
  clientId: 'your-client-id',
  redirectUri: 'http://localhost:3333/callback',
  onAuthRequired: async (authUrl) => {
    // Opens browser for user to authorize
    await open(authUrl.toString());
    return await waitForCallback();
  },
});

// Get tools as AI SDK format
const tools = await toAiSdkTools(kontext);

// Use with any LLM
const result = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'List my GitHub repositories',
  maxSteps: 5,
});
```

User authorizes once. Agent gets scoped tokens. Every call logged.

## Pattern 3: Multi-Integration Skills

Skills that span multiple services still use a single Kontext client:

```markdown
# Deploy and Notify Skill

## Workflow
1. github.create_pull_request
2. github.merge_pull_request
3. slack.post_message
4. linear.update_issue

All calls go through Kontext — user authorized each integration separately.
```

```typescript
const kontext = new KontextMcp({ /* config */ });

// All integrations available through one client
await kontext.callTool('github_create_pull_request', { ... });
await kontext.callTool('slack_post_message', { ... });
await kontext.callTool('linear_update_issue', { ... });

// → Each call uses the token for that integration
// → Each call logged to audit trail
```

## Pattern 4: Scoped Access

Traditional approach: Agent gets full access to everything.

Kontext approach: Agent gets only what user authorized, per-integration.

```
User authorizes:
├── GitHub: read repos, write issues (not delete)
├── Linear: read/write issues (ENG team only)
└── Slack: post to #engineering (not #general)

Agent can only access what's scoped.
```

## Pattern 5: Audit Trail

Every tool call through Kontext is logged:

```
Agent: deploy-bot
Session: abc-123

14:32:01  github.list_repos         ✓   120ms
14:32:02  github.create_pr          ✓   340ms
14:32:03  slack.post_message        ✓    45ms
```

No extra code needed. Audit happens automatically.

## Pattern 6: mcporter + Kontext (Future)

Today, mcporter handles OAuth caching per-server:
```bash
npx mcporter auth linear
npx mcporter call linear.create_issue ...
```

With Kontext integration (coming):
```bash
# Kontext handles auth, credentials, audit
npx mcporter --kontext call linear.create_issue ...
```

Same mcporter CLI, but credentials from Kontext vault, every call audited.

## Anti-Patterns

### ❌ Hardcoding API keys
```bash
LINEAR_API_KEY=sk_live_xxx npx mcporter call linear...
```

### ❌ Storing credentials in skill files
```markdown
## Setup
Add your API key to .env: GITHUB_TOKEN=ghp_xxx
```

### ❌ Assuming full access
```markdown
This skill will access all your GitHub repos...
```

### ✓ User-consented, scoped access
```markdown
Prerequisites: Authorize GitHub via Kontext (repos you select).
```

## The Skill Developer Mindset

1. **Skills define workflows** — what to do, when, in what order
2. **MCP provides tool access** — discovery, schemas, calling
3. **Kontext handles identity** — OAuth, credentials, audit

Your skill should never touch credentials directly. Assume Kontext is handling it.
