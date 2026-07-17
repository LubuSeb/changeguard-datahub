import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { BarChart3, Bot, Database, GitBranch, Workflow } from "lucide-react";
import type { CatalogAsset, ChangePassport } from "../../shared/types";

type AssetNodeData = { asset: CatalogAsset };

const kindIcon = {
  dataset: Database,
  transform: GitBranch,
  dashboard: BarChart3,
  mlFeature: Workflow,
  mlModel: Bot,
};

function AssetNode({ data }: NodeProps<Node<AssetNodeData>>) {
  const { asset } = data;
  const Icon = kindIcon[asset.kind];
  return (
    <div className={`graph-node graph-node--${asset.kind}`}>
      <Handle type="target" position={Position.Left} />
      <span className="graph-node__icon"><Icon size={15} /></span>
      <span className="graph-node__copy">
        <strong>{asset.name}</strong>
        <small>{asset.platform} / {asset.owner}</small>
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { asset: AssetNode };

export function LineageGraph({ passport }: { passport: ChangePassport }) {
  const { nodes, edges } = useMemo(() => {
    const levels = new Map<string, number>([[passport.source.urn, 0]]);
    for (const asset of passport.impacted) levels.set(asset.urn, asset.hops);
    const rows = new Map<number, number>();
    const nodes: Node<AssetNodeData>[] = passport.graph.assets.map((asset) => {
      const level = levels.get(asset.urn) ?? 0;
      const row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      return {
        id: asset.urn,
        type: "asset",
        position: { x: level * 292 + 24, y: row * 104 + 28 },
        data: { asset },
      };
    });
    const edges: Edge[] = passport.graph.edges.map((edge, index) => ({
      id: `${index}-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      animated: edge.relation !== "impact",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#4d6d60" },
      style: { stroke: "#4d6d60", strokeWidth: 1.5, strokeDasharray: edge.relation === "impact" ? "5 5" : undefined },
    }));
    return { nodes, edges };
  }, [passport]);

  return (
    <div className="lineage-canvas" aria-label="Downstream DataHub lineage impact map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.55}
        maxZoom={1.35}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="#d6d2c8" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
