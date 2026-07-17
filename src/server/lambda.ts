import path from "node:path";
import serverless from "serverless-http";
import { createApp } from "./app.js";
import { DemoDataHubGateway } from "./datahub/gateway.js";

function lambdaOrigins(): string[] {
  return process.env.CHANGEGUARD_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
}

function lambdaClientPath(): string {
  return process.env.LAMBDA_TASK_ROOT
    ? path.join(process.env.LAMBDA_TASK_ROOT, "public")
    : path.resolve(process.cwd(), "src/server/public");
}

export function createLambdaApp() {
  return createApp({
    gateway: new DemoDataHubGateway(),
    advisor: null,
    allowedOrigins: lambdaOrigins(),
    allowSameOrigin: true,
    clientPath: lambdaClientPath(),
  }).app;
}

export const handler = serverless(createLambdaApp(), { provider: "aws" });
