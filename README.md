# Kontext Skills

Claude Code skills for Kontext.dev workflows.

## Installation

Clone this repo into your Claude Code skills directory:

```bash
git clone https://github.com/kontext-dev/kontext-skills.git ~/.claude/skills
```

Or if you already have a skills directory, clone and copy:

```bash
git clone https://github.com/kontext-dev/kontext-skills.git /tmp/kontext-skills
cp -r /tmp/kontext-skills/* ~/.claude/skills/
```

Skills are automatically detected by Claude Code on next conversation.

## Available Skills

### brand-writer

Write and refine content for Kontext.dev in the brand voice.

**Triggers on**: Requests to write, edit, or improve website copy, blog posts, marketing emails, taglines, or CTAs.

**Core message**: "From demo to deployment. For agents."

**Usage**: Just ask Claude to write or improve Kontext content. The skill loads automatically.

---

### kontext-mcp

Explain how Skills, MCP, and Kontext work together as complementary layers.

**Triggers on**: Questions about Skills vs MCP, agent architecture, or how Kontext fits with MCP servers.

**Core narrative**: "Skills tell the agent what to do. MCP gives access to tools. Kontext makes sure those tools are safe to use in production."

**Usage**: Ask about Skills vs MCP, agent governance, or how to make MCP calls production-ready.

---

### data-deducer

Analyze unfamiliar datasets to discover what's interesting, then write and execute code to explore and visualize findings.

**Triggers on**: "analyze this data," "what's interesting in this dataset," "explore this dataset," or any request to discover patterns in data you haven't explored yet.

**Accepts**: Any URL, HuggingFace dataset ID, or local file (CSV, Parquet, JSON, NDJSON, XLSX, TSV, or unknown formats).

**Usage**: Point it at a dataset and it will profile the data, reason about what's interesting, write investigation code on the fly, and present the most surprising findings with visualizations.
