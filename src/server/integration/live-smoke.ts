import { createPassport } from "../agent/planner.js";
import { createGateway } from "../datahub/gateway.js";

const sourceUrn = "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)";
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DATAHUB_MODE: "live",
  CHANGEGUARD_DEPLOYMENT: "private",
  DATAHUB_MCP_URL: process.env.DATAHUB_MCP_URL ?? "http://127.0.0.1:8005/mcp",
};

const gateway = createGateway(environment);

try {
  const capabilities = await gateway.capabilities();
  const catalog = await gateway.snapshot();
  const source = catalog.assets.find((asset) => asset.urn === sourceUrn);
  if (!source) throw new Error(`Seeded source ${sourceUrn} was not returned by live search.`);
  if (!source.fields.some((field) => field.name === "country_code")) {
    throw new Error("Live schema hydration did not return country_code.");
  }

  const context = await gateway.context(sourceUrn, "country_code");
  const passport = createPassport({
    assetUrn: sourceUrn,
    field: "country_code",
    changeType: "rename",
    targetValue: "market_code",
    rationale: "Verify the complete live DataHub MCP integration against seeded local metadata.",
  }, context);
  const receipt = capabilities.mutationEnabled ? await gateway.publish(passport) : undefined;

  console.log(JSON.stringify({
    endpoint: environment.DATAHUB_MCP_URL,
    tools: capabilities.tools,
    mutationEnabled: capabilities.mutationEnabled,
    catalogAssets: catalog.assets.length,
    sourceFields: source.fields.length,
    downstreamAssets: context.downstream.length,
    downstreamImpact: context.downstream.map((asset) => ({
      urn: asset.urn,
      scope: asset.impactScope,
      fields: asset.impactedFields,
      hops: asset.hops,
    })),
    validationDialect: source.platform,
    validationSql: passport.validations.map((validation) => validation.sql),
    receipt: receipt ? { documentUrn: receipt.documentUrn, message: receipt.message } : null,
  }, null, 2));
} finally {
  await gateway.close?.();
}
