# Curated datasets

Each dataset is an approved, de-identified JSON document. Use the matching schema in `schemas/` before adding records.

| Dataset | Purpose |
| --- | --- |
| `intents.json` | Customer goals and routing signals |
| `faq.json` | Approved questions and answers |
| `objections.json` | Concerns, approved responses, and escalation rules |
| `quotations.json` | Aggregated quotation patterns without customer details |
| `conversation_outcomes.json` | Outcome classifications and aggregate counts |
| `products.json` | Product and service descriptions |
| `vocabulary.json` | Thai business terms, synonyms, and definitions |

Dataset records must not contain customer names, phone numbers, addresses, account IDs, order IDs, or copied private message text.
