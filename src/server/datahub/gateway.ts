import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CatalogAsset,
  CatalogSnapshot,
  ChangePassport,
  DeploymentProfile,
  ImpactedAsset,
  LineageEdge,
  PublishReceipt,
  SchemaField,
  ToolTrace,
} from "../../shared/types.js";
import { assets, edges, seedSnapshot } from "../data/seed.js";

export interface AnalysisContext {
  source: CatalogAsset;
  fields: SchemaField[];
  downstream: ImpactedAsset[];
  graphAssets: CatalogAsset[];
  graphEdges: LineageEdge[];
  trace: ToolTrace[];
}

export interface GatewayCapabilities {
  tools: string[];
  mutationEnabled: boolean;
}

export interface DataHubGateway {
  readonly mode: "demo" | "live";
  readonly deployment: DeploymentProfile;
  readonly mutationEnabled: boolean;
  capabilities(): Promise<GatewayCapabilities>;
  snapshot(): Promise<CatalogSnapshot>;
  context(assetUrn: string, field: string): Promise<AnalysisContext>;
  publish(passport: ChangePassport): Promise<PublishReceipt>;
  close?(): Promise<void>;
}

export interface McpInvoker {
  connect(): Promise<void>;
  listTools(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

class SdkMcpInvoker implements McpInvoker {
  private readonly client = new Client({ name: "changeguard", version: "0.2.0" });

  constructor(private readonly endpoint: string, private readonly token?: string) {}

  async connect() {
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint), { requestInit: { headers } });
    await this.client.connect(transport);
  }

  async listTools() {
    return this.client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  async close() {
    await this.client.close();
  }
}

function findDownstream(sourceUrn: string, field: string): ImpactedAsset[] {
  const queue: Array<{ urn: string; field: string; hops: number }> = [{ urn: sourceUrn, field, hops: 0 }];
  const seen = new Set<string>([`${sourceUrn}:${field}`]);
  const results = new Map<string, ImpactedAsset>();

  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges.filter((item) => item.source === current.urn)) {
      const mapped = edge.fieldMap?.[current.field] ?? [];
      const targetFields = mapped.length ? mapped : [current.field];
      const target = assets.find((item) => item.urn === edge.target);
      if (!target) continue;
      const impactedFields = targetFields.filter((name) => target.fields.some((candidate) => candidate.name === name));
      if (!impactedFields.length) continue;

      const prior = results.get(target.urn);
      const mergedFields = [...new Set([...(prior?.impactedFields ?? []), ...impactedFields])];
      results.set(target.urn, {
        ...structuredClone(target),
        hops: Math.min(prior?.hops ?? Number.POSITIVE_INFINITY, current.hops + 1),
        impactScope: "field",
        impactedFields: mergedFields,
        impactReason: `The simulated column mapping maps ${current.field} into ${impactedFields.join(", ")}.`,
        severity: "moderate",
      });

      for (const targetField of impactedFields) {
        const key = `${target.urn}:${targetField}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push({ urn: target.urn, field: targetField, hops: current.hops + 1 });
        }
      }
    }
  }

  return [...results.values()].sort((a, b) => a.hops - b.hops || b.usagePerWeek - a.usagePerWeek);
}

export class DemoDataHubGateway implements DataHubGateway {
  readonly mode = "demo" as const;
  readonly deployment = "public" as const;
  readonly mutationEnabled = true;
  private receipts = new Map<string, PublishReceipt>();

  async capabilities(): Promise<GatewayCapabilities> {
    return {
      tools: ["get_entities", "get_lineage", "list_schema_fields", "save_document", "search"],
      mutationEnabled: true,
    };
  }

  async snapshot(): Promise<CatalogSnapshot> {
    return seedSnapshot();
  }

  async context(assetUrn: string, field: string): Promise<AnalysisContext> {
    const source = assets.find((item) => item.urn === assetUrn);
    if (!source) throw new Error("The selected asset is not present in the simulated DataHub graph.");
    const downstream = findDownstream(assetUrn, field);
    const graphUrns = new Set([source.urn, ...downstream.map((item) => item.urn)]);
    return {
      source: structuredClone(source),
      fields: structuredClone(source.fields),
      downstream,
      graphAssets: assets.filter((item) => graphUrns.has(item.urn)).map((item) => structuredClone(item)),
      graphEdges: edges.filter((item) => graphUrns.has(item.source) && graphUrns.has(item.target)).map((item) => structuredClone(item)),
      trace: [
        { tool: "get_entities", status: "success", summary: `Simulated entity lookup loaded ownership, domains, and tags for ${source.qualifiedName}.`, source: "Simulated fixture operation" },
        { tool: "list_schema_fields", status: "success", summary: `Simulated schema lookup returned ${source.fields.length} fields.`, source: "Simulated fixture operation" },
        { tool: "get_lineage", status: "success", summary: `Simulated lineage lookup returned ${downstream.length} downstream assets across ${Math.max(0, ...downstream.map((item) => item.hops))} hops.`, source: "Simulated fixture operation" },
      ],
    };
  }

  async publish(passport: ChangePassport): Promise<PublishReceipt> {
    const existing = this.receipts.get(passport.id);
    if (existing) return existing;
    const receipt: PublishReceipt = {
      receiptId: `demo-${crypto.randomUUID()}`,
      passportId: passport.id,
      mode: "demo",
      tool: "save_document",
      documentUrn: `urn:li:document:changeguard-${passport.id}`,
      publishedAt: new Date().toISOString(),
      message: "Decision record saved in the simulated fixture store. No external system was changed.",
    };
    this.receipts.set(passport.id, receipt);
    return receipt;
  }
}

type JsonObject = Record<string, unknown>;
type McpContent = { type?: string; text?: string };

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (block) return JSON.parse(block);
    throw new Error("DataHub MCP returned non-JSON tool output.");
  }
}

function resultValue(result: unknown): unknown {
  const object = asObject(result);
  if (!object) throw new Error("DataHub MCP returned an invalid tool result.");
  if (object.isError === true) throw new Error(`DataHub MCP tool failed: ${JSON.stringify(object.content ?? object)}`);
  const structured = asObject(object.structuredContent);
  if (structured) return structured;
  const text = asArray(object.content)
    .map((part) => asObject(part) as McpContent | undefined)
    .map((part) => part?.text ?? "")
    .filter(Boolean)
    .join("\n");
  return text ? parseJsonText(text) : object;
}

function namedMetadata(value: unknown): string | undefined {
  const object = asObject(value);
  if (!object) return firstString(value);
  const properties = asObject(object.properties);
  return firstString(object.name, object.displayName, object.username, properties?.name, properties?.displayName);
}

function ownershipName(raw: JsonObject): string {
  const ownership = asObject(raw.ownership);
  const firstOwner = asObject(asArray(ownership?.owners)[0]);
  return namedMetadata(firstOwner?.owner) ?? namedMetadata(firstOwner) ?? "Unassigned";
}

function domainName(raw: JsonObject): string {
  const domain = asObject(raw.domain);
  return namedMetadata(domain?.domain) ?? namedMetadata(domain) ?? "Unassigned";
}

function tagNames(raw: JsonObject): string[] {
  const tags = asObject(raw.tags);
  return asArray(tags?.tags)
    .map((entry) => asObject(entry))
    .map((entry) => namedMetadata(entry?.tag) ?? namedMetadata(entry))
    .filter((name): name is string => Boolean(name));
}

function inferKind(value: string): CatalogAsset["kind"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("dashboard") || normalized.includes("chart")) return "dashboard";
  if (normalized.includes("feature")) return "mlFeature";
  if (normalized.includes("model")) return "mlModel";
  if (normalized.includes("datajob") || normalized.includes("transform")) return "transform";
  return "dataset";
}

function platformFromUrn(urn: string): string | undefined {
  const platform = urn.match(/urn:li:dataPlatform:([^,)]+)/)?.[1];
  if (!platform) return undefined;
  return platform === "postgres" ? "PostgreSQL" : platform[0].toUpperCase() + platform.slice(1);
}

function normalizeAsset(raw: JsonObject, fallbackUrn: string, certificationTags: readonly string[] = ["Certified"]): CatalogAsset {
  const properties = asObject(raw.properties);
  const urn = firstString(raw.urn, raw.entityUrn, fallbackUrn) ?? fallbackUrn;
  const name = firstString(raw.name, properties?.name, properties?.displayName, urn.split(",").at(-2)) ?? "DataHub asset";
  const tags = tagNames(raw);
  return {
    urn,
    name,
    qualifiedName: firstString(raw.qualifiedName, properties?.qualifiedName, properties?.name, name) ?? name,
    platform: namedMetadata(raw.platform) ?? namedMetadata(properties?.platform) ?? platformFromUrn(urn) ?? "DataHub",
    kind: inferKind(firstString(raw.type, raw.entityType, "dataset") ?? "dataset"),
    description: firstString(raw.description, properties?.description) ?? "Metadata loaded from DataHub.",
    owner: ownershipName(raw),
    domain: domainName(raw),
    tags,
    hasCertificationTag: tags.some((tag) =>
      certificationTags.some((signal) => tag.toLowerCase() === signal.toLowerCase()),
    ),
    qualityScore: 0,
    usagePerWeek: 0,
    fields: [],
  };
}

function normalizeField(value: unknown): SchemaField | undefined {
  const raw = asObject(value);
  if (!raw) return undefined;
  const name = firstString(raw.fieldPath, raw.name);
  if (!name) return undefined;
  const description = asObject(raw.description);
  return {
    name,
    type: firstString(raw.nativeDataType, raw.type) ?? "unknown",
    nullable: typeof raw.nullable === "boolean" ? raw.nullable : true,
    description: firstString(raw.description, description?.text) ?? "",
    tags: tagNames(raw),
  };
}

export function parseSearchResponse(value: unknown): JsonObject[] {
  const root = asObject(value);
  if (!root) throw new Error("DataHub search returned an invalid response.");
  return asArray(root.searchResults)
    .map((result) => asObject(result))
    .map((result) => asObject(result?.entity))
    .filter((entity): entity is JsonObject => Boolean(entity?.urn || entity?.entityUrn));
}

export function parseEntitiesResponse(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(asObject).filter((item): item is JsonObject => Boolean(item));
  const root = asObject(value);
  if (!root) throw new Error("DataHub get_entities returned an invalid response.");
  if (root.urn || root.entityUrn) return [root];
  const entity = asObject(root.entity);
  if (entity) return [entity];
  const result = asArray(root.result).map(asObject).filter((item): item is JsonObject => Boolean(item));
  if (result.length) return result;
  return asArray(root.entities).map(asObject).filter((item): item is JsonObject => Boolean(item));
}

export function parseSchemaResponse(value: unknown): { fields: SchemaField[]; remainingCount: number } {
  const root = asObject(value);
  if (!root) throw new Error("DataHub list_schema_fields returned an invalid response.");
  const fields = asArray(root.fields).map(normalizeField).filter((field): field is SchemaField => Boolean(field));
  const remainingCount = typeof root.remainingCount === "number" ? root.remainingCount : 0;
  return { fields, remainingCount };
}

interface LineageResult {
  entity: JsonObject;
  hops: number;
  columns: string[];
}

export function parseLineageResponse(value: unknown): LineageResult[] {
  const root = asObject(value);
  const downstreams = asObject(root?.downstreams);
  if (!root || !downstreams) throw new Error("DataHub get_lineage returned no downstream result container.");
  return asArray(downstreams.searchResults)
    .map((item) => asObject(item))
    .map((item) => {
      const entity = asObject(item?.entity);
      if (!item || !entity) return undefined;
      const columns = asArray(item.lineageColumns)
        .map((column) => typeof column === "string" ? column : firstString(asObject(column)?.fieldPath, asObject(column)?.name))
        .filter((column): column is string => Boolean(column));
      return { entity, hops: Number(item.degree ?? 1), columns };
    })
    .filter((item): item is LineageResult => Boolean(item));
}

function parseToolNames(value: unknown): string[] {
  const root = asObject(value);
  if (!root) throw new Error("DataHub MCP tool discovery returned an invalid response.");
  return asArray(root.tools)
    .map((tool) => firstString(asObject(tool)?.name))
    .filter((name): name is string => Boolean(name));
}

export class McpDataHubGateway implements DataHubGateway {
  readonly mode = "live" as const;
  readonly deployment = "private" as const;
  private connected = false;
  private toolNames = new Set<string>();

  constructor(
    endpoint: string,
    token?: string,
    private readonly allowMutation = false,
    private readonly invoker: McpInvoker = new SdkMcpInvoker(endpoint, token),
    private readonly certificationTags: readonly string[] = ["Certified"],
  ) {}

  get mutationEnabled() {
    return this.allowMutation && this.toolNames.has("save_document");
  }

  private async connect() {
    if (this.connected) return;
    await this.invoker.connect();
    this.toolNames = new Set(parseToolNames(await this.invoker.listTools()));
    this.connected = true;
  }

  private async requireTools(...tools: string[]) {
    await this.connect();
    const missing = tools.filter((tool) => !this.toolNames.has(tool));
    if (missing.length) throw new Error(`DataHub MCP is missing required tools: ${missing.join(", ")}.`);
  }

  private async call(tool: string, args: Record<string, unknown>) {
    await this.requireTools(tool);
    return resultValue(await this.invoker.callTool(tool, args));
  }

  async capabilities(): Promise<GatewayCapabilities> {
    await this.connect();
    return { tools: [...this.toolNames].sort(), mutationEnabled: this.mutationEnabled };
  }

  private async loadFields(urn: string): Promise<SchemaField[]> {
    const fields: SchemaField[] = [];
    let offset = 0;
    do {
      const page = parseSchemaResponse(await this.call("list_schema_fields", { urn, limit: 100, offset }));
      fields.push(...page.fields);
      if (!page.remainingCount || !page.fields.length) break;
      offset += page.fields.length;
      if (offset >= 1000) throw new Error(`Schema for ${urn} exceeds the 1,000-field safety limit.`);
    } while (true);
    return [...new Map(fields.map((field) => [field.name, field])).values()];
  }

  async snapshot(): Promise<CatalogSnapshot> {
    await this.requireTools("search", "list_schema_fields");
    const search = await this.call("search", { query: "*", filter: "entity_type = dataset", num_results: 20 });
    const entities = parseSearchResponse(search);
    const catalogAssets: CatalogAsset[] = [];
    for (const entity of entities) {
      const asset = normalizeAsset(entity, String(entity.urn ?? entity.entityUrn), this.certificationTags);
      asset.fields = await this.loadFields(asset.urn);
      if (asset.fields.length) catalogAssets.push(asset);
    }
    if (!catalogAssets.length) throw new Error("DataHub search returned no datasets with selectable schema fields.");
    return { assets: catalogAssets, edges: [], mode: "live", capturedAt: new Date().toISOString() };
  }

  async context(assetUrn: string, field: string): Promise<AnalysisContext> {
    await this.requireTools("get_entities", "list_schema_fields", "get_lineage");
    const [entityRaw, fields, lineageRaw] = await Promise.all([
      this.call("get_entities", { urns: [assetUrn] }),
      this.loadFields(assetUrn),
      this.call("get_lineage", {
        urn: assetUrn,
        column: field,
        upstream: false,
        max_hops: 3,
        max_results: 100,
      }),
    ]);
    const entity = parseEntitiesResponse(entityRaw).find((item) => item.urn === assetUrn || item.entityUrn === assetUrn);
    if (!entity) throw new Error(`DataHub get_entities did not return ${assetUrn}.`);
    const source = normalizeAsset(entity, assetUrn, this.certificationTags);
    source.fields = fields;
    if (!fields.some((candidate) => candidate.name === field)) {
      throw new Error(`Field ${field} is not present in the live DataHub schema for ${source.qualifiedName}.`);
    }

    const downstream = parseLineageResponse(lineageRaw).map((item) => {
      const hasColumnMapping = item.columns.length > 0;
      return {
        ...normalizeAsset(item.entity, String(item.entity.urn), this.certificationTags),
        hops: item.hops,
        impactScope: hasColumnMapping ? "field" as const : "asset" as const,
        impactedFields: item.columns,
        impactReason: hasColumnMapping
          ? `DataHub column lineage maps ${field} into ${item.columns.join(", ")}.`
          : "DataHub returned this downstream asset without lineageColumns; field impact is unknown.",
        severity: "moderate" as const,
      };
    });
    const unique = [...new Map(downstream.map((item) => [item.urn, item])).values()];
    return {
      source,
      fields,
      downstream: unique,
      graphAssets: [source, ...unique],
      graphEdges: unique.map((item) => ({ source: source.urn, target: item.urn, relation: "impact" as const })),
      trace: [
        { tool: "get_entities", status: "success", summary: `Loaded authoritative entity metadata for ${source.qualifiedName}.`, source: "DataHub MCP" },
        { tool: "list_schema_fields", status: "success", summary: `Loaded ${fields.length} fields from the live schema.`, source: "DataHub MCP" },
        { tool: "get_lineage", status: "success", summary: `Traced ${unique.length} downstream catalog assets.`, source: "DataHub MCP" },
      ],
    };
  }

  async publish(passport: ChangePassport): Promise<PublishReceipt> {
    if (!this.allowMutation) throw new Error("Live DataHub write-back is disabled. Set DATAHUB_ALLOW_MUTATION=true only in a private deployment.");
    await this.requireTools("save_document");
    const content = [
      `# ${passport.title}`,
      `**Risk:** ${passport.riskScore}/100 (${passport.riskLevel})`,
      `**Verdict:** ${passport.verdict}`,
      passport.summary,
      "## Rollout plan",
      ...passport.steps.map((step, index) => `${index + 1}. **${step.title}** - ${step.detail}`),
      "## Validation",
      ...passport.validations.map((check) => `- **${check.name}:** \`${check.expected}\``),
      `## Rollback\n${passport.rollback}`,
    ].join("\n\n");
    const result = asObject(await this.call("save_document", {
      document_type: "Decision",
      title: passport.title,
      content,
      topics: ["changeguard", "schema-change", passport.riskLevel],
      related_assets: [passport.source.urn, ...passport.impacted.map((asset) => asset.urn)],
    }));
    if (!result || result.success !== true) {
      throw new Error(`DataHub save_document rejected the write: ${firstString(result?.message) ?? "unknown failure"}.`);
    }
    const documentUrn = firstString(result.urn, result.documentUrn);
    if (!documentUrn?.startsWith("urn:li:document:")) {
      throw new Error("DataHub save_document reported success without a valid document URN.");
    }
    return {
      receiptId: documentUrn,
      passportId: passport.id,
      mode: "live",
      tool: "save_document",
      documentUrn,
      publishedAt: new Date().toISOString(),
      message: firstString(result.message) ?? "Decision record saved through the DataHub MCP server.",
    };
  }

  async close() {
    if (this.connected) await this.invoker.close();
  }
}

function deploymentProfile(environment: NodeJS.ProcessEnv): DeploymentProfile {
  const configured = environment.CHANGEGUARD_DEPLOYMENT?.toLowerCase() ?? "public";
  if (configured !== "public" && configured !== "private") {
    throw new Error("CHANGEGUARD_DEPLOYMENT must be public or private.");
  }
  return configured;
}

export function createGateway(environment: NodeJS.ProcessEnv = process.env): DataHubGateway {
  const mode = environment.DATAHUB_MODE?.toLowerCase() ?? "demo";
  const deployment = deploymentProfile(environment);
  if (mode !== "demo" && mode !== "live") throw new Error("DATAHUB_MODE must be demo or live.");
  if (mode === "live") {
    if (deployment !== "private") {
      throw new Error("Live DataHub mode is blocked in the public deployment profile. Set CHANGEGUARD_DEPLOYMENT=private for an internal deployment.");
    }
    const endpoint = environment.DATAHUB_MCP_URL;
    if (!endpoint) throw new Error("DATAHUB_MCP_URL is required when DATAHUB_MODE=live.");
    return new McpDataHubGateway(
      endpoint,
      environment.DATAHUB_TOKEN,
      environment.DATAHUB_ALLOW_MUTATION?.toLowerCase() === "true",
      undefined,
      environment.DATAHUB_CERTIFICATION_TAGS?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? ["Certified"],
    );
  }
  return new DemoDataHubGateway();
}
