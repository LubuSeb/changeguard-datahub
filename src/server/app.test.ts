import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DemoDataHubGateway, type DataHubGateway } from "./datahub/gateway.js";

function testApp(gateway: DataHubGateway = new DemoDataHubGateway()) {
  return createApp({
    gateway,
    allowedOrigins: ["http://localhost:5173"],
    serveClient: false,
  }).app;
}

describe("ChangeGuard API boundary", () => {
  it("returns explicit deployment and capability state", async () => {
    const response = await request(testApp()).get("/api/health").expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      mode: "demo",
      deployment: "public",
      mutationEnabled: true,
      integration: "Simulated DataHub fixture",
    });
    expect(response.body.tools).toContain("list_schema_fields");
  });

  it("rejects unapproved browser origins and never emits a wildcard CORS header", async () => {
    const denied = await request(testApp()).get("/api/health").set("Origin", "https://attacker.example").expect(403);
    expect(denied.body.error).toMatch(/origin is not allowed/i);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    const allowed = await request(testApp()).get("/api/health").set("Origin", "http://localhost:5173").expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("enforces change-specific proposal contracts", async () => {
    const response = await request(testApp())
      .post("/api/analyze")
      .send({
        assetUrn: "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)",
        field: "country_code",
        changeType: "rename",
        rationale: "Rename the market key across the governed consumer graph.",
      })
      .expect(400);
    expect(response.body.error).toMatch(/invalid input/i);
  });

  it.each([
    ["same-name rename", { changeType: "rename", targetValue: "country_code" }, /current field name/i],
    ["equivalent type", { changeType: "type", targetValue: "VARCHAR(2)" }, /equivalent to the current/i],
    ["existing non-nullability", { changeType: "nullable", targetValue: "required" }, /already non-nullable/i],
    ["dialect-incompatible type", { changeType: "type", targetValue: "STRING" }, /not a supported postgres/i],
  ])("returns 400 for %s", async (_label, change, error) => {
    const response = await request(testApp())
      .post("/api/analyze")
      .send({
        assetUrn: "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)",
        field: "country_code",
        rationale: "Reject invalid or semantically empty schema change requests.",
        ...change,
      })
      .expect(400);
    expect(response.body.error).toMatch(error);
  });

  it("blocks the publish route when the gateway is read-only", async () => {
    const demo = new DemoDataHubGateway();
    const readOnly: DataHubGateway = {
      mode: "demo",
      deployment: "public",
      mutationEnabled: false,
      capabilities: async () => ({ tools: ["search", "get_entities", "list_schema_fields", "get_lineage"], mutationEnabled: false }),
      snapshot: demo.snapshot.bind(demo),
      context: demo.context.bind(demo),
      publish: demo.publish.bind(demo),
    };
    await request(testApp(readOnly)).post("/api/passports/not-present/publish").expect(403, {
      error: "Write-back is disabled for this deployment.",
    });
  });

  it("sets basic hardening headers", async () => {
    const response = await request(testApp()).get("/api/catalog").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
