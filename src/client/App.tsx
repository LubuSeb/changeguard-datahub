import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Braces,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Cloud,
  Code2,
  Database,
  FileCheck2,
  GitBranch,
  Loader2,
  LockKeyhole,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import { LineageGraph } from "./components/LineageGraph";
import { RiskDial } from "./components/RiskDial";
import type {
  CatalogAsset,
  CatalogSnapshot,
  ChangePassport,
  ChangeProposalDraft,
  ChangeType,
  HealthResponse,
  PublishReceipt,
} from "../shared/types";

const defaultAsset = "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)";

const initialProposal: ChangeProposalDraft = {
  assetUrn: defaultAsset,
  field: "country_code",
  changeType: "rename",
  targetValue: "market_code",
  rationale: "Standardize the customer market identifier before regional expansion.",
};

const changeLabels: Record<ChangeType, string> = {
  drop: "Drop field",
  rename: "Rename field",
  type: "Change type",
  nullable: "Change nullability",
};

function titleCase(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusPill({ health }: { health: HealthResponse | null }) {
  return (
    <div className={`status-pill ${health?.ok ? "status-pill--online" : ""}`}>
      <span />
      {health ? `${health.mode === "demo" ? "Demo graph" : "Live DataHub"} connected` : "Connecting"}
    </div>
  );
}

function SourceRail({ catalog, selected, onSelect }: {
  catalog: CatalogSnapshot | null;
  selected: string;
  onSelect: (urn: string) => void;
}) {
  return (
    <aside className="source-rail">
      <div className="brand-lockup">
        <span className="brand-mark"><ShieldCheck size={20} /></span>
        <span><strong>ChangeGuard</strong><small>powered by DataHub</small></span>
      </div>
      <div className="rail-heading"><span>Catalog assets</span><small>{catalog?.assets.length ?? 0}</small></div>
      <nav className="asset-nav" aria-label="Catalog assets">
        {catalog?.assets.map((asset) => (
          <button
            key={asset.urn}
            className={selected === asset.urn ? "active" : ""}
            onClick={() => onSelect(asset.urn)}
          >
            <span className="asset-platform">{asset.platform.slice(0, 2).toUpperCase()}</span>
            <span><strong>{asset.name}</strong><small>{asset.domain} / {asset.owner}</small></span>
            {asset.hasCertificationTag && <BadgeCheck size={15} aria-label="Configured certification tag present" />}
          </button>
        ))}
      </nav>
      <div className="rail-footer">
        <Network size={16} />
        <span><strong>Context, not guesses</strong><small>Lineage / ownership / governance</small></span>
      </div>
    </aside>
  );
}

function ProposalPanel({ asset, proposal, onChange, onRun, loading }: {
  asset?: CatalogAsset;
  proposal: ChangeProposalDraft;
  onChange: (proposal: ChangeProposalDraft) => void;
  onRun: () => void;
  loading: boolean;
}) {
  const needsTextTarget = proposal.changeType === "rename" || proposal.changeType === "type";
  const changeTypeSelected = (changeType: ChangeType) => {
    const targetValue = changeType === "rename"
      ? "renamed_field"
      : changeType === "type"
        ? asset?.platform.toLowerCase().includes("bigquery") ? "STRING" : "VARCHAR(64)"
        : changeType === "nullable" ? "nullable" : undefined;
    onChange({ ...proposal, changeType, targetValue });
  };
  return (
    <section className="proposal-panel">
      <div className="section-kicker"><Sparkles size={15} /><span>Proposed contract change</span></div>
      <div className="asset-title-row">
        <div>
          <p>{asset?.platform ?? "Catalog"} / {asset?.domain ?? "Loading"}</p>
          <h1>{asset?.qualifiedName ?? "Loading DataHub context"}</h1>
        </div>
        <div className="tag-row">
          {asset?.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
      <div className="proposal-form">
        <label>
          <span>Schema field</span>
          <div className="select-wrap">
            <select value={proposal.field} onChange={(event) => onChange({ ...proposal, field: event.target.value })}>
              {asset?.fields.map((field) => <option value={field.name} key={field.name}>{field.name} / {field.type}</option>)}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <label>
          <span>Change</span>
          <div className="select-wrap">
            <select value={proposal.changeType} onChange={(event) => changeTypeSelected(event.target.value as ChangeType)}>
              {Object.entries(changeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        {needsTextTarget && (
          <label>
            <span>{proposal.changeType === "rename" ? "New field name" : "Target data type"}</span>
            <input value={proposal.targetValue ?? ""} onChange={(event) => onChange({ ...proposal, targetValue: event.target.value })} />
          </label>
        )}
        {proposal.changeType === "nullable" && (
          <label>
            <span>Target contract</span>
            <div className="select-wrap">
              <select value={proposal.targetValue ?? "nullable"} onChange={(event) => onChange({ ...proposal, targetValue: event.target.value })}>
                <option value="nullable">Allow nulls</option>
                <option value="required">Require values</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
        )}
        <label className="rationale-field">
          <span>Why this change?</span>
          <input value={proposal.rationale} onChange={(event) => onChange({ ...proposal, rationale: event.target.value })} />
        </label>
        <button className="run-button" onClick={onRun} disabled={loading || !asset}>
          {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
          {loading ? "Tracing impact" : "Build change passport"}
        </button>
      </div>
    </section>
  );
}

function EmptyAnalysis({ onRun }: { onRun: () => void }) {
  return (
    <section className="empty-analysis">
      <div className="empty-analysis__visual">
        <Database size={21} />
        <span />
        <GitBranch size={21} />
        <span />
        <Activity size={21} />
      </div>
      <h2>Trace the change before it ships</h2>
      <p>ChangeGuard will interrogate DataHub for schema, ownership, downstream lineage, and governance context, then produce a reversible rollout plan.</p>
      <button onClick={onRun}><Play size={17} /> Run the seeded scenario</button>
    </section>
  );
}

function PassportHeader({ passport }: { passport: ChangePassport }) {
  return (
    <section className="passport-header">
      <div className="passport-summary">
        <div className="section-kicker"><ClipboardCheck size={15} /><span>Change passport / {passport.id}</span></div>
        <h2>{passport.title}</h2>
        <p>{passport.summary}</p>
        <div className="metric-strip">
          <div><strong>{passport.impacted.length}</strong><span>impacted assets</span></div>
          <div><strong>{new Set(passport.impacted.map((item) => item.owner)).size}</strong><span>owner groups</span></div>
          <div><strong>{passport.impacted.filter((item) => item.hasCertificationTag).length}</strong><span>certification tags</span></div>
          <div><strong>{Math.max(0, ...passport.impacted.map((item) => item.hops))}</strong><span>lineage hops</span></div>
        </div>
      </div>
      <div className="risk-panel">
        <RiskDial score={passport.riskScore} level={passport.riskLevel} />
        <div><small>Change risk</small><strong>{titleCase(passport.riskLevel)}</strong><span>{titleCase(passport.verdict)}</span></div>
      </div>
    </section>
  );
}

function ImpactTable({ passport }: { passport: ChangePassport }) {
  return (
    <section className="content-section impact-section">
      <div className="section-heading">
        <div><span>01</span><div><h3>Blast radius</h3><p>Field mappings and asset-level downstream evidence</p></div></div>
        <Network size={19} />
      </div>
      <LineageGraph passport={passport} />
      <div className="impact-table" role="table" aria-label="Impacted assets">
        {passport.impacted.map((asset) => (
          <div role="row" key={asset.urn}>
            <span className={`severity-dot severity-dot--${asset.severity}`} />
            <span><strong>{asset.name}</strong><small>{asset.platform} / {asset.qualifiedName}</small></span>
            <span><strong>{asset.owner}</strong><small>{asset.domain}</small></span>
            <span>
              <strong>{asset.impactScope === "field" ? asset.impactedFields.join(", ") : "Field mapping unknown"}</strong>
              <small>{asset.impactScope === "field" ? "Column mapping" : "Asset-level impact"} / {asset.hops} hop{asset.hops === 1 ? "" : "s"}</small>
            </span>
            <span>{titleCase(asset.severity)} risk</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RolloutPlan({ passport }: { passport: ChangePassport }) {
  return (
    <section className="content-section plan-section">
      <div className="section-heading">
        <div><span>02</span><div><h3>Safe rollout</h3><p>Ordered by dependency and reversibility</p></div></div>
        <GitBranch size={19} />
      </div>
      <div className="plan-grid">
        {passport.steps.map((step, index) => (
          <article key={step.phase}>
            <div className="plan-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="plan-copy">
              <div><span>{step.phase}</span>{step.blocking && <small><LockKeyhole size={11} /> gate</small>}</div>
              <h4>{step.title}</h4>
              <p>{step.detail}</p>
              <footer><Users size={13} /> {step.owner}<span>{step.evidence}</span></footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ValidationPanel({ passport }: { passport: ChangePassport }) {
  const [active, setActive] = useState(0);
  return (
    <section className="content-section validation-section">
      <div className="section-heading">
        <div><span>03</span><div><h3>Validation pack</h3><p>Merge-ready checks, grounded in the selected schema</p></div></div>
        <Code2 size={19} />
      </div>
      <div className="validation-layout">
        <div className="validation-tabs" role="tablist">
          {passport.validations.map((check, index) => (
            <button key={check.name} onClick={() => setActive(index)} className={active === index ? "active" : ""} role="tab">
              <FileCheck2 size={16} />
              <span><strong>{check.name}</strong><small>{check.expected}</small></span>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
        <div className="code-panel">
          <div><span /><span /><span /><small>validation.sql</small></div>
          <pre><code>{passport.validations[active].sql}</code></pre>
          <footer><Check size={14} /> Expected: {passport.validations[active].expected}</footer>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({ passport }: { passport: ChangePassport }) {
  return (
    <section className="content-section evidence-section">
      <div className="section-heading">
        <div><span>04</span><div><h3>Context evidence</h3><p>Live MCP calls or clearly labeled simulated fixture operations</p></div></div>
        <TerminalSquare size={19} />
      </div>
      <div className="trace-grid">
        {passport.trace.map((trace, index) => (
          <div key={trace.tool}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{trace.tool}</strong><small>{trace.source}</small><p>{trace.summary}</p></div>
            <Check size={16} />
          </div>
        ))}
        <div>
          <span>{String(passport.trace.length + 1).padStart(2, "0")}</span>
          <div><strong>policy_synthesis</strong><small>ChangeGuard engine</small><p>Combined catalog evidence into a deterministic, inspectable rollout decision.</p></div>
          <Check size={16} />
        </div>
      </div>
    </section>
  );
}

function PublishBar({ passport, receipt, onPublish, publishing, canPublish, mode }: {
  passport: ChangePassport;
  receipt: PublishReceipt | null;
  onPublish: () => void;
  publishing: boolean;
  canPublish: boolean;
  mode: "demo" | "live";
}) {
  const isDemo = mode === "demo";
  return (
    <section className={`publish-bar ${receipt ? "publish-bar--done" : ""}`}>
      <div className="publish-icon">{receipt ? <BookOpenCheck size={21} /> : <Save size={21} />}</div>
      <div>
        <strong>{receipt ? isDemo ? "Simulated decision record saved" : "Decision record saved" : canPublish ? isDemo ? "Save a simulated decision record" : "Return the decision to DataHub" : "DataHub write-back disabled"}</strong>
        <span>{receipt ? `${receipt.tool} / ${receipt.receiptId}` : canPublish ? isDemo ? "Stores an in-memory demo receipt; no DataHub system is changed." : "Publish the plan so people and future agents inherit the context." : "Enable write-back only in an authorized private deployment."}</span>
      </div>
      <button onClick={onPublish} disabled={publishing || Boolean(receipt) || !canPublish}>
        {publishing ? <Loader2 className="spin" size={17} /> : receipt ? <Check size={17} /> : <Cloud size={17} />}
        {publishing ? "Saving" : receipt ? "Saved" : canPublish ? isDemo ? "Save demo record" : "Save to DataHub" : "Read only"}
      </button>
    </section>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [proposal, setProposal] = useState(initialProposal);
  const [passport, setPassport] = useState<ChangePassport | null>(null);
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => catalog?.assets.find((asset) => asset.urn === proposal.assetUrn),
    [catalog, proposal.assetUrn],
  );

  useEffect(() => {
    Promise.all([api.health(), api.catalog()])
      .then(([nextHealth, nextCatalog]) => {
        setHealth(nextHealth);
        setCatalog(nextCatalog);
        if (!nextCatalog.assets.some((asset) => asset.urn === proposal.assetUrn) && nextCatalog.assets[0]) {
          setProposal((current) => ({ ...current, assetUrn: nextCatalog.assets[0].urn, field: nextCatalog.assets[0].fields[0]?.name ?? "" }));
        }
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const selectAsset = (assetUrn: string) => {
    const asset = catalog?.assets.find((candidate) => candidate.urn === assetUrn);
    setProposal({ ...proposal, assetUrn, field: asset?.fields[0]?.name ?? "" });
    setPassport(null);
    setReceipt(null);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setReceipt(null);
    try {
      setPassport(await api.analyze(proposal));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!passport) return;
    setPublishing(true);
    setError(null);
    try {
      setReceipt(await api.publish(passport.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="app-shell">
      <SourceRail catalog={catalog} selected={proposal.assetUrn} onSelect={selectAsset} />
      <main>
        <header className="topbar">
          <div><CircleDot size={15} /><span>Schema change control room</span></div>
          <StatusPill health={health} />
        </header>
        <ProposalPanel asset={selectedAsset} proposal={proposal} onChange={setProposal} onRun={run} loading={loading} />
        {error && <div className="error-banner"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}
        {!passport && !loading && <EmptyAnalysis onRun={run} />}
        {loading && (
          <section className="analysis-loading">
            <RefreshCw className="spin" size={28} />
            <div><strong>Walking the context graph</strong><span>Schema -&gt; lineage -&gt; owners -&gt; governance -&gt; rollout</span></div>
          </section>
        )}
        {passport && (
          <div className="passport">
            <PassportHeader passport={passport} />
            <ImpactTable passport={passport} />
            <RolloutPlan passport={passport} />
            <ValidationPanel passport={passport} />
            <EvidencePanel passport={passport} />
            <PublishBar passport={passport} receipt={receipt} onPublish={publish} publishing={publishing} canPublish={health?.mutationEnabled ?? false} mode={health?.mode ?? "demo"} />
          </div>
        )}
        <footer className="app-footer">
          <span><Braces size={14} /> Apache-2.0</span>
          <span>{health?.mode === "live" ? "Connected to DataHub MCP" : "Simulated DataHub fixture mode"}</span>
          <span><RotateCcw size={14} /> Reversible by design</span>
        </footer>
      </main>
    </div>
  );
}
