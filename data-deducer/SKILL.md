---
name: data-deducer
description: Analyze an unfamiliar dataset to discover what's interesting, then write and execute code to explore and visualize findings. Use when the user has a dataset (CSV, Parquet, HuggingFace, JSON) and doesn't know what questions to ask yet. Triggers on "analyze this data," "what's interesting in this dataset," "explore this dataset," "deduce insights," "profile this data," or any request to discover patterns in data the user hasn't explored yet.
---

# Data Deducer

Discover what's interesting in a dataset, then write code to prove it.

## Workflow

### Phase 1: Profile

Run `scripts/profile.py` to get a structured profile of the dataset:

```bash
uv run scripts/profile.py <source> [--config CONFIG] [--split SPLIT]
```

The script accepts whatever the user throws at it:
- Any URL: `https://huggingface.co/datasets/evalstate/mcp-clients`, `https://example.com/data.csv`
- HuggingFace dataset ID: `evalstate/mcp-clients --config deduplicated --split deduplicated`
- Local file (any format): `./data.csv`, `./data.parquet`, `./data.json`, `./data.xlsx`, `./mystery_file`

HuggingFace URLs auto-extract the dataset ID. Other URLs download and auto-detect format. Unknown local files get sniffed (JSON lines, then CSV fallback).

Uses PEP 723 inline metadata — `uv run` handles all dependencies automatically.

The script outputs: shape, dtypes, null rates, cardinality, value distributions, string length stats, and auto-detects JSON columns and comma-separated lists.

**Read the full output before proceeding.**

### Phase 2: Deduce

Read [references/deduction-patterns.md](references/deduction-patterns.md) for calibration on what constitutes a good vs bad insight.

Based on the profile output, form 3-7 **specific hypotheses** as concrete questions. Each hypothesis should:
- Go beyond what the profile already answered
- Connect multiple signals (cross-column, structural, domain-level)
- Be testable with code

Prioritize **surprises over confirmations** — skip anything obvious.

### Phase 3: Investigate

For each hypothesis, write and execute focused Python code that:
- Tests the specific hypothesis
- Prints a clear summary of the finding
- Generates a visualization (matplotlib, dark theme: `facecolor="#0d1117"`, axes `"#161b22"`)
- Saves charts to the output directory

Use `uv run --with pandas --with matplotlib --with datasets --with pyarrow` for one-off scripts.

If a finding is uninteresting, move on. If one is fascinating, go deeper there instead of covering everything.

### Phase 4: Present

Summarize the 3-5 most interesting discoveries. For each:
- State the finding in one plain sentence
- Show the chart
- Note what it implies or what further analysis it suggests

## Guidelines

- **Nothing is hardcoded to a specific dataset.** The same workflow applies to any data the user provides.
- **Be genuinely curious.** Follow the most interesting thread, not a checklist.
- **Surprises are the goal.** A finding that contradicts expectations beats one that confirms them.
- **Go deep > go wide.** Three genuine insights beat ten surface observations.
- **Write code specific to what you deduced.** Not generic analysis boilerplate.
- **Show reasoning.** Explain why something is worth investigating before writing the code.
