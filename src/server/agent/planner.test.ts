import { describe, expect, it } from "vitest";
import { createPassport } from "./planner.js";
import { DemoDataHubGateway, type AnalysisContext } from "../datahub/gateway.js";

const customerUrn = "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)";

async function context(field = "country_code"): Promise<AnalysisContext> {
  return new DemoDataHubGateway().context(customerUrn, field);
}

describe("ChangeGuard passport planner", () => {
  it("propagates a field through column mappings and ranks critical consumers", async () => {
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "rename",
      targetValue: "market_code",
      rationale: "Align regional identifiers across the commerce data contract.",
    }, await context());

    expect(passport.impacted.map((asset) => asset.name)).toEqual(expect.arrayContaining([
      "dim_customers",
      "customer_360",
      "churn_features",
      "churn_intervention_v4",
    ]));
    expect(passport.impacted.find((asset) => asset.name === "customer_360")?.impactedFields).toContain("market");
    expect(passport.riskScore).toBeGreaterThanOrEqual(60);
    expect(passport.steps).toHaveLength(5);
    expect(passport.trace.map((item) => item.tool)).toEqual(["get_entities", "list_schema_fields", "get_lineage"]);
  });

  it("blocks destructive changes to high-impact paths", async () => {
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "customer_id",
      changeType: "drop",
      rationale: "Remove the legacy identifier after the customer identity migration.",
    }, await context("customer_id"));

    expect(passport.verdict).toBe("blocked");
    expect(passport.riskLevel).toBe("critical");
    expect(passport.notifications.length).toBeGreaterThan(2);
    expect(passport.rollback).toContain("Restore customer_id");
  });

  it("rejects a field absent from the authoritative schema", async () => {
    const current = await context();
    expect(() => createPassport({
      assetUrn: customerUrn,
      field: "invented_field",
      changeType: "drop",
      rationale: "This should fail because the field was hallucinated.",
    }, current)).toThrow(/not present in the DataHub schema/);
  });

  it("generates PostgreSQL rename checks without Snowflake COUNT_IF", async () => {
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "rename",
      targetValue: "market_code",
      rationale: "Align regional identifiers across the commerce data contract.",
    }, await context());
    const sql = passport.validations.map((check) => check.sql).join("\n");
    expect(sql).toContain('"public"."customers"');
    expect(sql).not.toContain('"commerce"."public"."customers"');
    expect(sql).toContain('"market_code"');
    expect(sql).toContain("SUM(CASE WHEN");
    expect(sql).not.toContain("COUNT_IF");
  });

  it("treats a target type as a type, not an invented column", async () => {
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "type",
      targetValue: "VARCHAR(3)",
      rationale: "Expand country identifiers for the revised regional contract.",
    }, await context());
    const sql = passport.validations.map((check) => check.sql).join("\n");
    expect(sql).toContain('CAST("country_code" AS VARCHAR(3))');
    expect(sql).not.toContain('"VARCHAR3"');
    expect(sql).not.toContain("_next");
  });

  it("uses Snowflake-compatible conditional aggregates", async () => {
    const snowflake = await context();
    snowflake.source = { ...snowflake.source, platform: "Snowflake", qualifiedName: "analytics.core.customers" };
    snowflake.fields = snowflake.fields.map((field) => field.name === "country_code" ? { ...field, nullable: true } : field);
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "nullable",
      targetValue: "required",
      rationale: "Enforce a complete regional key after the backfill is verified.",
    }, snowflake);
    const sql = passport.validations.map((check) => check.sql).join("\n");
    expect(sql).toContain('"analytics"."core"."customers"');
    expect(sql).toContain("SUM(CASE WHEN");
    expect(passport.validations.at(-1)?.expected).toMatch(/0 nulls/);
  });

  it("rejects unsafe target data-type syntax", async () => {
    const current = await context();
    expect(() => createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "type",
      targetValue: "VARCHAR); DROP TABLE users; --",
      rationale: "The planner must reject executable target type syntax.",
    }, current)).toThrow(/simple SQL type/);
  });

  it("uses BigQuery physical identifiers and rejects PostgreSQL-only VARCHAR targets", async () => {
    const bigquery = await context();
    bigquery.source = { ...bigquery.source, platform: "BigQuery", qualifiedName: "commerce_analytics.customer.customer_events" };
    bigquery.fields = bigquery.fields.map((field) => field.name === "country_code" ? { ...field, type: "INT64" } : field);

    expect(() => createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "type",
      targetValue: "VARCHAR(64)",
      rationale: "Represent regional identifiers as text in the event warehouse.",
    }, bigquery)).toThrow(/VARCHAR.*not a supported bigquery.*STRING/i);

    const passport = createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      changeType: "type",
      targetValue: "STRING",
      rationale: "Represent regional identifiers as text in the event warehouse.",
    }, bigquery);
    expect(passport.validations.map((check) => check.sql).join("\n")).toContain("`commerce_analytics.customer.customer_events`");
  });

  it.each([
    ["rename to the current name", { changeType: "rename", targetValue: "country_code" }, /current field name/i],
    ["change to an equivalent type", { changeType: "type", targetValue: "VARCHAR(2)" }, /equivalent to the current/i],
    ["require an already non-null field", { changeType: "nullable", targetValue: "required" }, /already non-nullable/i],
  ])("rejects the semantic no-op: %s", async (_label, change, error) => {
    const current = await context();
    expect(() => createPassport({
      assetUrn: customerUrn,
      field: "country_code",
      rationale: "Semantic no-op proposals must stop before planning begins.",
      ...change,
    } as Parameters<typeof createPassport>[0], current)).toThrow(error);
  });
});
