import type {
  CatalogAsset,
  ChangePassport,
  ChangeProposal,
  ImpactedAsset,
  PlanStep,
  RiskLevel,
  ValidationCheck,
} from "../../shared/types.js";
import type { AnalysisContext } from "../datahub/gateway.js";

function bounded(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function classify(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "moderate";
  return "low";
}

function assetSeverity(asset: ImpactedAsset, proposal: ChangeProposal): RiskLevel {
  let score = proposal.changeType === "drop" ? 35 : proposal.changeType === "type" ? 25 : 16;
  score += asset.hasCertificationTag ? 18 : 0;
  score += asset.tags.some((tag) => /sox|board|revenue|production|tier-1/i.test(tag)) ? 24 : 0;
  score += asset.kind === "mlModel" ? 18 : asset.kind === "dashboard" ? 12 : 6;
  score += Math.min(15, Math.log10(asset.usagePerWeek + 1) * 5);
  return classify(bounded(score));
}

function scoreRisk(source: CatalogAsset, downstream: ImpactedAsset[], proposal: ChangeProposal) {
  const base = { drop: 42, type: 32, rename: 24, nullable: 18 }[proposal.changeType];
  const criticalSignals = downstream.filter((asset) =>
    asset.tags.some((tag) => /sox|board|revenue|production|tier-1/i.test(tag)),
  ).length;
  const ownerCount = new Set(downstream.map((asset) => asset.owner)).size;
  return bounded(
    base
      + Math.min(20, downstream.length * 3)
      + Math.min(12, ownerCount * 2)
      + Math.min(18, criticalSignals * 6)
      + (source.tags.includes("PII") ? 4 : 0),
  );
}

function compatibilityStep(proposal: ChangeProposal): { title: string; detail: string } {
  if (proposal.changeType === "rename") {
    return {
      title: `Add ${proposal.targetValue} alongside ${proposal.field}`,
      detail: "Publish the new name as an additive alias. Preserve the old field while consumers migrate and compare both names.",
    };
  }
  if (proposal.changeType === "type") {
    return {
      title: `Dual-publish ${proposal.field} as ${proposal.targetValue}`,
      detail: "Publish a separately named compatibility representation in the target type. Preserve the original field until conversion checks and consumer migrations pass.",
    };
  }
  if (proposal.changeType === "drop") {
    return {
      title: `Deprecate ${proposal.field} without removing it`,
      detail: "Mark the field deprecated and stop new consumers. Keep it physically present until every cataloged consumer acknowledges removal.",
    };
  }
  return proposal.targetValue === "required"
    ? {
        title: `Backfill nulls before enforcing ${proposal.field}`,
        detail: "Backfill existing nulls, add a validation constraint, then enforce the required contract only after the null guard reaches zero.",
      }
    : {
        title: `Permit nulls in ${proposal.field}`,
        detail: "Update the contract and consumers to accept null explicitly before any producer begins emitting null values.",
      };
}

function buildSteps(source: CatalogAsset, impacted: ImpactedAsset[], proposal: ChangeProposal): PlanStep[] {
  const compatibility = compatibilityStep(proposal);
  const owners = [...new Set(impacted.map((asset) => asset.owner))];
  return [
    {
      phase: "prepare",
      title: "Freeze the contract and notify owners",
      owner: source.owner,
      detail: `Record the proposed ${proposal.changeType} for ${source.qualifiedName}.${proposal.field}; request acknowledgement from ${owners.join(", ") || "downstream owners"}.`,
      evidence: `${impacted.length} downstream assets and ${owners.length} owner groups found in DataHub.`,
      blocking: true,
    },
    {
      phase: "dual-run",
      title: compatibility.title,
      owner: source.owner,
      detail: compatibility.detail,
      evidence: "Destructive and semantic schema changes require a reversible overlap window.",
      blocking: true,
    },
    {
      phase: "migrate",
      title: "Migrate in lineage order",
      owner: owners[0] ?? source.owner,
      detail: `Update ${impacted.map((asset) => asset.name).join(" -> ") || "registered consumers"}, starting with the nearest transformation and ending at user-facing or model assets.`,
      evidence: "DataHub hop distance determines the rollout order.",
      blocking: true,
    },
    {
      phase: "verify",
      title: "Hold on catalog and data checks",
      owner: "Data Reliability",
      detail: "Require schema, null-rate, row-count, freshness, and consumer smoke checks before completing the change.",
      evidence: "Generated checks cover structural and behavioral regressions.",
      blocking: true,
    },
    {
      phase: "retire",
      title: "Retire only after explicit deprecation evidence",
      owner: source.owner,
      detail: `Complete the ${proposal.changeType} only after all cataloged consumers are migrated and uncataloged-consumer monitoring shows no regressions.`,
      evidence: "Catalog lineage, owner acknowledgements, and runtime monitoring close the retirement gate.",
      blocking: false,
    },
  ];
}

type SqlDialect = "bigquery" | "postgres" | "snowflake" | "standard";

export class InvalidChangeProposalError extends Error {}

function sqlDialect(source: CatalogAsset): SqlDialect {
  const platform = source.platform.toLowerCase();
  if (platform.includes("postgres")) return "postgres";
  if (platform.includes("snowflake")) return "snowflake";
  if (platform.includes("bigquery")) return "bigquery";
  return "standard";
}

function quoteIdentifier(value: string, dialect: SqlDialect): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}.`);
  return dialect === "bigquery" ? `\`${value}\`` : `"${value}"`;
}

function tableName(source: CatalogAsset, dialect: SqlDialect): string {
  const parts = source.qualifiedName.split(".");
  if (!parts.length || parts.some((part) => !part)) {
    throw new InvalidChangeProposalError("The source dataset has no valid qualified name.");
  }
  for (const part of parts) quoteIdentifier(part, dialect);
  if (dialect === "postgres") {
    if (parts.length > 3) {
      throw new InvalidChangeProposalError("PostgreSQL dataset names must be relation, schema.relation, or database.schema.relation.");
    }
    // DataHub's PostgreSQL name is database.schema.relation; SQL runs while connected
    // to that database, where the physical relation is schema.relation.
    const relationParts = parts.length === 3 ? parts.slice(1) : parts;
    return relationParts.map((part) => quoteIdentifier(part, dialect)).join(".");
  }
  if (dialect === "bigquery") {
    if (parts.length > 3) throw new InvalidChangeProposalError("BigQuery dataset names must not exceed project.dataset.table.");
    return `\`${parts.join(".")}\``;
  }
  return parts.map((part) => quoteIdentifier(part, dialect)).join(".");
}

function countWhen(condition: string, dialect: SqlDialect): string {
  return dialect === "bigquery"
    ? `COUNTIF(${condition})`
    : `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
}

function textType(dialect: SqlDialect): string {
  return dialect === "bigquery" ? "STRING" : dialect === "postgres" ? "TEXT" : "VARCHAR";
}

interface NormalizedSqlType {
  canonical: string;
  sql: string;
}

const TYPE_ALIASES: Record<SqlDialect, Record<string, string>> = {
  postgres: {
    BIGINT: "BIGINT", BIGSERIAL: "BIGSERIAL", BOOL: "BOOLEAN", BOOLEAN: "BOOLEAN", BYTEA: "BYTEA",
    CHAR: "CHAR", CHARACTER: "CHAR", "CHARACTER VARYING": "VARCHAR", DATE: "DATE", DECIMAL: "NUMERIC",
    "DOUBLE PRECISION": "DOUBLE PRECISION", INT: "INTEGER", INT2: "SMALLINT", INT4: "INTEGER", INT8: "BIGINT",
    INTEGER: "INTEGER", JSON: "JSON", JSONB: "JSONB", NUMERIC: "NUMERIC", REAL: "REAL", SERIAL: "SERIAL",
    SMALLINT: "SMALLINT", TEXT: "TEXT", TIME: "TIME", "TIME WITH TIME ZONE": "TIMETZ", TIMESTAMP: "TIMESTAMP",
    TIMESTAMP_TZ: "TIMESTAMPTZ", TIMESTAMPTZ: "TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
    UUID: "UUID", VARCHAR: "VARCHAR",
  },
  bigquery: {
    BIGNUMERIC: "BIGNUMERIC", BOOL: "BOOL", BOOLEAN: "BOOL", BYTES: "BYTES", DATE: "DATE", DATETIME: "DATETIME",
    FLOAT64: "FLOAT64", GEOGRAPHY: "GEOGRAPHY", INT64: "INT64", INTERVAL: "INTERVAL", JSON: "JSON",
    NUMERIC: "NUMERIC", STRING: "STRING", TIME: "TIME", TIMESTAMP: "TIMESTAMP",
  },
  snowflake: {
    ARRAY: "ARRAY", BIGINT: "BIGINT", BINARY: "BINARY", BOOL: "BOOLEAN", BOOLEAN: "BOOLEAN", CHAR: "VARCHAR",
    CHARACTER: "VARCHAR", DATE: "DATE", DECIMAL: "NUMBER", DOUBLE: "FLOAT", FLOAT: "FLOAT", INT: "INTEGER",
    INTEGER: "INTEGER", NUMBER: "NUMBER", NUMERIC: "NUMBER", OBJECT: "OBJECT", REAL: "FLOAT", SMALLINT: "SMALLINT",
    STRING: "VARCHAR", TEXT: "VARCHAR", TIME: "TIME", TIMESTAMP: "TIMESTAMP", TIMESTAMP_LTZ: "TIMESTAMP_LTZ",
    TIMESTAMP_NTZ: "TIMESTAMP_NTZ", TIMESTAMP_TZ: "TIMESTAMP_TZ", VARIANT: "VARIANT", VARCHAR: "VARCHAR",
  },
  standard: {
    BIGINT: "BIGINT", BOOLEAN: "BOOLEAN", CHAR: "CHAR", DATE: "DATE", DECIMAL: "NUMERIC", DOUBLE: "DOUBLE",
    FLOAT: "FLOAT", INTEGER: "INTEGER", NUMERIC: "NUMERIC", REAL: "REAL", SMALLINT: "SMALLINT", TEXT: "TEXT",
    TIME: "TIME", TIMESTAMP: "TIMESTAMP", VARCHAR: "VARCHAR",
  },
};

const PARAMETER_COUNTS: Partial<Record<string, readonly number[]>> = {
  BIGNUMERIC: [1, 2], BINARY: [1], BYTES: [1], CHAR: [1], NUMBER: [1, 2], NUMERIC: [1, 2],
  STRING: [1], TIME: [1], TIMESTAMP: [1], TIMESTAMPTZ: [1], TIMETZ: [1], VARCHAR: [1],
};

function targetType(value: string, dialect: SqlDialect): NormalizedSqlType {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  const match = normalized.match(/^([A-Z][A-Z0-9_]*(?: [A-Z][A-Z0-9_]*)*)(?:\((\d+)(?:,\s*(\d+))?\))?$/);
  if (!match) {
    throw new InvalidChangeProposalError("Target data type must be a simple SQL type such as VARCHAR(64), INTEGER, or NUMERIC(18,2).");
  }
  const inputName = match[1];
  const canonicalName = TYPE_ALIASES[dialect][inputName];
  if (!canonicalName) {
    const hint = dialect === "bigquery" && inputName === "VARCHAR" ? " Use STRING or STRING(length)." : "";
    throw new InvalidChangeProposalError(`${inputName} is not a supported ${dialect} target data type.${hint}`);
  }
  const parameters = [match[2], match[3]].filter((part): part is string => Boolean(part));
  if (parameters.some((part) => Number(part) <= 0)) {
    throw new InvalidChangeProposalError("Target data type parameters must be positive integers.");
  }
  if (parameters.length && !PARAMETER_COUNTS[canonicalName]?.includes(parameters.length)) {
    throw new InvalidChangeProposalError(`${canonicalName} does not accept ${parameters.length} type parameter(s) in ${dialect}.`);
  }
  const suffix = parameters.length ? `(${parameters.join(",")})` : "";
  return { canonical: `${canonicalName}${suffix}`, sql: `${canonicalName}${suffix}` };
}

function canonicalSourceType(value: string, dialect: SqlDialect): string {
  try {
    return targetType(value, dialect).canonical;
  } catch {
    return value.trim().replace(/\s+/g, " ").toUpperCase();
  }
}

function baselineValidation(table: string): ValidationCheck {
  return {
    name: "Row-count baseline",
    sql: `SELECT COUNT(*) AS row_count FROM ${table};`,
    expected: "Capture before the change; post-change count remains within the approved tolerance",
  };
}

function buildValidations(source: CatalogAsset, proposal: ChangeProposal): ValidationCheck[] {
  const dialect = sqlDialect(source);
  const table = tableName(source, dialect);
  const field = quoteIdentifier(proposal.field, dialect);
  const baseline = baselineValidation(table);

  if (proposal.changeType === "rename") {
    const renamed = quoteIdentifier(proposal.targetValue, dialect);
    return [
      baseline,
      {
        name: "Rename null parity",
        sql: `SELECT ${countWhen(`${field} IS NULL`, dialect)} AS old_nulls, ${countWhen(`${renamed} IS NULL`, dialect)} AS new_nulls FROM ${table};`,
        expected: "old_nulls equals new_nulls",
      },
      {
        name: "Rename value parity",
        sql: `SELECT ${countWhen(`CAST(${field} AS ${textType(dialect)}) <> CAST(${renamed} AS ${textType(dialect)}) OR (${field} IS NULL) <> (${renamed} IS NULL)`, dialect)} AS mismatches FROM ${table};`,
        expected: "0 mismatches during the compatibility phase",
      },
    ];
  }

  if (proposal.changeType === "type") {
    const type = targetType(proposal.targetValue, dialect).sql;
    return [
      baseline,
      {
        name: "Target-type conversion probe",
        sql: `SELECT CAST(${field} AS ${type}) AS converted_value FROM ${table} WHERE ${field} IS NOT NULL LIMIT 100;`,
        expected: "Query completes without conversion errors on the reviewed sample",
      },
      {
        name: "Source null baseline",
        sql: `SELECT ${countWhen(`${field} IS NULL`, dialect)} AS null_count FROM ${table};`,
        expected: "Preserved after the compatibility representation is introduced",
      },
    ];
  }

  if (proposal.changeType === "drop") {
    return [
      baseline,
      {
        name: "Pre-removal population baseline",
        sql: `SELECT ${countWhen(`${field} IS NOT NULL`, dialect)} AS populated_rows FROM ${table};`,
        expected: "Recorded in the deprecation evidence before physical removal",
      },
      {
        name: "Consumer sample contract",
        sql: `SELECT ${field} FROM ${table} WHERE ${field} IS NOT NULL LIMIT 25;`,
        expected: "Sample remains available until every blocking consumer migration passes",
      },
    ];
  }

  return [
    baseline,
    {
      name: proposal.targetValue === "required" ? "Required-field guard" : "Nullable-field baseline",
      sql: `SELECT ${countWhen(`${field} IS NULL`, dialect)} AS null_count FROM ${table};`,
      expected: proposal.targetValue === "required"
        ? "0 nulls before the required constraint is enforced"
        : "Capture before producers begin emitting nulls",
    },
  ];
}

function changeLabel(proposal: ChangeProposal): string {
  if (proposal.changeType === "rename") return `Rename ${proposal.field} to ${proposal.targetValue}`;
  if (proposal.changeType === "type") return `Change ${proposal.field} to ${proposal.targetValue}`;
  if (proposal.changeType === "nullable") {
    return `${proposal.targetValue === "required" ? "Require" : "Allow nulls in"} ${proposal.field}`;
  }
  return `Drop ${proposal.field}`;
}

function rollbackPlan(proposal: ChangeProposal): string {
  if (proposal.changeType === "drop") {
    return `Restore ${proposal.field} from the preserved source contract, then revert consumers in reverse lineage order.`;
  }
  if (proposal.changeType === "nullable") {
    return `Restore the prior nullability contract for ${proposal.field}, revert producer behavior, and re-run the null-count guard.`;
  }
  return `Keep ${proposal.field} authoritative, revert consumers in reverse lineage order, and remove the additive compatibility representation only after downstream health returns to baseline.`;
}

export function createPassport(proposal: ChangeProposal, context: AnalysisContext): ChangePassport {
  const sourceField = context.fields.find((field) => field.name === proposal.field);
  if (!sourceField) {
    throw new InvalidChangeProposalError(`Field ${proposal.field} is not present in the DataHub schema for ${context.source.qualifiedName}.`);
  }
  const dialect = sqlDialect(context.source);
  if (proposal.changeType === "rename" && proposal.targetValue === proposal.field) {
    throw new InvalidChangeProposalError(`Rename target ${proposal.targetValue} is the current field name.`);
  }
  if (proposal.changeType === "type") {
    const target = targetType(proposal.targetValue, dialect);
    if (target.canonical === canonicalSourceType(sourceField.type, dialect)) {
      throw new InvalidChangeProposalError(`${proposal.targetValue} is equivalent to the current ${sourceField.type} type.`);
    }
  }
  if (proposal.changeType === "nullable") {
    const targetNullable = proposal.targetValue === "nullable";
    if (sourceField.nullable === targetNullable) {
      throw new InvalidChangeProposalError(
        targetNullable
          ? `${proposal.field} is already nullable.`
          : `${proposal.field} is already non-nullable.`,
      );
    }
  }
  const impacted = context.downstream.map((asset) => ({ ...asset, severity: assetSeverity(asset, proposal) }));
  const riskScore = scoreRisk(context.source, impacted, proposal);
  const riskLevel = classify(riskScore);
  const label = changeLabel(proposal);
  const id = `CG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const owners = [...new Set(impacted.map((asset) => asset.owner))];
  const mappedCount = impacted.filter((asset) => asset.impactScope === "field").length;
  const assetLevelCount = impacted.length - mappedCount;
  const certificationTagCount = impacted.filter((asset) => asset.hasCertificationTag).length;
  const verdict = riskScore >= 80 ? "blocked" : riskScore >= 55 ? "requires-approval" : "safe-with-plan";

  return {
    id,
    createdAt: new Date().toISOString(),
    title: `${label} in ${context.source.name}`,
    proposal,
    source: context.source,
    riskScore,
    riskLevel,
    verdict,
    summary: `${label} reaches ${impacted.length} cataloged assets across ${owners.length} owner groups. ${mappedCount} include column-mapping evidence; ${assetLevelCount} are asset-level impacts without field mapping evidence. ${certificationTagCount} carry a configured certification tag signal, and ${impacted.filter((asset) => asset.kind === "mlModel" || asset.kind === "dashboard").length} are user-facing or production ML consumers.`,
    impacted,
    graph: { assets: context.graphAssets, edges: context.graphEdges },
    steps: buildSteps(context.source, impacted, proposal),
    validations: buildValidations(context.source, proposal),
    notifications: owners.map((owner) => {
      const names = impacted.filter((asset) => asset.owner === owner).map((asset) => asset.name);
      return {
        owner,
        assets: names,
        message: `${label} can affect ${names.join(", ")}. Please acknowledge the compatibility plan before retirement.`,
      };
    }),
    trace: context.trace,
    assumptions: [
      "DataHub lineage and ownership metadata are current at analysis time.",
      "The compatibility phase remains reversible until every blocking verification passes.",
      "Uncataloged consumers require runtime monitoring before the change is completed.",
    ],
    rollback: rollbackPlan(proposal),
  };
}
