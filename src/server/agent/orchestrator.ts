import type { AgentRecommendation, ChangePassport } from "../../shared/types.js";
import type { ModelAdvice, ModelAdvisor } from "../model/advisor.js";
import { ModelAdviceError } from "../model/advisor.js";

const verdictRank = { "safe-with-plan": 0, "requires-approval": 1, blocked: 2 } as const;
const recommendationVerdict: Record<AgentRecommendation, ChangePassport["verdict"]> = {
  proceed: "safe-with-plan",
  escalate: "requires-approval",
  block: "blocked",
};

function validateGrounding(passport: ChangePassport, advice: ModelAdvice) {
  const assets = new Map([
    [passport.source.urn, passport.source],
    ...passport.impacted.map((asset) => [asset.urn, asset] as const),
  ]);
  const assertUrns = (urns: string[], label: string) => {
    const unknown = urns.find((urn) => !assets.has(urn));
    if (unknown) throw new ModelAdviceError(`Model advice referenced an unknown asset in ${label}.`);
  };
  for (const factor of advice.riskFactors) assertUrns(factor.assetUrns, "risk factors");
  const phases = new Set<string>();
  for (const guidance of advice.phaseGuidance) {
    if (phases.has(guidance.phase)) throw new ModelAdviceError("Model advice repeated rollout phase guidance.");
    phases.add(guidance.phase);
    assertUrns(guidance.evidenceAssetUrns, "phase guidance");
  }
  const ownerAssetMap = new Map<string, Set<string>>();
  for (const asset of assets.values()) {
    const urns = ownerAssetMap.get(asset.owner) ?? new Set<string>();
    urns.add(asset.urn);
    ownerAssetMap.set(asset.owner, urns);
  }
  const briefOwners = new Set<string>();
  for (const brief of advice.ownerBriefs) {
    if (briefOwners.has(brief.owner)) throw new ModelAdviceError("Model advice repeated an owner brief.");
    briefOwners.add(brief.owner);
    const owned = ownerAssetMap.get(brief.owner);
    if (!owned || brief.assetUrns.some((urn) => !owned.has(urn))) {
      throw new ModelAdviceError("Model advice assigned an asset to the wrong or unknown owner.");
    }
  }
}

export async function addModelSynthesis(passport: ChangePassport, advisor: ModelAdvisor): Promise<ChangePassport> {
  const result = await advisor.advise(passport);
  validateGrounding(passport, result.advice);
  const modelVerdict = recommendationVerdict[result.advice.recommendation];
  const finalVerdict = verdictRank[modelVerdict] > verdictRank[passport.verdict] ? modelVerdict : passport.verdict;
  return {
    ...passport,
    verdict: finalVerdict,
    agentSynthesis: {
      ...result.advice,
      policyVerdict: passport.verdict,
      provenance: {
        provider: result.provider,
        model: result.model,
        generatedAt: result.generatedAt,
        inputSha256: result.inputSha256,
        promptVersion: result.promptVersion,
      },
    },
    trace: [
      ...passport.trace,
      {
        tool: "model_synthesis",
        status: "success",
        summary: `Grounded ${result.advice.recommendation} recommendation against ${passport.impacted.length + 1} catalog assets; deterministic policy gates remained authoritative.`,
        source: "Local model",
      },
      {
        tool: "policy_guard",
        status: "success",
        summary: `Validated every referenced asset and owner, then applied the stricter of policy ${passport.verdict} and model ${modelVerdict}.`,
        source: "ChangeGuard policy engine",
      },
    ],
  };
}
