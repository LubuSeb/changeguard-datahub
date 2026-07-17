# Evidence and rules fit

## Official requirements checked

| Requirement | Project evidence |
|---|---|
| Working software application | React operator console plus Express API; production build served by one process |
| DataHub open-source platform plus an approved agent surface | Configurable official DataHub MCP endpoint using `@modelcontextprotocol/sdk` |
| Meaningful DataHub usage | Schema validation, field-aware lineage, ownership, governance, and document write-back directly alter the decision |
| New work during submission period | Repository created July 16, 2026, after the July 6 opening date |
| Public open-source repository | https://github.com/LubuSeb/changeguard-datahub with detected Apache-2.0 license |
| Easy judge access | Public no-credential forced-demo Lambda plus Docker and local setup |
| Text description | Draft in `DEVPOST.md` |
| Public demonstration video under three minutes | Final 74-second silent captioned 1440p60 recording prepared at `output/changeguard-live-agent-footage-1440p60.mp4`; public YouTube upload remains outstanding |
| Sample outputs | `examples/sample-change-passport.md` |

## Claim-to-evidence matrix

| Claim | Code/evidence |
|---|---|
| Rejects hallucinated fields | `src/server/agent/planner.ts`, absent-field test |
| Traces mapped columns across systems | `findDownstream` in `src/server/datahub/gateway.ts`, propagation test |
| Uses official MCP transport | `McpDataHubGateway` and `@modelcontextprotocol/sdk` dependency |
| Writes knowledge back | `save_document` call in `McpDataHubGateway.publish` |
| Matches current MCP tool schemas | Source-reviewed `num_results`, column lineage with `upstream: false`, and required `document_type="Decision"` |
| Requires no paid credentials | Complete agent uses a local Ollama model; public preview disables the model and labels that limitation |
| Rejects hallucinated model references | Strict advice schema plus URN and owner grounding in `orchestrator.ts` |
| Preserves deterministic authority | Model recommendation can only maintain or tighten the policy verdict; risk, SQL, rollout gates, and write authorization remain code-owned |
| Fails closed on model errors | Configured advisor errors return `503` and no passport is stored |
| Does not fake live mode | Live MCP errors are surfaced and never fall back to fixtures |
| Generates reversible rollout | Five ordered phases plus rollback text in `planner.ts` |
| Creates concrete checks | Change-specific PostgreSQL, Snowflake, BigQuery, or standard SQL in `buildValidations` |
| Verifies the official integration | Fresh read-only and authorized write `npm run test:live` runs against DataHub Core and official MCP v0.6.0; receipt in `docs/live-integration-evidence-20260717.json` |
| Verifies real model synthesis | Successful local Ollama receipt with model digest, input hash, verdict merge, and grounding result in `docs/model-reasoning-evidence-20260717.json` |
| Verifies the combined agent path | Live DataHub reads, grounded local-model synthesis, policy guard, and real `save_document` receipt in `docs/full-agent-evidence-20260717.json` |
| Keeps public hosting bounded | Lambda handler constructs demo gateway directly; live mode is private-only and live writes require a separate opt-in |

## Seed graph

The demo contains eight original synthetic assets and seven lineage edges across PostgreSQL, Snowflake/dbt, Looker, Power BI, Feast, and MLflow. It includes:

- field renames (`country_code` to `market`);
- configured certification-tag signals and owner groups;
- PII, SOX, audit, board, production ML, and revenue-critical signals;
- dashboards and a production model at multiple lineage depths;
- synthetic governance and ownership metadata.

This is deliberately richer than a hard-coded list of tables: the selected field changes which graph branches are impacted.

## Candid limitations

- The live adapter was freshly exercised on July 17 against the official local DataHub MCP server with five seeded datasets, four mapped downstream hops, and a real `save_document` receipt.
- The app writes a DataHub decision document but does not open a real code pull request or execute warehouse validation SQL.
- Live `get_lineage` returns impacted endpoints, hop degree, and mapped columns rather than complete intermediate adjacency. The UI renders these as dashed impact links; it does not claim they are direct edges.
- When live `get_lineage` omits `lineageColumns`, ChangeGuard records asset-level impact with unknown field mapping and does not substitute the requested source field.
- Certification weighting is based only on exact tag names configured through `DATAHUB_CERTIFICATION_TAGS` (default `Certified`), not DataHub's authoritative certification aspect.
- Demo write-back is process-local and resets on restart; it is labeled as demo in both UI and receipt.
- Risk scoring remains deterministic and transparent. Model synthesis is separate, grounded, and cannot rewrite the score or generated checks.
- The public deployment intentionally demonstrates only the deterministic fixture path. The complete model-backed path is demonstrated locally/private to avoid exposing an unauthenticated compute surface.
- The final silent, captioned video shows real local model synthesis and authorized MCP read/write at 2560x1440 and native 60 FPS capture. Devpost still requires it to be hosted publicly before submission.

## Judging assessment

- **Use of DataHub:** strong. Multiple read tools and one write tool form the core execution path.
- **Technical execution:** strong for a self-contained prototype. It builds, tests, runs without paid credentials, exposes failures, validates model grounding, and passes a real local MCP read/write smoke test.
- **Originality:** good. It converts catalog context into a change-control artifact rather than recreating search, lineage, or chat.
- **Real-world usefulness:** strong. Schema change blast-radius and coordinated deprecation are recurring data-platform problems.
- **Submission quality:** code, written assets, fresh model/MCP receipts, updated public build, and the concise working demo are prepared. Public video hosting and the final Devpost receipt remain outstanding.
- **Bonus OSS contribution:** absent. No upstream DataHub contribution was attempted.
