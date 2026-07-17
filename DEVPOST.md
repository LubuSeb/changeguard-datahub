# Devpost draft

## Project name

ChangeGuard

## Tagline

Turn every risky schema edit into a DataHub-grounded, reversible change passport.

## Challenge category

Agents That Do Real Work

## Inspiration

A column rename can quietly cross warehouses, transformations, dashboards, feature stores, and production models. The code change may be small while the organizational blast radius is not. Teams often discover the real dependency graph only after a broken report, failed close, or degraded model.

DataHub already knows the schemas, lineage, owners, governance labels, and downstream consumers. ChangeGuard gives that context an operational job: decide how a proposed schema change can ship safely and preserve the decision for the next person or agent.

## What it does

ChangeGuard accepts a concrete schema proposal, such as renaming `country_code` to `market_code`. Its agent uses the DataHub MCP Server to:

1. verify the asset and field against the current schema;
2. trace field-aware downstream lineage;
3. identify configured certification-tag signals, governance tags, dashboard consumers, and ML consumers;
4. group migration work by DataHub owner;
5. score risk with an inspectable policy engine;
6. generate a reversible compatibility rollout and validation SQL; and
7. in authorized private live mode, write the final passport back through `save_document`; the public demo simulates this operation without changing DataHub.

The output is not another lineage visualization. It is a merge-ready operating plan with gates, owners, checks, rollback, and an evidence trail showing exactly which DataHub tools grounded the decision.

## How we built it

- React, TypeScript, Vite, and React Flow for the responsive control room.
- Express and Zod for the API and validated change proposals.
- The official `@modelcontextprotocol/sdk` streamable HTTP client.
- DataHub MCP tools: `get_entities`, `list_schema_fields`, `get_lineage`, and `save_document`.
- A deterministic policy and planning engine so every decision is inspectable and testable.
- An original synthetic cross-platform catalog covering PostgreSQL, Snowflake/dbt, Looker, Power BI, Feast, and MLflow.
- A private live MCP mode for DataHub OSS or Cloud, plus an honestly labeled no-credential simulated demo mode.

## Why DataHub is essential

The plan changes with the catalog graph. A different field follows available column mappings and reaches different consumers; missing column mappings remain explicitly unknown at field level. Ownership controls routing. Configured certification-tag and governance-tag signals affect risk. Lineage depth controls rollout order. The final record is written back into the graph. Without DataHub, ChangeGuard loses its source of truth and cannot produce the claimed result.

## Challenges

The hard part was keeping the agent useful without letting it invent context. ChangeGuard fails closed when a field is absent from DataHub, separates live and demo modes, keeps credentials server-side, and surfaces MCP failures instead of disguising fixture data as live output. Field-level propagation also had to preserve renames across transformations so `country_code` could correctly affect a downstream `market` feature.

## Accomplishments

- End-to-end, no-credential demo with meaningful cross-platform lineage.
- Implements and separately validates an official DataHub MCP integration and gated private `save_document` write-back. The public demo uses synthetic fixtures and saves only a process-local simulated receipt.
- Deterministic risk logic with asset-level severity and owner routing.
- Generated validation SQL and a reversible five-phase rollout.
- Tests for official MCP contracts, lineage mapping, SQL dialects, deployment boundaries, anti-hallucination gates, failed writes, and idempotent demo write-back.
- Apache-2.0 source, Docker packaging, architecture notes, and sample output.

## What we learned

Metadata becomes more valuable when agents do not just retrieve it. DataHub's context graph can operate as a control plane: schemas constrain what the agent may propose, lineage orders work, governance signals affect policy, ownership creates the coordination map, and write-back gives the next agent durable memory.

## What's next

- Attach CI and deployment receipts to each passport.
- Add DataHub query history as a separately implemented retirement signal.
- Add organization-specific contract and compliance policy packs.
- Open code pull requests containing generated compatibility migrations and checks.

## Built with

DataHub, DataHub MCP Server, Model Context Protocol, TypeScript, React, Vite, Express, Zod, React Flow, Vitest, Docker, AWS Lambda

## Project provenance

ChangeGuard was created from scratch during the July 6-August 10, 2026 submission period. OpenAI Codex assisted with implementation, adversarial review, validation, and media preparation. No pre-existing project code was incorporated; third-party open-source dependencies are listed in `package.json` and `package-lock.json`.

## Required URLs before submission

- Project demo: https://iwus2xg2ulcnaeyav33ktu7pii0mcskw.lambda-url.eu-north-1.on.aws/
- Public Apache-2.0 repository: https://github.com/LubuSeb/changeguard-datahub
- Public video under three minutes: `TBD_PUBLIC_VIDEO_URL`
- Primary image: `submission-media/02-risk-passport.png`
- Secondary image: `submission-media/03-rollout.png`
- Secondary image: `submission-media/04-simulated-receipt.png`
