import { describe, expect, it } from "vitest";
import type { ChangePassport } from "../../shared/types.js";
import { DemoDataHubGateway } from "../datahub/gateway.js";
import type { ModelAdviceResult, ModelAdvisor } from "../model/advisor.js";
import { ModelAdviceError } from "../model/advisor.js";
import { addModelSynthesis } from "./orchestrator.js";
import { createPassport } from "./planner.js";

async function policyPassport(): Promise<ChangePassport> {
  const gateway = new DemoDataHubGateway();
  const proposal = {
    assetUrn: "urn:li:dataset:(urn:li:dataPlatform:postgres,commerce.public.customers,PROD)",
    field: "country_code",
    changeType: "rename" as const,
    targetValue: "market_code",
    rationale: "Standardize the governed market identifier before regional expansion.",
  };
  return createPassport(proposal, await gateway.context(proposal.assetUrn, proposal.field));
}

function result(passport: ChangePassport, recommendation: ModelAdviceResult["advice"]["recommendation"] = "escalate"): ModelAdviceResult {
  const sourceUrn = passport.source.urn;
  const firstImpacted = passport.impacted[0];
  return {
    provider: "test-provider",
    model: "test-model",
    generatedAt: "2026-07-17T00:00:00.000Z",
    inputSha256: "a".repeat(64),
    promptVersion: "test-v1",
    advice: {
      recommendation,
      rationale: "The governed downstream graph requires explicit acknowledgement before retirement.",
      riskFactors: [{ assetUrns: [firstImpacted.urn], explanation: "This consumer maps the renamed field and must migrate during the overlap window." }],
      phaseGuidance: [{ phase: "dual-run", guidance: "Keep both names available until mapped consumers pass parity checks.", evidenceAssetUrns: [sourceUrn, firstImpacted.urn] }],
      ownerBriefs: [{ owner: firstImpacted.owner, assetUrns: [firstImpacted.urn], message: "Acknowledge the compatibility window and complete the mapped-field migration." }],
      openQuestions: ["Are any uncataloged consumers still reading the legacy field name?"],
    },
  };
}

function advisor(next: ModelAdviceResult): ModelAdvisor {
  return { provider: next.provider, model: next.model, advise: async () => next };
}

describe("model-backed orchestration", () => {
  it("attaches grounded advice and provenance", async () => {
    const passport = await policyPassport();
    const completed = await addModelSynthesis(passport, advisor(result(passport)));
    expect(completed.agentSynthesis).toMatchObject({ recommendation: "escalate", policyVerdict: passport.verdict });
    expect(completed.trace.map((item) => item.tool)).toEqual(expect.arrayContaining(["model_synthesis", "policy_guard"]));
  });

  it("allows the model to tighten a policy verdict", async () => {
    const passport = await policyPassport();
    passport.verdict = "safe-with-plan";
    expect((await addModelSynthesis(passport, advisor(result(passport, "block")))).verdict).toBe("blocked");
  });

  it("never lets the model weaken a policy verdict", async () => {
    const passport = await policyPassport();
    passport.verdict = "blocked";
    expect((await addModelSynthesis(passport, advisor(result(passport, "proceed")))).verdict).toBe("blocked");
  });

  it("rejects an invented asset URN", async () => {
    const passport = await policyPassport();
    const next = result(passport);
    next.advice.riskFactors[0].assetUrns = ["urn:li:dataset:invented"];
    await expect(addModelSynthesis(passport, advisor(next))).rejects.toThrow(/unknown asset/i);
  });

  it("rejects an asset assigned to the wrong owner", async () => {
    const passport = await policyPassport();
    const next = result(passport);
    next.advice.ownerBriefs[0].owner = "Invented Owner";
    await expect(addModelSynthesis(passport, advisor(next))).rejects.toThrow(/wrong or unknown owner/i);
  });

  it("propagates provider failure without a deterministic fallback", async () => {
    const passport = await policyPassport();
    const failed: ModelAdvisor = {
      provider: "test-provider",
      model: "test-model",
      advise: async () => { throw new ModelAdviceError("model unavailable"); },
    };
    await expect(addModelSynthesis(passport, failed)).rejects.toThrow("model unavailable");
  });
});
