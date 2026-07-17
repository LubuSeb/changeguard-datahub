# Demo script

Target video length: under the competition's three-minute limit.

Final reviewed recording: `output/changeguard-live-agent-footage-1440p60.mp4` (74 seconds, silent, captioned, 2560x1440 at 60 FPS). The remaining publication step is public YouTube hosting.

## Opening

"A schema change is rarely local. ChangeGuard turns a proposed edit into a DataHub-grounded, reversible change passport."

Show the control room in **Live DataHub / AI active** mode. State clearly that the catalog is synthetic local data and no production system is modified.

## Proposal

Select `commerce.public.customers`, `country_code`, and `Rename field` to `market_code`. Run the analysis.

Explain that ChangeGuard first verifies the current DataHub schema. If the field does not exist, the agent stops instead of inventing a plan.

## DataHub context

Show the lineage graph. Point out that the seeded column-mapping evidence maps `country_code` into `market` downstream and reaches Snowflake transformations, a Feast feature view, and an MLflow production model. In live mode, describe a field mapping only when `lineageColumns` is present; otherwise call it asset-level impact with unknown field mapping.

Show the risk score and impacted owner groups. Explain that change semantics, configured certification-tag signals, governance tags, owner count, and consumer class affect the transparent policy.

Show **Agent synthesis**. Name the local model, point to its cited assets and owner actions, and show the guard statement. Explain that every reference was validated against the retrieved DataHub graph and the model can tighten the policy verdict but never loosen it.

## Actionable output

Scroll through the five-phase rollout. Emphasize the additive compatibility phase, lineage-ordered migration, verification gate, and rollback.

Open one generated SQL validation check. State that ChangeGuard generates reviewable checks but does not execute warehouse SQL.

## Evidence and memory

Show the operation trail: `get_entities`, `list_schema_fields`, `get_lineage`, `model_synthesis`, and `policy_guard`. Click **Save to DataHub**, show the real `save_document` document URN, then independently open that document in the local DataHub UI.

Close with: "DataHub is not decorative here. It is the source of truth, the coordination graph, and the durable memory behind every decision."

## Recording rules checklist

- Keep the final uploaded video publicly visible on YouTube or Vimeo.
- Do not include copyrighted music or unlicensed third-party material.
- Show the running application, not only slides.
- Keep the final cut below three minutes.
- Mention that demo data is synthetic and no production system is modified.
- Do not present the public deterministic preview as the model-backed demonstration.
