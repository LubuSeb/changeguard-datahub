import type { RiskLevel } from "../../shared/types";

export function RiskDial({ score, level }: { score: number; level: RiskLevel }) {
  const degrees = Math.round((score / 100) * 360);
  return (
    <div className={`risk-dial risk-dial--${level}`} style={{ "--risk-degrees": `${degrees}deg` } as React.CSSProperties}>
      <div className="risk-dial__inner">
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}
