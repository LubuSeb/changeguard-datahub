import { createApp } from "./app.js";

const { app, gateway } = createApp();
const port = Number(process.env.PORT ?? 8787);
const server = app.listen(port, () => {
  console.log(`ChangeGuard API listening on http://localhost:${port} (${gateway.mode} mode, ${gateway.deployment} profile)`);
});

const shutdown = async () => {
  server.close();
  await gateway.close?.();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
