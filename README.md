# OAS Stone OpenClaw Workspace

Unified local workspace for OAS stone engraving workflows, agent instructions, pricing data, and supporting tools.

## Run Pricing Engine

Default Node.js pricing engine:

```powershell
cd D:\OAS-Stone-OpenClaw
npm run price
```

Run with a custom jobs file:

```powershell
npm run price:file -- data\sample_jobs.json
```

Direct command:

```powershell
node tools\pricing_engine.js calculate data\sample_jobs.json data\pricing_rules.json
```

Legacy Python pricing engine is still available for the original Python sample schema:

```powershell
python pricing_engine.py
```

## Editable Pricing Rules

Main editable pricing rules are in:

```text
data\pricing_rules.json
```

Default sample jobs are in:

```text
data\sample_jobs.json
```

The old Python-format data files were preserved instead of deleted:

```text
data\legacy_python_pricing_rules.json
data\legacy_python_sample_jobs.json
```

## Workspace Structure

```text
OAS-Stone-OpenClaw/
|-- .claude/
|-- agents/
|   `-- agent_specs.md
|-- data/
|   |-- pricing_rules.json
|   |-- sample_jobs.json
|   |-- legacy_python_pricing_rules.json
|   `-- legacy_python_sample_jobs.json
|-- logs/
|-- tools/
|   |-- pricing_engine.js
|   `-- thai-token-optimizer/
|-- vault/
|   |-- 00_System/
|   |-- 01_Business/
|   |-- 03_Projects/
|   `-- 04_Debug/
|-- workflows/
|-- .claudeignore
|-- AGENTS.md
|-- CLAUDE.md
|-- package.json
|-- pricing_engine.py
`-- README.md
```

Note: `tools\thai-token-optimizer` is kept intact as a vendored tool so its own CLI files still work.
