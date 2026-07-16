import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createLambdaApp, handler } from "./lambda.js";

const originalMode = process.env.DATAHUB_MODE;
const originalEndpoint = process.env.DATAHUB_MCP_URL;

afterEach(() => {
  if (originalMode === undefined) delete process.env.DATAHUB_MODE;
  else process.env.DATAHUB_MODE = originalMode;
  if (originalEndpoint === undefined) delete process.env.DATAHUB_MCP_URL;
  else process.env.DATAHUB_MCP_URL = originalEndpoint;
});

describe("AWS Lambda public demo handler", () => {
  it("exports a supported Lambda handler", () => {
    expect(typeof handler).toBe("function");
  });

  it("forces the public Lambda app to the simulated demo even when live variables exist", async () => {
    process.env.DATAHUB_MODE = "live";
    process.env.DATAHUB_MCP_URL = "https://credentials-must-not-be-used.invalid/mcp";
    const response = await request(createLambdaApp()).get("/api/health").expect(200);
    expect(response.body).toMatchObject({
      mode: "demo",
      deployment: "public",
      integration: "Simulated DataHub fixture",
      mutationEnabled: true,
    });
  });

  it("serves same-origin Function URL requests without opening cross-origin access", async () => {
    await request(createLambdaApp())
      .get("/api/health")
      .set("Host", "abc.lambda-url.eu-north-1.on.aws")
      .set("Origin", "https://abc.lambda-url.eu-north-1.on.aws")
      .expect(200);

    await request(createLambdaApp())
      .get("/api/health")
      .set("Host", "abc.lambda-url.eu-north-1.on.aws")
      .set("Origin", "https://attacker.example")
      .expect(403);
  });
});
