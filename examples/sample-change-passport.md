# Sample change passport

**ID:** `CG-20260716-SAMPLE`  
**Proposal:** Rename `commerce.public.customers.country_code` to `market_code`  
**Decision:** Requires approval  
**Risk:** High

## Context found through DataHub

- Source: Tier-1 PostgreSQL customer table owned by Commerce Platform.
- Four field-level downstream consumers across three hops.
- The field becomes `market` inside `analytics.growth.customer_360`.
- Production ML feature and model assets consume the mapped field.
- Affected owners: Analytics Engineering, Growth Data, ML Platform, and Decision Science.

## Safe rollout

1. Record the contract proposal and obtain owner acknowledgement.
2. Add `market_code` while preserving `country_code`.
3. Migrate `dim_customers` before `customer_360`, then the Feast feature and MLflow model.
4. Hold retirement on schema, row-count, null-rate, parity, freshness, and consumer smoke checks.
5. Remove `country_code` only after cataloged consumers migrate, owners acknowledge completion, and runtime monitoring shows no regression.

## Generated validation

```sql
SELECT SUM(CASE WHEN
  CAST("country_code" AS TEXT) <> CAST("market_code" AS TEXT)
  OR ("country_code" IS NULL) <> ("market_code" IS NULL)
THEN 1 ELSE 0 END) AS mismatches
FROM "public"."customers";
```

Expected: `0 unexplained mismatches`.

## DataHub write-back

After operator approval, ChangeGuard uses the MCP `save_document` tool to preserve the title, risk, decision, rollout, validation expectations, and rollback plan in DataHub's knowledge graph.
