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

Authorized staff can use `/draft stone_sign granite 40x60 [จำนวน]` to request a
deterministic evidence-backed response plan. This is draft-only: it shows planner
state, follow-up questions, current Pricing Engine output, conflict summaries,
response-style guidance, and concise evidence pointers. It never sends or forwards
anything to a customer, calls an external LLM, or triggers an automatic reply.
Non-ready states require staff review; historical quotations never override the
Pricing Engine.

Staff knowledge commands are `/materials`, `/sizes`, `/train`, and `/quiz`.
Their editable content is in `data\staff_knowledge.json`; standard sizes remain
explicitly unconfigured until the business provides authoritative guidance.

Market Intelligence is internal-only and has no scraping framework yet. The
`/market` command reads `data\competitors.json` and
`data\market_observations.json`; empty or unconfigured data returns setup
guidance. Every observation requires a source URL and observed timestamp, and
the digest separates verified observations from interpretation.
Daily digest selection uses the UTC calendar date from each observation's
`observedAt`; observations from other dates are excluded.

Market Intelligence v2 also supports optional source-backed `district` and
`serviceEvidence` fields on competitors. Controlled service IDs are
`stone_sign`, `marble_sign`, `granite_sign`, `granite`, and `stone_engraving`;
presentation labels are kept separate from these IDs. Each service evidence
entry must use a valid HTTP(S) URL already present in that competitor's
`sourceUrls`, and only verified competitors may provide non-empty evidence.

The digest includes deterministic registry-level service evidence coverage,
district coverage, and evidence gaps in addition to date-specific verified
observations. An evidence gap means this dataset has zero explicit verified
evidence for that service; it does not mean there are zero real-world
competitors. District and service summaries are factual source coverage only.

`buildMarketCoverageSnapshot()` provides a structured Local SEO handoff with
service IDs, Thai labels, Roi Et keyword labels, verified competitor evidence,
districts, and supporting source URLs. It does not provide search volume,
ranking, demand, keyword difficulty, or recommendations.

### Local SEO Intelligence

Local SEO is layered on top of Market Intelligence without changing its
behavior. Layer A is source-backed competitor/service evidence from
`buildMarketCoverageSnapshot()`. Layer B is point-in-time search-surface
observations in `data\local_seo_observations.json`. Layer C is future SEO
interpretation and recommendations, which is not implemented.

The initial curated keyword registry is in `data\local_seo_keywords.json`:
`stone-sign-roi-et` (`ป้ายหิน ร้อยเอ็ด`), `marble-sign-roi-et`
(`ป้ายหินอ่อน ร้อยเอ็ด`), `granite-sign-roi-et` (`ป้ายหินแกรนิต ร้อยเอ็ด`),
`stone-sign-engraving-roi-et` (`แกะสลักป้ายหิน ร้อยเอ็ด`), and
`stone-engraving-roi-et` (`แกะสลักหิน ร้อยเอ็ด`). `หินแกรนิต ร้อยเอ็ด` is
excluded from this initial stone-sign-focused target set because it has broader
material intent; this does not claim it has low value.

`verifiedCompetitorEvidenceCount` means verified Market Intelligence records
with explicit source-backed evidence for the linked service. It is not the
number of competitors in a SERP, the real market competitor count, search
volume, ranking, or search competition.

SEO observations record historical facts such as query, surface, result/entity,
optional position, location context, and timestamp. Results can vary by
location, personalization, device, and history; `locationLabel` records the
intended observation context and is not guaranteed geo-neutral. An optional
SEO `sourceUrl` is a separate HTTP(S) artifact and is not required: a live SERP
may be point-in-time or personalized without a durable independently
reproducible URL. Production SEO observations are intentionally empty. This
foundation has no live search, scraper, browser/API integration, scoring,
recommendations, or content generation.

`data\business_profile.json` stores owner-supplied public ownership anchors
separately from the competitor registry. The anchors support conservative
`own_business` identification by URL; they do not independently verify public
business metadata. No canonical business name is required or selected yet,
and URL matching never uses fuzzy business-name inference.

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
|   |-- competitors.json
|   |-- market_observations.json
|   |-- legacy_python_pricing_rules.json
|   `-- legacy_python_sample_jobs.json
|-- logs/
|-- tools/
|   |-- pricing_engine.js
|   |-- staff_knowledge.js
|   |-- market_intelligence.js
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
