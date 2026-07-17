import cors from "cors";
import express from "express";
import path from "node:path";
import { z } from "zod";
import type { ChangeProposal } from "../shared/types.js";
import { addModelSynthesis } from "./agent/orchestrator.js";
import { createPassport, InvalidChangeProposalError } from "./agent/planner.js";
import { createGateway, type DataHubGateway } from "./datahub/gateway.js";
import { createModelAdvisor, ModelAdviceError, type ModelAdvisor } from "./model/advisor.js";

const baseProposal = {
  assetUrn: z.string().min(1).max(500),
  field: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]*$/),
  rationale: z.string().min(12).max(500),
};

export const changeProposalSchema = z.discriminatedUnion("changeType", [
  z.object({ ...baseProposal, changeType: z.literal("drop"), targetValue: z.never().optional() }).strict(),
  z.object({ ...baseProposal, changeType: z.literal("rename"), targetValue: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]*$/) }).strict(),
  z.object({ ...baseProposal, changeType: z.literal("type"), targetValue: z.string().min(1).max(64) }).strict(),
  z.object({ ...baseProposal, changeType: z.literal("nullable"), targetValue: z.enum(["nullable", "required"]) }).strict(),
]);

export interface AppOptions {
  gateway?: DataHubGateway;
  advisor?: ModelAdvisor | null;
  allowedOrigins?: string[];
  allowSameOrigin?: boolean;
  clientPath?: string;
  serveClient?: boolean;
}

function configuredOrigins(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment.CHANGEGUARD_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8787", "http://127.0.0.1:8787"];
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const gateway = options.gateway ?? createGateway();
  const advisor = options.advisor === undefined ? createModelAdvisor() : options.advisor ?? undefined;
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredOrigins(process.env));
  const allowSameOrigin = options.allowSameOrigin ?? true;
  const passports = new Map<string, ReturnType<typeof createPassport>>();

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const origin = request.get("Origin");
    const sameOrigin = origin && allowSameOrigin && (() => {
      try {
        return new URL(origin).host === request.get("Host");
      } catch {
        return false;
      }
    })();
    if (origin && !allowedOrigins.has(origin) && !sameOrigin) {
      return response.status(403).json({ error: "Origin is not allowed." });
    }
    next();
  });
  app.use(cors({
    origin: [...allowedOrigins],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  }));
  app.use(express.json({ limit: "256kb", strict: true }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      const capabilities = await gateway.capabilities();
      response.json({
        ok: true,
        mode: gateway.mode,
        deployment: gateway.deployment,
        integration: gateway.mode === "live" ? "DataHub MCP Server" : "Simulated DataHub fixture",
        agentMode: advisor ? "model-backed" : "deterministic-preview",
        agentModel: advisor?.model,
        mutationEnabled: capabilities.mutationEnabled,
        tools: capabilities.tools,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/catalog", async (_request, response, next) => {
    try {
      response.json(await gateway.snapshot());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/analyze", async (request, response, next) => {
    try {
      const proposal = changeProposalSchema.parse(request.body) as ChangeProposal;
      const context = await gateway.context(proposal.assetUrn, proposal.field);
      const policyPassport = createPassport(proposal, context);
      const passport = advisor ? await addModelSynthesis(policyPassport, advisor) : policyPassport;
      passports.set(passport.id, passport);
      response.json(passport);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/passports/:id/publish", async (request, response, next) => {
    try {
      if (!gateway.mutationEnabled) {
        return response.status(403).json({ error: "Write-back is disabled for this deployment." });
      }
      const passport = passports.get(request.params.id);
      if (!passport) return response.status(404).json({ error: "Passport not found. Run the analysis again." });
      response.json(await gateway.publish(passport));
    } catch (error) {
      next(error);
    }
  });

  if (options.serveClient !== false) {
    const clientPath = options.clientPath ?? path.resolve(process.cwd(), "dist-client");
    app.use(express.static(clientPath));
    app.get("/*splat", (_request, response) => response.sendFile(path.join(clientPath, "index.html")));
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join(" ")
      : error instanceof Error ? error.message : "Unexpected server error.";
    const status = error instanceof z.ZodError || error instanceof InvalidChangeProposalError
      ? 400
      : error instanceof ModelAdviceError ? 503 : 500;
    response.status(status).json({ error: message });
  });

  return { app, gateway };
}
