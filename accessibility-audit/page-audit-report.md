# Page-by-page accessibility audit

Environment: <dev-env> (enterprise build v1.1.0-rc2), org `default`, theme **O2 Signature (light)** unless stated, Chromium 140 headless, 1440x900.
Scan date: 2026-10-14. Axe-core 4.10 with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa.

## How to read this report

- **Findings** are deduplicated root causes (IDs `A11Y-NN`, defined in `findings.csv`). A page lists every root cause that affects it.
- **Instances** = affected DOM nodes reported by axe on that page (manual findings count 1).
- **Risk score** (prioritisation aid only, not a WCAG conformance score) = sum of severity weights of the findings on the page: Critical 10, High 5, Medium 2, Low 1.
- **Criteria assessed** uses a denominator of **55** = all WCAG 2.2 Level A + AA success criteria, excluding obsolete 4.1.1. Every crawled page got 14 criteria assessed (axe-mapped criteria + headings/title/bypass checks): 1.1.1, 1.3.1, 1.3.5, 1.4.3, 1.4.4, 2.1.1, 2.2.1, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.5.8, 3.1.1, 4.1.2. Deep-tested pages also got 14 manual criteria: 2.1.2, 2.4.3, 2.4.7, 2.4.11, 1.4.10, 1.4.12, 3.3.1, 3.3.2, 4.1.3, 3.2.1, 3.2.2, 3.2.3, 3.2.4, 1.4.11.
- Zero axe violations never means a page passes WCAG.

## Priority overview (all pages, highest risk first)

| Route | Risk | Findings | Instances | C/H/M/L | Criteria assessed | Not assessed | Shared-component findings | Next action |
|---|---|---|---|---|---|---|---|---|
| `/logs` | 39 | 14 | 20 | 1/2/8/3 | 28/55 (51%) | 27 | 9/14 | Fix P0 items first |
| `/ai/evaluations` | 36 | 10 | 15 | 1/3/5/1 | 14/55 (25%) | 41 | 10/10 | Fix P0 items first |
| `/rum/performance/overview` | 35 | 11 | 44 | 1/3/3/4 | 14/55 (25%) | 41 | 7/11 | Fix P0 items first |
| `/rum/source-maps` | 35 | 10 | 16 | 1/3/4/2 | 14/55 (25%) | 41 | 9/10 | Fix P0 items first |
| `/alerts/add` | 32 | 10 | 28 | 1/2/5/2 | 28/55 (51%) | 27 | 9/10 | Fix P0 items first |
| `/dashboards` | 32 | 13 | 24 | 0/3/7/3 | 28/55 (51%) | 27 | 12/13 | Shared fixes + page-specific items |
| `/ingestion/ai-integrations/frameworks/langgraph` | 32 | 11 | 26 | 1/2/4/4 | 14/55 (25%) | 41 | 8/11 | Fix P0 items first |
| `/ingestion/databases/postgres` | 32 | 11 | 20 | 1/2/4/4 | 14/55 (25%) | 41 | 8/11 | Fix P0 items first |
| `/metrics/editor` | 32 | 10 | 28 | 1/2/5/2 | 14/55 (25%) | 41 | 8/10 | Fix P0 items first |
| `/rum/errors` | 32 | 10 | 22 | 1/2/5/2 | 14/55 (25%) | 41 | 9/10 | Fix P0 items first |
| `/ai/discovery` | 31 | 9 | 19 | 1/2/5/1 | 14/55 (25%) | 41 | 9/9 | Fix P0 items first |
| `/ingestion/ai-integrations/popular/openai` | 31 | 10 | 23 | 1/2/4/3 | 14/55 (25%) | 41 | 8/10 | Fix P0 items first |
| `/ingestion/custom/traces/opentelemetry` | 31 | 10 | 16 | 1/2/4/3 | 14/55 (25%) | 41 | 8/10 | Fix P0 items first |
| `/ingestion/recommended/kubernetes` | 31 | 10 | 20 | 1/2/4/3 | 14/55 (25%) | 41 | 8/10 | Fix P0 items first |
| `/pipeline/pipelines/backfill` | 31 | 9 | 14 | 1/2/5/1 | 14/55 (25%) | 41 | 9/9 | Fix P0 items first |
| `/billings/usage` | 30 | 9 | 18 | 1/2/4/2 | 14/55 (25%) | 41 | 7/9 | Fix P0 items first |
| `/ingestion/custom/logs/curl` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/devops/jenkins` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/languages/python` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/message-queues/kafka` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/networking/netflow` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/others/vercel` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/recommended/aws` | 30 | 9 | 26 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/security/okta` | 30 | 9 | 13 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/ingestion/servers/nginx` | 30 | 9 | 21 | 1/2/4/2 | 14/55 (25%) | 41 | 8/9 | Fix P0 items first |
| `/alerts/history` | 29 | 8 | 13 | 1/2/4/1 | 14/55 (25%) | 41 | 8/8 | Fix P0 items first |
| `/infra/kubernetes-2` | 29 | 8 | 15 | 1/2/4/1 | 14/55 (25%) | 41 | 8/8 | Fix P0 items first |
| `/traces` | 29 | 10 | 27 | 1/1/6/2 | 28/55 (51%) | 27 | 8/10 | Fix P0 items first |
| `/pipeline/pipelines` | 28 | 11 | 21 | 0/3/5/3 | 14/55 (25%) | 41 | 9/11 | Shared fixes + page-specific items |
| `/` | 27 | 10 | 18 | 0/3/5/2 | 28/55 (51%) | 27 | 8/10 | Shared fixes + page-specific items |
| `/ai/agent-behavior` | 27 | 7 | 15 | 1/2/3/1 | 14/55 (25%) | 41 | 7/7 | Fix P0 items first |
| `/dashboards/import` | 27 | 7 | 8 | 1/2/3/1 | 14/55 (25%) | 41 | 7/7 | Fix P0 items first |
| `/infra/databases/activity` | 27 | 10 | 15 | 0/3/5/2 | 14/55 (25%) | 41 | 9/10 | Shared fixes + page-specific items |
| `/infra/databases/blocking` | 27 | 10 | 15 | 0/3/5/2 | 14/55 (25%) | 41 | 9/10 | Shared fixes + page-specific items |
| `/infra/databases/deadlocks` | 27 | 10 | 15 | 0/3/5/2 | 14/55 (25%) | 41 | 9/10 | Shared fixes + page-specific items |
| `/infra/databases/metrics` | 27 | 9 | 35 | 1/1/5/2 | 14/55 (25%) | 41 | 7/9 | Fix P0 items first |
| `/metrics` | 27 | 10 | 11 | 0/3/5/2 | 14/55 (25%) | 41 | 7/10 | Shared fixes + page-specific items |
| `/product-analytics/events` | 27 | 10 | 19 | 0/3/5/2 | 14/55 (25%) | 41 | 9/10 | Shared fixes + page-specific items |
| `/product-analytics/funnels` | 27 | 10 | 19 | 0/3/5/2 | 14/55 (25%) | 41 | 9/10 | Shared fixes + page-specific items |
| `/promql-builder` | 27 | 7 | 8 | 1/2/3/1 | 14/55 (25%) | 41 | 7/7 | Fix P0 items first |
| `/settings/general` | 27 | 9 | 82 | 1/1/5/2 | 28/55 (51%) | 27 | 8/9 | Fix P0 items first |
| `/ai/playground` | 26 | 8 | 10 | 1/1/5/1 | 14/55 (25%) | 41 | 8/8 | Fix P0 items first |
| `/pipeline/pipelines/history` | 26 | 8 | 12 | 1/1/5/1 | 14/55 (25%) | 41 | 8/8 | Fix P0 items first |
| `/settings/model_pricing` | 26 | 9 | 18 | 0/3/5/1 | 14/55 (25%) | 41 | 9/9 | Resolved mostly by shared-component fixes |
| `/synthetics` | 26 | 9 | 18 | 0/3/5/1 | 14/55 (25%) | 41 | 9/9 | Resolved mostly by shared-component fixes |
| `/product-analytics/funnels/build` | 25 | 8 | 9 | 1/1/4/2 | 14/55 (25%) | 41 | 7/8 | Fix P0 items first |
| `/product-analytics/paths` | 25 | 8 | 10 | 1/1/4/2 | 14/55 (25%) | 41 | 7/8 | Fix P0 items first |
| `/workflows/add` | 25 | 8 | 12 | 1/1/4/2 | 14/55 (25%) | 41 | 7/8 | Fix P0 items first |
| `/workflows/edit` | 25 | 8 | 12 | 1/1/4/2 | 14/55 (25%) | 41 | 7/8 | Fix P0 items first |
| `/ai/experiments/new` | 24 | 7 | 15 | 1/1/4/1 | 14/55 (25%) | 41 | 7/7 | Fix P0 items first |
| `/ai/remote-tasks/new` | 24 | 7 | 8 | 1/1/4/1 | 14/55 (25%) | 41 | 7/7 | Fix P0 items first |
| `/alerts` | 24 | 10 | 19 | 0/2/6/2 | 28/55 (51%) | 27 | 10/10 | Resolved mostly by shared-component fixes |
| `/iam/organizations` | 24 | 8 | 13 | 0/3/4/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/ai/agent-graph` | 22 | 6 | 10 | 1/1/3/1 | 14/55 (25%) | 41 | 6/6 | Fix P0 items first |
| `/ai/prompts/new` | 22 | 6 | 8 | 1/1/3/1 | 14/55 (25%) | 41 | 6/6 | Fix P0 items first |
| `/iam/users` | 22 | 9 | 18 | 0/2/5/2 | 28/55 (51%) | 27 | 8/9 | Shared fixes + page-specific items |
| `/infra/databases` | 22 | 9 | 14 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/infra/databases/queries` | 22 | 9 | 14 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/infra/databases/samples` | 22 | 9 | 14 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/infra/databases/table-health` | 22 | 9 | 14 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/pipeline/enrichment-tables` | 22 | 9 | 17 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/reports/create` | 22 | 6 | 17 | 1/1/3/1 | 14/55 (25%) | 41 | 6/6 | Fix P0 items first |
| `/rum/sessions` | 22 | 9 | 20 | 0/2/5/2 | 14/55 (25%) | 41 | 8/9 | Shared fixes + page-specific items |
| `/alert-destinations` | 21 | 8 | 16 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/downtimes` | 21 | 8 | 16 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/iam/ingestionTokens` | 21 | 8 | 14 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/iam/serviceAccounts` | 21 | 8 | 17 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/iam/syntheticsTokens` | 21 | 8 | 14 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/infra/hosts` | 21 | 8 | 128 | 0/2/5/1 | 14/55 (25%) | 41 | 7/8 | Shared fixes + page-specific items |
| `/ingestion/recommended/frontend-monitoring` | 21 | 9 | 21 | 0/2/4/3 | 14/55 (25%) | 41 | 7/9 | Shared fixes + page-specific items |
| `/reports` | 21 | 8 | 16 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/settings/cipher_keys` | 21 | 8 | 17 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/settings/pipeline_destinations` | 21 | 8 | 17 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/settings/regex_patterns` | 21 | 8 | 17 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/slos` | 21 | 8 | 16 | 0/2/5/1 | 14/55 (25%) | 41 | 8/8 | Resolved mostly by shared-component fixes |
| `/downtimes/add` | 20 | 7 | 8 | 1/0/4/2 | 14/55 (25%) | 41 | 6/7 | Fix P0 items first |
| `/ingestion/custom/metrics/prometheus` | 20 | 8 | 12 | 0/2/4/2 | 14/55 (25%) | 41 | 7/8 | Shared fixes + page-specific items |
| `/pipeline/functions` | 20 | 8 | 16 | 0/2/4/2 | 14/55 (25%) | 41 | 7/8 | Shared fixes + page-specific items |
| `/product-analytics/retention` | 20 | 8 | 10 | 0/2/4/2 | 14/55 (25%) | 41 | 7/8 | Shared fixes + page-specific items |
| `/ai/datasets` | 19 | 7 | 12 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/ai/prompts` | 19 | 7 | 13 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/ai/queues` | 19 | 7 | 12 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/ai/remote-tasks` | 19 | 7 | 12 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/alert-library` | 19 | 7 | 8 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/alert-templates` | 19 | 7 | 15 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/alerts/anomaly/add` | 19 | 6 | 20 | 1/0/4/1 | 14/55 (25%) | 41 | 6/6 | Fix P0 items first |
| `/iam/groups` | 19 | 7 | 16 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/iam/mcpServer` | 19 | 7 | 13 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/iam/roles` | 19 | 7 | 16 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/infra/kubernetes` | 19 | 7 | 8 | 0/2/4/1 | 14/55 (25%) | 41 | 5/7 | Shared fixes + page-specific items |
| `/logs/search-scheduler` | 19 | 7 | 11 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/oncall/policies` | 19 | 7 | 13 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/oncall/teams` | 19 | 7 | 11 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/settings/model_pricing/edit` | 19 | 7 | 9 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/slos/add` | 19 | 6 | 8 | 1/0/4/1 | 14/55 (25%) | 41 | 6/6 | Fix P0 items first |
| `/workflows` | 19 | 7 | 11 | 0/2/4/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/profiles` | 18 | 6 | 10 | 1/0/3/2 | 14/55 (25%) | 41 | 5/6 | Fix P0 items first |
| `/streams` | 18 | 8 | 16 | 0/1/6/1 | 28/55 (51%) | 27 | 8/8 | Resolved mostly by shared-component fixes |
| `/alerts/insights` | 17 | 6 | 7 | 0/2/3/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/logs/search-history` | 17 | 6 | 11 | 0/2/3/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/workflows/runs` | 17 | 6 | 13 | 0/2/3/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/alert-sources` | 16 | 7 | 11 | 0/1/5/1 | 14/55 (25%) | 41 | 7/7 | Resolved mostly by shared-component fixes |
| `/about` | 15 | 7 | 14 | 0/1/4/2 | 14/55 (25%) | 41 | 6/7 | Shared fixes + page-specific items |
| `/billings/invoice_history` | 15 | 7 | 13 | 0/1/4/2 | 14/55 (25%) | 41 | 6/7 | Shared fixes + page-specific items |
| `/billings/plans` | 15 | 7 | 10 | 0/1/4/2 | 14/55 (25%) | 41 | 6/7 | Shared fixes + page-specific items |
| `/pipeline/pipelines/add` | 15 | 7 | 10 | 0/1/4/2 | 14/55 (25%) | 41 | 6/7 | Shared fixes + page-specific items |
| `/alerts/import-semantic-groups` | 14 | 6 | 7 | 0/1/4/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/enterprise-features` | 14 | 6 | 6 | 0/1/4/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/incidents` | 14 | 6 | 10 | 0/1/4/1 | 28/55 (51%) | 27 | 6/6 | Resolved mostly by shared-component fixes |
| `/login` | 14 | 3 | 3 | 1/0/2/0 | 28/55 (51%) | 27 | 1/3 | Fix P0 items first |
| `/settings/ai_toolsets` | 14 | 6 | 10 | 0/1/4/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/settings/storage_settings` | 14 | 6 | 10 | 0/1/4/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/pipeline/pipelines/import` | 13 | 6 | 7 | 0/1/3/2 | 14/55 (25%) | 41 | 5/6 | Shared fixes + page-specific items |
| `/product-analytics/overview` | 13 | 6 | 7 | 0/1/3/2 | 14/55 (25%) | 41 | 5/6 | Shared fixes + page-specific items |
| `/ai/experiments` | 12 | 5 | 6 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/ai/llm-insights` | 12 | 5 | 7 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/ai/sessions` | 12 | 5 | 7 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/pipeline/functions/import` | 12 | 5 | 6 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/settings/gen_ai_agent_mapping` | 12 | 5 | 6 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/settings/llm_providers` | 12 | 5 | 6 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/settings/organization` | 12 | 5 | 6 | 0/1/3/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/synthetics/add` | 11 | 6 | 9 | 0/0/5/1 | 14/55 (25%) | 41 | 6/6 | Resolved mostly by shared-component fixes |
| `/autoobserve` | 10 | 4 | 5 | 0/1/2/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/billings/billing_group` | 10 | 6 | 8 | 0/0/4/2 | 14/55 (25%) | 41 | 5/6 | Shared fixes + page-specific items |
| `/ai/session-details` | 9 | 5 | 5 | 0/0/4/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/dashboards/view` | 9 | 3 | 3 | 0/1/2/0 | 28/55 (51%) | 27 | 1/3 | Shared fixes + page-specific items |
| `/logs/inspector` | 9 | 5 | 9 | 0/0/4/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/member_subscription` | 9 | 6 | 6 | 0/0/3/3 | 14/55 (25%) | 41 | 4/6 | Shared fixes + page-specific items |
| `/traces/session-details` | 9 | 5 | 5 | 0/0/4/1 | 14/55 (25%) | 41 | 5/5 | Resolved mostly by shared-component fixes |
| `/billings/paid_usage` | 8 | 5 | 5 | 0/0/3/2 | 14/55 (25%) | 41 | 4/5 | Shared fixes + page-specific items |
| `/rum/upload-source-maps` | 8 | 5 | 5 | 0/0/3/2 | 14/55 (25%) | 41 | 4/5 | Shared fixes + page-specific items |
| `/enterprise-locked` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/infra/databases/query` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/oncall/me` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/oncall/responses` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/oncall/routing` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |
| `/product-analytics/events/new` | 7 | 4 | 4 | 0/0/3/1 | 14/55 (25%) | 41 | 4/4 | Resolved mostly by shared-component fixes |

## Deep-tested pages

### `/` - OpenObserve - Home

Header menus (org selector, Help, profile): open on Enter, arrow keys move, Escape closes and returns focus - pass. Sidebar: roving tabindex with arrow keys, ArrowRight opens flyout menus with menu/menuitem roles - pass. Theme toggle updates its label - pass. Home tabs: arrow keys move focus (manual activation) but no tabpanel (A11Y-27). Composer autofocus/unnamed (A11Y-15). Overview tab charts (A11Y-10). Screenshots: `screenshots/pages/home.png`, `screenshots/states/kb-*.png`, `reflow-*-home.png`, `dark-home.png`.

**Improvements required:**
- **A11Y-05** (High/P1, 4.1.2 Name, Role, Value) Icon-only buttons across feature pages have no accessible name (tooltip-only labelling) - 7 instances
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders)
- **A11Y-10** (High/P1, 1.1.1 Non-text Content) Charts (ECharts canvas) have no text alternative; every panel reuses id="chart1"
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels - 3 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-15** (Medium/P2, 4.1.2 Name, Role, Value) Home: AI chat composer has no accessible name or visible focus, and receives autofocus at the end of the page
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only
- **A11Y-27** (Low/P3, 1.3.1 Info and Relationships) Tab sets without associated tab panels; fixed tab ids can collide

Evidence: `screenshots/pages/home.png`, `test-results/axe-per-route/home.json`

### `/logs` - OpenObserve - Logs

Monaco trap (A11Y-02); toolbar icon buttons unnamed (A11Y-05); histogram switch nested in button (A11Y-24); date-time picker (A11Y-17); toast duplication (A11Y-13). Focus ring visible on all toolbar buttons except the editor. Screenshots: `screenshots/states/ix-logs-*.png`, `ix-toast.png`.

**Improvements required:**
- **A11Y-01** (Critical/P0, 1.3.1 Info and Relationships) Form controls rendered by OSelect / OInput have no programmatic label - 2 instances
- **A11Y-02** (High/P0, 2.1.2 No Keyboard Trap) Monaco query editor traps Tab; only escape is an undocumented shortcut, and its focus border is removed
- **A11Y-05** (High/P1, 4.1.2 Name, Role, Value) Icon-only buttons across feature pages have no accessible name (tooltip-only labelling) - 5 instances
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels - 2 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-17** (Medium/P2, 4.1.2 Name, Role, Value) Date-time picker: unnamed popover dialog, unlabelled custom value input, Escape ignored inside relative panel
- **A11Y-24** (Medium/P2, 4.1.2 Name, Role, Value) Miscellaneous ARIA misuse: nested interactive control, unnamed links, invalid role children
- **A11Y-25** (Medium/P2, 2.1.4 Character Key Shortcuts) Single-character keyboard shortcuts cannot be turned off or remapped
- **A11Y-20** (Low/P2, 2.5.8 Target Size (Minimum)) Targets smaller than 24x24 CSS px without spacing (switches, inline selects)
- **A11Y-22** (Low/P3, 1.3.1 Info and Relationships) Heading structure: 8 routes without h1, 13 with two h1, login has none
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/logs.png`, `test-results/axe-per-route/logs.json`

### `/alerts` - OpenObserve - Alerts

Tab order: header -> IaC links -> Import -> New alert -> tabs -> folders -> search -> table: logical. Summary chips focusable with visible ring (low pixel change 3.7%, borderline - verify visually).

**Improvements required:**
- **A11Y-04** (High/P1, 4.1.2 Name, Role, Value) Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name - 5 instances
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) - 2 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-09** (Medium/P1, 4.1.2 Name, Role, Value) Table row / header selection checkboxes have no accessible name - 5 instances
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-12** (Medium/P2, 4.1.2 Name, Role, Value) Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div
- **A11Y-14** (Medium/P2, 2.4.3 Focus Order) Focus is lost to <body> after a failed dialog submit
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only
- **A11Y-27** (Low/P3, 1.3.1 Info and Relationships) Tab sets without associated tab panels; fixed tab ids can collide

Evidence: `screenshots/pages/alerts.png`, `test-results/axe-per-route/alerts.json`

### `/alerts/add` - OpenObserve - Add Alert

All 14 sampled controls lack programmatic labels (A11Y-01). Empty Save: field errors are `role=alert`, focus moves to the first invalid field (Alert name) - good; summary toast duplicated (A11Y-13) and overlaps the Save button area. Screenshots: `ix-alert-add.png`, `ix-alert-add-empty-save.png`.

**Improvements required:**
- **A11Y-01** (Critical/P0, 1.3.1 Info and Relationships) Form controls rendered by OSelect / OInput have no programmatic label - 14 instances
- **A11Y-05** (High/P1, 4.1.2 Name, Role, Value) Icon-only buttons across feature pages have no accessible name (tooltip-only labelling) - 2 instances
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) - 3 instances
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels - 3 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-20** (Low/P2, 2.5.8 Target Size (Minimum)) Targets smaller than 24x24 CSS px without spacing (switches, inline selects)
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/alerts__add.png`, `test-results/axe-per-route/alerts__add.json`

### `/dashboards` - OpenObserve - Dashboards

New dashboard / Add Folder dialogs: role=dialog, labelled by title, focus moves in, Tab trapped, Escape closes, focus returns to trigger - pass. Empty submit loses focus to body (A11Y-14). Sortable headers expose aria-sort and toggle via Enter - pass. Table has no caption/accessible name (minor, part of A11Y-04 remediation).

**Improvements required:**
- **A11Y-04** (High/P1, 4.1.2 Name, Role, Value) Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name - 5 instances
- **A11Y-05** (High/P1, 4.1.2 Name, Role, Value) Icon-only buttons across feature pages have no accessible name (tooltip-only labelling)
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) - 2 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-09** (Medium/P1, 4.1.2 Name, Role, Value) Table row / header selection checkboxes have no accessible name - 5 instances
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-12** (Medium/P2, 4.1.2 Name, Role, Value) Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels - 3 instances
- **A11Y-14** (Medium/P2, 2.4.3 Focus Order) Focus is lost to <body> after a failed dialog submit
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-23** (Low/P3, 2.4.2 Page Titled) Page titles are not unique across sibling views
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only
- **A11Y-27** (Low/P3, 1.3.1 Info and Relationships) Tab sets without associated tab panels; fixed tab ids can collide

Evidence: `screenshots/pages/dashboards__view.png`, `test-results/axe-per-route/dashboards__view.json`

### `/dashboards/view`

Five chart panels, canvas only, duplicate id "chart1" (A11Y-10); 17 unnamed toolbar/panel buttons (A11Y-05); a focusable bare <svg> in tab order. Screenshot: `screenshots/states/dashboard-view.png`.

**Improvements required:**
- **A11Y-10** (High/P1, 1.1.1 Non-text Content) Charts (ECharts canvas) have no text alternative; every panel reuses id="chart1"
- **A11Y-17** (Medium/P2, 4.1.2 Name, Role, Value) Date-time picker: unnamed popover dialog, unlabelled custom value input, Escape ignored inside relative panel
- **A11Y-25** (Medium/P2, 2.1.4 Character Key Shortcuts) Single-character keyboard shortcuts cannot be turned off or remapped

### `/streams` - OpenObserve - Streams

New stream dialog passes dialog checks (stream-type combobox unnamed, A11Y-01). Row checkboxes unnamed (A11Y-09). Pagination unnamed (A11Y-04). Sort: aria-sort ascending/descending updates - pass.

**Improvements required:**
- **A11Y-04** (High/P1, 4.1.2 Name, Role, Value) Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name - 5 instances
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-09** (Medium/P1, 4.1.2 Name, Role, Value) Table row / header selection checkboxes have no accessible name - 5 instances
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-12** (Medium/P2, 4.1.2 Name, Role, Value) Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/streams.png`, `test-results/axe-per-route/streams.json`

### `/login`

Public page. Keyboard walk, internal-user form, empty submit (inline `role=alert` errors + `aria-invalid`: good), invalid credentials (error announced but duplicated, A11Y-13), 320px reflow (no horizontal scroll: pass). Screenshots: `screenshots/states/public-login-*.png`.

**Improvements required:**
- **A11Y-03** (Critical/P0, 2.1.1 Keyboard) Login: "Login as internal user" is not reachable or operable by keyboard
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels
- **A11Y-18** (Medium/P2, 1.3.5 Identify Input Purpose) Login page: no autocomplete tokens, no heading/landmark, fields not tied to server error

### `/iam/users` - OpenObserve - Users

Reflow 320/720/768: no page-level horizontal scroll; table scrolls in its own container (allowed). "Add user" trigger is `add-basic-user` - dialog not opened (avoid creating users).

**Improvements required:**
- **A11Y-04** (High/P1, 4.1.2 Name, Role, Value) Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name - 5 instances
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) - 2 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-09** (Medium/P1, 4.1.2 Name, Role, Value) Table row / header selection checkboxes have no accessible name - 5 instances
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-12** (Medium/P2, 4.1.2 Name, Role, Value) Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-23** (Low/P3, 2.4.2 Page Titled) Page titles are not unique across sibling views
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/iam__users.png`, `test-results/axe-per-route/iam__users.json`

### `/settings/general` - OpenObserve - General

Text-spacing override: no clipping - pass. Dark mode: 2 contrast + 1 label issues. Several Settings sub-routes are not available in this org (see limitations).

**Improvements required:**
- **A11Y-01** (Critical/P0, 1.3.1 Info and Relationships) Form controls rendered by OSelect / OInput have no programmatic label - 9 instances
- **A11Y-06** (High/P1, 1.4.3 Contrast (Minimum)) Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) - 20 instances
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels - 45 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels - 3 instances
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-23** (Low/P3, 2.4.2 Page Titled) Page titles are not unique across sibling views
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/settings__announcements__edit.png`, `test-results/axe-per-route/settings__announcements__edit.json`

### `/traces` - OpenObserve - Traces

Reflow checks pass at page level; sidebar Traces flyout reachable by ArrowRight. Search-mode buttons focusable with visible ring.

**Improvements required:**
- **A11Y-01** (Critical/P0, 1.3.1 Info and Relationships) Form controls rendered by OSelect / OInput have no programmatic label - 2 instances
- **A11Y-05** (High/P1, 4.1.2 Name, Role, Value) Icon-only buttons across feature pages have no accessible name (tooltip-only labelling) - 12 instances
- **A11Y-07** (Medium/P2, 1.4.3 Contrast (Minimum)) Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels - 3 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-13** (Medium/P2, 4.1.3 Status Messages) Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels - 3 instances
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-17** (Medium/P2, 4.1.2 Name, Role, Value) Date-time picker: unnamed popover dialog, unlabelled custom value input, Escape ignored inside relative panel
- **A11Y-22** (Low/P3, 1.3.1 Info and Relationships) Heading structure: 8 routes without h1, 13 with two h1, login has none - 2 instances
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/traces__trace-details.png`, `test-results/axe-per-route/traces__trace-details.json`

### `/incidents` - OpenObserve - Incidents

Empty state only (no incidents in env) - detail route not tested.

**Improvements required:**
- **A11Y-04** (High/P1, 4.1.2 Name, Role, Value) Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name - 5 instances
- **A11Y-08** (Medium/P1, 1.1.1 Non-text Content) Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos)
- **A11Y-11** (Medium/P2, 2.4.1 Bypass Blocks) No "skip to main content" mechanism
- **A11Y-12** (Medium/P2, 4.1.2 Name, Role, Value) Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div
- **A11Y-16** (Medium/P2, 4.1.2 Name, Role, Value) Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state
- **A11Y-26** (Low/P2, 1.4.13 Content on Hover or Focus) Tooltips are not hoverable and some information is tooltip-only

Evidence: `screenshots/pages/incidents.png`, `test-results/axe-per-route/incidents.json`

## All other crawled pages (automated + structure)

Each entry lists page-specific improvements. Unless noted, these pages also inherit the shell-wide items A11Y-11 (no skip link) and A11Y-26 (tooltip behaviour, suspected).

### about

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/about` | OpenObserve - About | 0 | A11Y-06, A11Y-07:7, A11Y-08:2, A11Y-22 | [png](screenshots/pages/about.png) |

### ai

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/ai/evaluations` | OpenObserve - Evaluations | 1 | A11Y-01, A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-07, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__evaluations.png) |
| `/ai/discovery` | OpenObserve - Discovery | 1 | A11Y-01, A11Y-04:5, A11Y-06:3, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/ai__discovery.png) |
| `/ai/agent-behavior` | OpenObserve - Agent Behavior | 1 | A11Y-01:3, A11Y-04:5, A11Y-06:3, A11Y-08 | [png](screenshots/pages/ai__agent-behavior.png) |
| `/ai/playground` | OpenObserve - Playground | 1 | A11Y-01, A11Y-06:2, A11Y-07:2, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__playground.png) |
| `/ai/experiments/new` | OpenObserve - New Experiment | 1 | A11Y-01:5, A11Y-06:3, A11Y-07:3, A11Y-08 | [png](screenshots/pages/ai__experiments__new.png) |
| `/ai/remote-tasks/new` | OpenObserve - New Remote Task | 1 | A11Y-01, A11Y-06:2, A11Y-07, A11Y-08 | [png](screenshots/pages/ai__remote-tasks__new.png) |
| `/ai/agent-graph` | OpenObserve - Agent Graph | 1 | A11Y-01:3, A11Y-06:3, A11Y-08 | [png](screenshots/pages/ai__agent-graph.png) |
| `/ai/prompts/new` | OpenObserve - New Prompt | 1 | A11Y-01:2, A11Y-06:2, A11Y-08 | [png](screenshots/pages/ai__prompts__new.png) |
| `/ai/datasets` | OpenObserve - Datasets | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__datasets.png) |
| `/ai/prompts` | OpenObserve - Prompts | 1 | A11Y-04:5, A11Y-06:3, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__prompts.png) |
| `/ai/queues` | OpenObserve - Queues | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__queues.png) |
| `/ai/remote-tasks` | OpenObserve - Remote Tasks | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-12 | [png](screenshots/pages/ai__remote-tasks.png) |
| `/ai/experiments` | OpenObserve - Experiments | 1 | A11Y-06:2, A11Y-08 | [png](screenshots/pages/ai__experiments.png) |
| `/ai/llm-insights` | OpenObserve - Insights | 1 | A11Y-06:3, A11Y-08 | [png](screenshots/pages/ai__llm-insights.png) |
| `/ai/sessions` | OpenObserve - Sessions | 1 | A11Y-06:3, A11Y-08 | [png](screenshots/pages/ai__sessions.png) |
| `/ai/session-details` | OpenObserve - Session Details | 1 | A11Y-07, A11Y-08 | [png](screenshots/pages/ai__session-details.png) |

### alert-destinations

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/alert-destinations` | OpenObserve - Notification Destinations | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/alert-destinations.png) |

### alert-library

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/alert-library` | OpenObserve - Alert Library | 1 | A11Y-05, A11Y-06, A11Y-07:2, A11Y-08 | [png](screenshots/pages/alert-library.png) |

### alert-sources

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/alert-sources` | OpenObserve - External Alert Sources | 1 | A11Y-04:5, A11Y-07, A11Y-08, A11Y-12 | [png](screenshots/pages/alert-sources.png) |

### alert-templates

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/alert-templates` | OpenObserve - Destination Templates | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5 | [png](screenshots/pages/alert-templates.png) |

### alerts

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/alerts/history` | OpenObserve - Alert History | 1 | A11Y-01, A11Y-04:5, A11Y-05:2, A11Y-07, A11Y-08 | [png](screenshots/pages/alerts__history.png) |
| `/alerts/anomaly/add` | OpenObserve - Add Anomaly Detection | 1 | A11Y-01:13, A11Y-07:3, A11Y-08 | [png](screenshots/pages/alerts__anomaly__add.png) |
| `/alerts/insights` | OpenObserve - Alert Insights | 1 | A11Y-05, A11Y-06:2, A11Y-08 | [png](screenshots/pages/alerts__insights.png) |
| `/alerts/import-semantic-groups` | OpenObserve - Import Semantic Groups | 1 | A11Y-06:2, A11Y-07, A11Y-08 | [png](screenshots/pages/alerts__import-semantic-groups.png) |

### autoobserve

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/autoobserve` | OpenObserve - AutoObserve | 1 | A11Y-06:2 | [png](screenshots/pages/autoobserve.png) |

### billings

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/billings/usage` | OpenObserve | 1 | A11Y-01:2, A11Y-06:2, A11Y-08:6, A11Y-10, A11Y-13:3, A11Y-23 | [png](screenshots/pages/billings__usage.png) |
| `/billings/invoice_history` | OpenObserve | 1 | A11Y-04:5, A11Y-08, A11Y-13:3, A11Y-23 | [png](screenshots/pages/billings__invoice_history.png) |
| `/billings/plans` | OpenObserve | 1 | A11Y-06:2, A11Y-08, A11Y-13:3, A11Y-23 | [png](screenshots/pages/billings__plans.png) |
| `/billings/billing_group` | OpenObserve | 1 | A11Y-08, A11Y-13:3, A11Y-23 | [png](screenshots/pages/billings__billing_group.png) |
| `/billings/paid_usage` | OpenObserve | 1 | A11Y-08, A11Y-23 | [png](screenshots/pages/billings__paid_usage.png) |

### dashboards

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/dashboards/import` | OpenObserve - Import Dashboard | 1 | A11Y-01, A11Y-05, A11Y-06:2, A11Y-08 | [png](screenshots/pages/dashboards__import.png) |

### downtimes

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/downtimes` | OpenObserve - Downtimes | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/downtimes.png) |
| `/downtimes/add` | OpenObserve - New downtime | 1 | A11Y-01:2, A11Y-07, A11Y-08, A11Y-20 | [png](screenshots/pages/downtimes__add.png) |

### enterprise-features

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/enterprise-features` | OpenObserve - Enterprise features | 1 | A11Y-06, A11Y-07, A11Y-08 | [png](screenshots/pages/enterprise-features.png) |

### enterprise-locked

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/enterprise-locked` | OpenObserve - Enterprise feature | 1 | A11Y-08 | [png](screenshots/pages/enterprise-locked.png) |

### iam

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/iam/organizations` | OpenObserve - Organizations | 1 | A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-12 | [png](screenshots/pages/iam__organizations.png) |
| `/iam/ingestionTokens` | OpenObserve - Ingestion Tokens | 1 | A11Y-04:5, A11Y-06:2, A11Y-07:2, A11Y-08, A11Y-12 | [png](screenshots/pages/iam__ingestionTokens.png) |
| `/iam/serviceAccounts` | OpenObserve - Service Accounts | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/iam__serviceAccounts.png) |
| `/iam/syntheticsTokens` | OpenObserve - Synthetics Tokens | 1 | A11Y-04:5, A11Y-05, A11Y-08, A11Y-12, A11Y-13:3 | [png](screenshots/pages/iam__syntheticsTokens.png) |
| `/iam/groups` | OpenObserve - Groups | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5 | [png](screenshots/pages/iam__groups.png) |
| `/iam/mcpServer` | OpenObserve - MCP Server | 1 | A11Y-05:3, A11Y-06:2, A11Y-07:4, A11Y-08 | [png](screenshots/pages/iam__mcpServer.png) |
| `/iam/roles` | OpenObserve - Roles | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5 | [png](screenshots/pages/iam__roles.png) |

### infra

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/infra/kubernetes-2` | OpenObserve - Kubernetes 2 | 1 | A11Y-01, A11Y-05, A11Y-06:2, A11Y-08, A11Y-19:7 | [png](screenshots/pages/infra__kubernetes-2.png) |
| `/infra/databases/activity` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-05, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__activity.png) |
| `/infra/databases/blocking` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-05, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__blocking.png) |
| `/infra/databases/deadlocks` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-05, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__deadlocks.png) |
| `/infra/databases/metrics` | OpenObserve - Databases | 1 | A11Y-01:15, A11Y-06:3, A11Y-07:2, A11Y-08, A11Y-23, A11Y-24:10 | [png](screenshots/pages/infra__databases__metrics.png) |
| `/infra/databases` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases.png) |
| `/infra/databases/queries` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__queries.png) |
| `/infra/databases/samples` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__samples.png) |
| `/infra/databases/table-health` | OpenObserve - Databases | 1 | A11Y-04:5, A11Y-06, A11Y-07:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/infra__databases__table-health.png) |
| `/infra/hosts` | OpenObserve - Hosts | 1 | A11Y-04:5, A11Y-07, A11Y-08, A11Y-10, A11Y-19:117 | [png](screenshots/pages/infra__hosts.png) |
| `/infra/kubernetes` | OpenObserve - Kubernetes | 1 | A11Y-06, A11Y-08, A11Y-10, A11Y-24:2 | [png](screenshots/pages/infra__kubernetes.png) |
| `/infra/databases/query` | OpenObserve - Query detail | 1 | A11Y-08 | [png](screenshots/pages/infra__databases__query.png) |

### ingestion

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/ingestion/ai-integrations/frameworks/langgraph` | OpenObserve - Ingestion | 2 | A11Y-01, A11Y-05:6, A11Y-06:3, A11Y-07:8, A11Y-08, A11Y-21:2, A11Y-22, A11Y-23 | [png](screenshots/pages/ingestion__ai-integrations__frameworks__langgraph.png) |
| `/ingestion/databases/postgres` | OpenObserve - Ingestion | 2 | A11Y-01, A11Y-05:5, A11Y-06:3, A11Y-07:3, A11Y-08, A11Y-21:2, A11Y-22, A11Y-23 | [png](screenshots/pages/ingestion__databases__postgres.png) |
| `/ingestion/ai-integrations/popular/openai` | OpenObserve - Ingestion | 2 | A11Y-01, A11Y-05:6, A11Y-06:3, A11Y-07:7, A11Y-08, A11Y-22, A11Y-23 | [png](screenshots/pages/ingestion__ai-integrations__popular__openai.png) |
| `/ingestion/custom/traces/opentelemetry` | OpenObserve - Ingestion | 2 | A11Y-01, A11Y-05:5, A11Y-06:3, A11Y-07, A11Y-08, A11Y-22, A11Y-23 | [png](screenshots/pages/ingestion__custom__traces__opentelemetry.png) |
| `/ingestion/recommended/kubernetes` | OpenObserve - Ingestion | 2 | A11Y-01, A11Y-05:5, A11Y-06:3, A11Y-07:4, A11Y-08, A11Y-22:2, A11Y-23 | [png](screenshots/pages/ingestion__recommended__kubernetes.png) |
| `/ingestion/custom/logs/curl` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:3, A11Y-07:2, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__custom__logs__curl.png) |
| `/ingestion/devops/jenkins` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__devops__jenkins.png) |
| `/ingestion/languages/python` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__languages__python.png) |
| `/ingestion/message-queues/kafka` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__message-queues__kafka.png) |
| `/ingestion/networking/netflow` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__networking__netflow.png) |
| `/ingestion/others/vercel` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__others__vercel.png) |
| `/ingestion/recommended/aws` | OpenObserve - Ingestion | 1 | A11Y-01:2, A11Y-05:9, A11Y-06:3, A11Y-07:7, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__recommended__aws.png) |
| `/ingestion/security/okta` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:2, A11Y-06:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__security__okta.png) |
| `/ingestion/servers/nginx` | OpenObserve - Ingestion | 1 | A11Y-01, A11Y-05:3, A11Y-06:3, A11Y-07:9, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__servers__nginx.png) |
| `/ingestion/recommended/frontend-monitoring` | OpenObserve - Ingestion | 2 | A11Y-05:5, A11Y-06:2, A11Y-07:8, A11Y-08, A11Y-22, A11Y-23 | [png](screenshots/pages/ingestion__recommended__frontend-monitoring.png) |
| `/ingestion/custom/metrics/prometheus` | OpenObserve - Ingestion | 1 | A11Y-05, A11Y-06:4, A11Y-07:2, A11Y-08, A11Y-23 | [png](screenshots/pages/ingestion__custom__metrics__prometheus.png) |

### logs

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/logs/search-scheduler` | OpenObserve - Search Scheduler | 1 | A11Y-04:5, A11Y-05, A11Y-08, A11Y-12 | [png](screenshots/pages/logs__search-scheduler.png) |
| `/logs/search-history` | OpenObserve - Search History | 1 | A11Y-04:5, A11Y-05:2, A11Y-08 | [png](screenshots/pages/logs__search-history.png) |
| `/logs/inspector` | OpenObserve - Search Job Inspector | 1 | A11Y-07:5, A11Y-08 | [png](screenshots/pages/logs__inspector.png) |

### member_subscription

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/member_subscription` | OpenObserve - Member Subscription | 0 | A11Y-08, A11Y-21, A11Y-22 | [png](screenshots/pages/member_subscription.png) |

### metrics

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/metrics/editor` | OpenObserve - Metrics | 1 | A11Y-01:4, A11Y-05:10, A11Y-06:3, A11Y-07, A11Y-08:2, A11Y-20:4, A11Y-24 | [png](screenshots/pages/metrics__editor.png) |
| `/metrics` | OpenObserve - Metrics | 0 | A11Y-05:2, A11Y-06, A11Y-07, A11Y-08, A11Y-10, A11Y-17, A11Y-22 | [png](screenshots/pages/metrics.png) |

### oncall

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/oncall/policies` | OpenObserve - Escalation policies | 1 | A11Y-04:5, A11Y-05, A11Y-08, A11Y-13:3 | [png](screenshots/pages/oncall__policies.png) |
| `/oncall/teams` | OpenObserve - On-call teams | 1 | A11Y-04:5, A11Y-05, A11Y-08, A11Y-12 | [png](screenshots/pages/oncall__teams.png) |
| `/oncall/me` | OpenObserve - My on-call | 1 | A11Y-08 | [png](screenshots/pages/oncall__me.png) |
| `/oncall/responses` | OpenObserve - On-call pages | 1 | A11Y-08 | [png](screenshots/pages/oncall__responses.png) |
| `/oncall/routing` | OpenObserve - On-call routing | 1 | A11Y-08 | [png](screenshots/pages/oncall__routing.png) |

### pipeline

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/pipeline/pipelines/backfill` | OpenObserve - Pipeline Backfill Jobs | 1 | A11Y-01:2, A11Y-04:5, A11Y-05, A11Y-07, A11Y-08, A11Y-12 | [png](screenshots/pages/pipeline__pipelines__backfill.png) |
| `/pipeline/pipelines` | OpenObserve - Pipeline | 1 | A11Y-04:5, A11Y-05:2, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12, A11Y-22, A11Y-23 | [png](screenshots/pages/pipeline__pipelines__edit.png) |
| `/pipeline/pipelines/history` | OpenObserve - Pipeline History | 1 | A11Y-01, A11Y-04:5, A11Y-07, A11Y-08, A11Y-12 | [png](screenshots/pages/pipeline__pipelines__history.png) |
| `/pipeline/enrichment-tables` | OpenObserve - Pipeline | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-12, A11Y-23 | [png](screenshots/pages/pipeline__enrichment-tables.png) |
| `/pipeline/functions` | OpenObserve - Pipeline | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-23 | [png](screenshots/pages/pipeline__functions.png) |
| `/pipeline/pipelines/add` | OpenObserve - Pipeline | 1 | A11Y-05:4, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/pipeline__pipelines__add.png) |
| `/pipeline/pipelines/import` | OpenObserve - Pipeline | 1 | A11Y-06:2, A11Y-08, A11Y-23 | [png](screenshots/pages/pipeline__pipelines__import.png) |
| `/pipeline/functions/import` | OpenObserve - Import Function | 1 | A11Y-06:2, A11Y-08 | [png](screenshots/pages/pipeline__functions__import.png) |

### product-analytics

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/product-analytics/events` | OpenObserve - Product Analytics | 1 | A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12, A11Y-23 | [png](screenshots/pages/product-analytics__events.png) |
| `/product-analytics/funnels` | OpenObserve - Product Analytics | 1 | A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12, A11Y-23 | [png](screenshots/pages/product-analytics__funnels.png) |
| `/product-analytics/funnels/build` | OpenObserve - Product Analytics | 1 | A11Y-01, A11Y-06:2, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/product-analytics__funnels__build.png) |
| `/product-analytics/paths` | OpenObserve - Product Analytics | 1 | A11Y-01:2, A11Y-06:2, A11Y-07, A11Y-08, A11Y-23 | [png](screenshots/pages/product-analytics__paths.png) |
| `/product-analytics/retention` | OpenObserve - Product Analytics | 1 | A11Y-05, A11Y-06:2, A11Y-07:2, A11Y-08, A11Y-23 | [png](screenshots/pages/product-analytics__retention.png) |
| `/product-analytics/overview` | OpenObserve - Product Analytics | 1 | A11Y-06:2, A11Y-08, A11Y-23 | [png](screenshots/pages/product-analytics__overview.png) |
| `/product-analytics/events/new` | OpenObserve - Create named event | 1 | A11Y-08 | [png](screenshots/pages/product-analytics__events__new.png) |

### profiles

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/profiles` | OpenObserve - Profiles | 0 | A11Y-01:5, A11Y-08, A11Y-22 | [png](screenshots/pages/profiles.png) |

### promql-builder

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/promql-builder` | OpenObserve - PromQL Query Builder | 1 | A11Y-01, A11Y-05:2, A11Y-06, A11Y-08 | [png](screenshots/pages/promql-builder.png) |

### reports

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/reports/create` | OpenObserve - Create Report | 1 | A11Y-01:6, A11Y-05:7, A11Y-08 | [png](screenshots/pages/reports__create.png) |
| `/reports` | OpenObserve - Reports | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/reports.png) |

### rum

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/rum/performance/overview` | OpenObserve - Real User Monitoring | 2 | A11Y-01:18, A11Y-05:6, A11Y-06:2, A11Y-08, A11Y-10, A11Y-20:6, A11Y-22:6, A11Y-23 | [png](screenshots/pages/rum__performance__overview.png) |
| `/rum/source-maps` | OpenObserve - Real User Monitoring | 1 | A11Y-01:2, A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/rum__source-maps.png) |
| `/rum/errors` | OpenObserve - Real User Monitoring | 1 | A11Y-01, A11Y-05:7, A11Y-06:2, A11Y-07:6, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/rum__errors.png) |
| `/rum/sessions` | OpenObserve - Real User Monitoring | 1 | A11Y-05:8, A11Y-06:2, A11Y-07:4, A11Y-08, A11Y-12, A11Y-23 | [png](screenshots/pages/rum__sessions.png) |
| `/rum/upload-source-maps` | OpenObserve - Real User Monitoring | 1 | A11Y-08, A11Y-23 | [png](screenshots/pages/rum__upload-source-maps.png) |

### settings

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/settings/model_pricing` | OpenObserve - LLM Model Pricing | 1 | A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/settings__model_pricing.png) |
| `/settings/cipher_keys` | OpenObserve - Cipher Keys | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/settings__cipher_keys.png) |
| `/settings/pipeline_destinations` | OpenObserve - Pipeline Destinations | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/settings__pipeline_destinations.png) |
| `/settings/regex_patterns` | OpenObserve - Regex Patterns | 1 | A11Y-04:5, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/settings__regex_patterns.png) |
| `/settings/model_pricing/edit` | OpenObserve - Model Pricing Editor | 1 | A11Y-05:2, A11Y-06:2, A11Y-07, A11Y-08 | [png](screenshots/pages/settings__model_pricing__edit.png) |
| `/settings/ai_toolsets` | OpenObserve - AI Toolsets | 1 | A11Y-04:5, A11Y-08, A11Y-12 | [png](screenshots/pages/settings__ai_toolsets.png) |
| `/settings/storage_settings` | OpenObserve - Storage Settings | 1 | A11Y-06:2, A11Y-07:4, A11Y-08 | [png](screenshots/pages/settings__storage_settings.png) |
| `/settings/gen_ai_agent_mapping` | OpenObserve - GenAI Agent Mapping | 1 | A11Y-06:2, A11Y-08 | [png](screenshots/pages/settings__gen_ai_agent_mapping.png) |
| `/settings/llm_providers` | OpenObserve - LLM Providers | 1 | A11Y-06:2, A11Y-08 | [png](screenshots/pages/settings__llm_providers.png) |
| `/settings/organization` | OpenObserve - Organization Parameters | 1 | A11Y-06:2, A11Y-08 | [png](screenshots/pages/settings__organization.png) |

### slos

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/slos` | OpenObserve - SLOs | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/slos.png) |
| `/slos/add` | OpenObserve - New SLO | 1 | A11Y-01:3, A11Y-07, A11Y-08 | [png](screenshots/pages/slos__add.png) |

### synthetics

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/synthetics` | OpenObserve - Synthetics | 1 | A11Y-04:5, A11Y-05, A11Y-06:2, A11Y-08, A11Y-09:5, A11Y-12 | [png](screenshots/pages/synthetics.png) |
| `/synthetics/add` | OpenObserve - Add Check | 1 | A11Y-07:2, A11Y-08, A11Y-13:3 | [png](screenshots/pages/synthetics__add.png) |

### traces

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/traces/session-details` | OpenObserve - Session Details | 1 | A11Y-07, A11Y-08 | [png](screenshots/pages/traces__session-details.png) |

### workflows

| Route | Title | h1 | Improvements (finding: instances) | Screenshot |
|---|---|---|---|---|
| `/workflows/add` | OpenObserve - New workflow | 1 | A11Y-01, A11Y-05:4, A11Y-07:2, A11Y-08, A11Y-20 | [png](screenshots/pages/workflows__add.png) |
| `/workflows/edit` | OpenObserve - Edit Workflow | 1 | A11Y-01, A11Y-05:4, A11Y-07:2, A11Y-08, A11Y-20 | [png](screenshots/pages/workflows__edit.png) |
| `/workflows` | OpenObserve - Workflows | 1 | A11Y-04:5, A11Y-06, A11Y-08, A11Y-12 | [png](screenshots/pages/workflows.png) |
| `/workflows/runs` | OpenObserve - Workflow Runs | 1 | A11Y-04:5, A11Y-05:4, A11Y-08 | [png](screenshots/pages/workflows__runs.png) |

## Finding legend

| ID | Severity | Priority | Title |
|---|---|---|---|
| A11Y-01 | Critical | P0 | Form controls rendered by OSelect / OInput have no programmatic label |
| A11Y-02 | High | P0 | Monaco query editor traps Tab; only escape is an undocumented shortcut, and its focus border is removed |
| A11Y-03 | Critical | P0 | Login: "Login as internal user" is not reachable or operable by keyboard |
| A11Y-04 | High | P1 | Shared table pagination: first/prev/next/last buttons and rows-per-page select have no accessible name |
| A11Y-05 | High | P1 | Icon-only buttons across feature pages have no accessible name (tooltip-only labelling) |
| A11Y-06 | High | P1 | Theme accent colour fails text contrast (primary buttons, links, active tabs/folders) |
| A11Y-07 | Medium | P2 | Low-contrast secondary text: placeholders, muted values, syntax colours, meta labels |
| A11Y-08 | Medium | P1 | Images without text alternative (AI assistant icon on 134 routes, SSO icon, custom logos) |
| A11Y-09 | Medium | P1 | Table row / header selection checkboxes have no accessible name |
| A11Y-10 | High | P1 | Charts (ECharts canvas) have no text alternative; every panel reuses id="chart1" |
| A11Y-11 | Medium | P2 | No "skip to main content" mechanism |
| A11Y-12 | Medium | P2 | Dropdown triggers put ARIA/button attributes on a non-interactive wrapper div |
| A11Y-13 | Medium | P2 | Toast notifications: double announcements, short life, invalid list markup, focusable aria-hidden sentinels |
| A11Y-14 | Medium | P2 | Focus is lost to <body> after a failed dialog submit |
| A11Y-15 | Medium | P2 | Home: AI chat composer has no accessible name or visible focus, and receives autofocus at the end of the page |
| A11Y-16 | Medium | P2 | Mobile navigation drawer: generic name, unnamed close button, Tab stuck on "Home", toggle lacks state |
| A11Y-17 | Medium | P2 | Date-time picker: unnamed popover dialog, unlabelled custom value input, Escape ignored inside relative panel |
| A11Y-18 | Medium | P2 | Login page: no autocomplete tokens, no heading/landmark, fields not tied to server error |
| A11Y-19 | Medium | P2 | Progress bars / meters without accessible names (infra hosts & kubernetes) |
| A11Y-20 | Low | P2 | Targets smaller than 24x24 CSS px without spacing (switches, inline selects) |
| A11Y-21 | Low | P2 | Scrollable code blocks are not keyboard accessible (ingestion guides) |
| A11Y-22 | Low | P3 | Heading structure: 8 routes without h1, 13 with two h1, login has none |
| A11Y-23 | Low | P3 | Page titles are not unique across sibling views |
| A11Y-24 | Medium | P2 | Miscellaneous ARIA misuse: nested interactive control, unnamed links, invalid role children |
| A11Y-25 | Medium | P2 | Single-character keyboard shortcuts cannot be turned off or remapped |
| A11Y-26 | Low | P2 | Tooltips are not hoverable and some information is tooltip-only |
| A11Y-27 | Low | P3 | Tab sets without associated tab panels; fixed tab ids can collide |
