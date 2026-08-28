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

## Telegram Staff Assistant

Telegram is internal staff tooling only. It is not a Claire customer-intake channel.
The bot fails closed unless both `TELEGRAM_BOT_TOKEN` and a valid
`TELEGRAM_ALLOWED_CHAT_IDS` comma-separated allowlist are set. Unauthorized chats
are ignored without a reply.

Run locally in PowerShell:

```powershell
$env:TELEGRAM_BOT_TOKEN = "<bot-token>"
$env:TELEGRAM_ALLOWED_CHAT_IDS = "<chat-id>,<another-chat-id>"
npm run telegram
```

Discover recent chat IDs without printing message contents or tokens:

```powershell
$env:TELEGRAM_BOT_TOKEN = "<bot-token>"
npm run telegram:chat-ids
```

The internal `/price` command supports `/price granite 30x20`, an optional
quantity, and Thai material aliases. It uses `data\pricing_rules.json` through
the existing pricing engine with fixed assumptions: depth 3 mm, standard
complexity, no rush, no paint, and no installation. Telegram responses expose
calculated totals only, not pricing coefficients.

Staff knowledge commands are `/materials`, `/sizes`, `/train`, and `/quiz`.
Their editable content is in `data\staff_knowledge.json`; standard sizes remain
explicitly unconfigured until the business provides authoritative guidance.

## Workspace Structure

```text
OAS-Stone-OpenClaw/
|-- .claude/
|-- agents/
|   `-- agent_specs.md
|-- data/
|   |-- pricing_rules.json
|   |-- sample_jobs.json
|   |-- staff_knowledge.json
|   |-- legacy_python_pricing_rules.json
|   `-- legacy_python_sample_jobs.json
|-- logs/
|-- tools/
|   |-- pricing_engine.js
|   |-- staff_knowledge.js
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
