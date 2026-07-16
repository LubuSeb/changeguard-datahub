export type AssetKind = "dataset" | "transform" | "dashboard" | "mlFeature" | "mlModel";
export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type ChangeType = "drop" | "rename" | "type" | "nullable";
export type DeploymentProfile = "public" | "private";

export interface SchemaField {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
  tags?: string[];
}

export interface CatalogAsset {
  urn: string;
  name: string;
  qualifiedName: string;
  platform: string;
  kind: AssetKind;
  description: string;
  owner: string;
  domain: string;
  tags: string[];
  hasCertificationTag: boolean;
  qualityScore: number;
  usagePerWeek: number;
  fields: SchemaField[];
}

export interface LineageEdge {
  source: string;
  target: string;
  relation?: "lineage" | "impact";
  fieldMap?: Record<string, string[]>;
}

export interface CatalogSnapshot {
  assets: CatalogAsset[];
  edges: LineageEdge[];
  mode: "demo" | "live";
  capturedAt: string;
}

interface BaseChangeProposal {
  assetUrn: string;
  field: string;
  rationale: string;
}

export interface DropChangeProposal extends BaseChangeProposal {
  changeType: "drop";
  targetValue?: never;
}

export interface RenameChangeProposal extends BaseChangeProposal {
  changeType: "rename";
  targetValue: string;
}

export interface TypeChangeProposal extends BaseChangeProposal {
  changeType: "type";
  targetValue: string;
}

export interface NullabilityChangeProposal extends BaseChangeProposal {
  changeType: "nullable";
  targetValue: "nullable" | "required";
}

export type ChangeProposal =
  | DropChangeProposal
  | RenameChangeProposal
  | TypeChangeProposal
  | NullabilityChangeProposal;

export interface ChangeProposalDraft {
  assetUrn: string;
  field: string;
  changeType: ChangeType;
  targetValue?: string;
  rationale: string;
}

export interface ImpactedAsset extends CatalogAsset {
  hops: number;
  impactScope: "field" | "asset";
  impactedFields: string[];
  impactReason: string;
  severity: RiskLevel;
}

export interface PlanStep {
  phase: "prepare" | "dual-run" | "migrate" | "verify" | "retire";
  title: string;
  owner: string;
  detail: string;
  evidence: string;
  blocking: boolean;
}

export interface ValidationCheck {
  name: string;
  sql: string;
  expected: string;
}

export interface ToolTrace {
  tool: string;
  status: "success" | "skipped";
  summary: string;
  source: "DataHub MCP" | "Simulated fixture operation";
}

export interface ChangePassport {
  id: string;
  createdAt: string;
  title: string;
  proposal: ChangeProposal;
  source: CatalogAsset;
  riskScore: number;
  riskLevel: RiskLevel;
  verdict: "safe-with-plan" | "requires-approval" | "blocked";
  summary: string;
  impacted: ImpactedAsset[];
  graph: { assets: CatalogAsset[]; edges: LineageEdge[] };
  steps: PlanStep[];
  validations: ValidationCheck[];
  notifications: Array<{ owner: string; assets: string[]; message: string }>;
  trace: ToolTrace[];
  assumptions: string[];
  rollback: string;
}

export interface PublishReceipt {
  receiptId: string;
  passportId: string;
  mode: "demo" | "live";
  tool: string;
  documentUrn?: string;
  publishedAt: string;
  message: string;
}

export interface HealthResponse {
  ok: boolean;
  mode: "demo" | "live";
  deployment: DeploymentProfile;
  integration: string;
  mutationEnabled: boolean;
  tools: string[];
}
