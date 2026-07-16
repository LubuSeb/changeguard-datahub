# Demo script

Target video length: under the competition's three-minute limit.

## Opening

"A schema change is rarely local. ChangeGuard turns a proposed edit into a DataHub-grounded, reversible change passport."

Show the control room and connected demo graph. State clearly that the bundled data is synthetic and that the same workflow can connect to a live DataHub MCP endpoint.

## Proposal

Select `commerce.public.customers`, `country_code`, and `Rename field` to `market_code`. Run the analysis.

Explain that ChangeGuard first verifies the current DataHub schema. If the field does not exist, the agent stops instead of inventing a plan.

## DataHub context

Show the lineage graph. Point out that the seeded column-mapping evidence maps `country_code` into `market` downstream and reaches Snowflake transformations, a Feast feature view, and an MLflow production model. In live mode, describe a field mapping only when `lineageColumns` is present; otherwise call it asset-level impact with unknown field mapping.

Show the risk score and impacted owner groups. Explain that change semantics, configured certification-tag signals, governance tags, owner count, and consumer class affect the transparent policy.

## Actionable output

Scroll through the five-phase rollout. Emphasize the additive compatibility phase, lineage-ordered migration, verification gate, and rollback.

Open one generated SQL validation check. State that ChangeGuard generates reviewable checks but does not execute warehouse SQL.

## Evidence and memory

Show the operation trail: `get_entities`, `list_schema_fields`, and `get_lineage`. In the public demo, state that these are simulated fixture operations and click **Save demo record** to show the in-memory receipt. If recording the authorized local live mode, show the real `save_document` document URN and make the mode switch visible.

Close with: "DataHub is not decorative here. It is the source of truth, the coordination graph, and the durable memory behind every decision."

## Recording rules checklist

- Keep the final uploaded video publicly visible on YouTube or Vimeo.
- Do not include copyrighted music or unlicensed third-party material.
- Show the running application, not only slides.
- Keep the final cut below three minutes.
- Mention that demo data is synthetic and no production system is modified.
