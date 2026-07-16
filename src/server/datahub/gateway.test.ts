import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPassport } from "../agent/planner.js";
import {
  createGateway,
  DemoDataHubGateway,
  McpDataHubGateway,
  parseLineageResponse,
  parseSchemaResponse,
  parseSearchResponse,
  type McpInvoker,
} from "./gateway.js";

const customerUrn = "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)";
const liveUrn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,warehouse.analytics.orders,PROD)";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

class FixtureInvoker implements McpInvoker {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly tools = ["search", "get_entities", "list_schema_fields", "get_lineage", "save_document"],
    private readonly saveResult: unknown = { success: true, urn: "urn:li:document:shared-changeguard-123", message: "Created" },
    private readonly lineageResult: unknown = fixture("lineage"),
  ) {}

  async connect() {}

  async listTools() {
    return { tools: this.tools.map((name) => ({ name })) };
  }

  async callTool(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    const value = {
      search: fixture("search"),
      get_entities: fixture("entity"),
      list_schema_fields: fixture("schema-fields"),
      get_lineage: this.lineageResult,
      save_document: this.saveResult,
    }[name];
    return { structuredContent: value };
  }

  async close() {}
}

describe("Demo DataHub fixture", () => {
  it("exposes a cross-platform, governance-rich graph", async () => {
    const gateway = new DemoDataHubGateway();
    const snapshot = await gateway.snapshot();
    expect(snapshot.mode).toBe("demo");
    expect(snapshot.assets.length).toBeGreaterThanOrEqual(8);
    expect(new Set(snapshot.assets.map((asset) => asset.platform)).size).toBeGreaterThanOrEqual(5);
    expect(snapshot.assets.some((asset) => asset.tags.includes("SOX"))).toBe(true);
    expect(snapshot.edges.length).toBeGreaterThanOrEqual(7);
  });

  it("labels simulated operations and returns an idempotent local receipt", async () => {
    const gateway = new DemoDataHubGateway();
    const context = await gateway.context(customerUrn, "email");
    expect(context.trace.every((trace) => trace.source === "Simulated fixture operation")).toBe(true);
    const passport = createPassport({
      assetUrn: customerUrn,
      field: "email",
      changeType: "rename",
      targetValue: "email_address",
      rationale: "Normalize identity fields across operational and analytical systems.",
    }, context);

    const first = await gateway.publish(passport);
    const second = await gateway.publish(passport);
    expect(second).toEqual(first);
    expect(first.message).toMatch(/simulated fixture store/i);
  });
});

describe("Official-shape MCP contracts", () => {
  it("parses only top-level search result entities, never nested metadata URNs", () => {
    const entities = parseSearchResponse(fixture("search"));
    expect(entities).toHaveLength(1);
    expect(entities[0].urn).toBe(liveUrn);
  });

  it("parses schema fields and column-aware downstream lineage", () => {
    expect(parseSchemaResponse(fixture("schema-fields")).fields.map((field) => field.name)).toEqual(["order_id", "total_amount"]);
    const lineage = parseLineageResponse(fixture("lineage"));
    expect(lineage).toHaveLength(1);
    expect(lineage[0].columns).toEqual(["gross_revenue"]);
  });

  it("hydrates live catalog fields before assets become selectable", async () => {
    const invoker = new FixtureInvoker();
    const gateway = new McpDataHubGateway("http://mcp.invalid", undefined, false, invoker);
    const snapshot = await gateway.snapshot();
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets[0]).toMatchObject({
      urn: liveUrn,
      owner: "Data Platform",
      domain: "Commerce",
      fields: [{ name: "order_id" }, { name: "total_amount" }],
    });
    expect(invoker.calls.some((call) => call.name === "list_schema_fields")).toBe(true);
    const context = await gateway.context(liveUrn, "order_id");
    expect(context.graphEdges.every((edge) => edge.relation === "impact")).toBe(true);
    expect(context.downstream[0]).toMatchObject({ impactScope: "field", impactedFields: ["gross_revenue"] });
  });

  it("keeps official asset-level lineage unknown when lineageColumns is absent", async () => {
    const withoutColumns = structuredClone(fixture("lineage")) as {
      downstreams: { searchResults: Array<{ lineageColumns?: unknown }> };
    };
    delete withoutColumns.downstreams.searchResults[0].lineageColumns;
    expect(parseLineageResponse(withoutColumns)[0].columns).toEqual([]);

    const gateway = new McpDataHubGateway(
      "http://mcp.invalid",
      undefined,
      false,
      new FixtureInvoker(undefined, undefined, withoutColumns),
    );
    const context = await gateway.context(liveUrn, "order_id");
    expect(context.downstream[0]).toMatchObject({
      impactScope: "asset",
      impactedFields: [],
    });
    expect(context.downstream[0].impactReason).toMatch(/without lineageColumns.*unknown/i);
    expect(context.downstream[0].impactReason).not.toMatch(/maps order_id/i);
  });

  it("treats only configured exact tag names as certification signals", async () => {
    const defaultGateway = new McpDataHubGateway("http://mcp.invalid", undefined, false, new FixtureInvoker());
    expect((await defaultGateway.snapshot()).assets[0].hasCertificationTag).toBe(false);

    const configuredGateway = new McpDataHubGateway(
      "http://mcp.invalid",
      undefined,
      false,
      new FixtureInvoker(),
      ["Tier-1"],
    );
    expect((await configuredGateway.snapshot()).assets[0].hasCertificationTag).toBe(true);
  });

  it("discovers required tools and fails closed when one is unavailable", async () => {
    const invoker = new FixtureInvoker(["search"]);
    const gateway = new McpDataHubGateway("http://mcp.invalid", undefined, false, invoker);
    await expect(gateway.snapshot()).rejects.toThrow(/missing required tools: list_schema_fields/i);
  });

  it("rejects a business-level save_document failure", async () => {
    const invoker = new FixtureInvoker(undefined, { success: false, urn: null, message: "Document writes are disabled" });
    const gateway = new McpDataHubGateway("http://mcp.invalid", undefined, true, invoker);
    const context = await gateway.context(liveUrn, "order_id");
    const passport = createPassport({
      assetUrn: liveUrn,
      field: "order_id",
      changeType: "drop",
      rationale: "Retire the identifier after all consumers complete migration.",
    }, context);
    await expect(gateway.publish(passport)).rejects.toThrow(/rejected the write.*Document writes are disabled/i);
  });

  it("requires a real document URN before returning a receipt", async () => {
    const invoker = new FixtureInvoker(undefined, { success: true, urn: null, message: "Created" });
    const gateway = new McpDataHubGateway("http://mcp.invalid", undefined, true, invoker);
    const context = await gateway.context(liveUrn, "order_id");
    const passport = createPassport({
      assetUrn: liveUrn,
      field: "order_id",
      changeType: "drop",
      rationale: "Retire the identifier after all consumers complete migration.",
    }, context);
    await expect(gateway.publish(passport)).rejects.toThrow(/without a valid document URN/i);
  });
});

describe("Deployment safety", () => {
  it("blocks live DataHub in the default public deployment profile", () => {
    expect(() => createGateway({ DATAHUB_MODE: "live", DATAHUB_MCP_URL: "http://localhost:8080/mcp" })).toThrow(/blocked in the public deployment profile/i);
  });
});
