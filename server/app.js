// Builds the Express app. server/index.js boots it; tests call createApp()
// with a temporary data directory and listen on a free port.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { init as initDb } from "./db.js";
import { installRoutes } from "./routes.js";
import { z } from "zod";
import { TOOLS, AGENT_INSTRUCTIONS } from "./agent-tools.js";
import * as family from "./hoard-link.js";
import { createGuard, makeAgentRoutes, installSpa, installErrorHandlers } from "./hoard-commons/express.js";
import { readOrCreateToken, resolveDataDir as commonDataDir } from "./hoard-commons/server.js";
import { agendaItems } from "./agenda.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export const ROOT = path.join(__dirname, "..");

export function resolveDataDir(env = process.env) {
  return commonDataDir("PEOPLE", ROOT, env);
}

export function createApp({ dataDir, dataDirConfigured = false, serveStatic = true, allowedHosts = process.env.PEOPLE_ALLOWED_HOSTS } = {}) {
  initDb(dataDir);
  // the token is stable across restarts, so an MCP bridge started earlier keeps working
  const token = readOrCreateToken(path.join(dataDir, "mcp-token"));
  // Hoard Link 0.4: this app on the family bus (agent.call events, calls to
  // siblings through the hub, the hoard_link block in /api/health).
  family.configure({ app: "people", dataDir });

  const app = express();
  app.disable("x-powered-by");
  app.use(createGuard({ allowedHosts }));
  app.use(express.json({ limit: "10mb" }));
  installRoutes(app, { version, dataDirConfigured });
  makeAgentRoutes({ app: "people", tools: TOOLS, z, token, instructions: AGENT_INSTRUCTIONS, recordCall: family.recordCall }).install(app);
  // The family agenda (birthdays, follow-ups, commitments with a day): the hub asks with this app's own token.
  family.installAgenda(app, (from, to, sphere) => agendaItems(from, to, sphere));
  const DIST = path.join(ROOT, "dist");
  if (serveStatic) installSpa(app, DIST, { express }); // also answers a JSON 404 for unknown /api routes
  else app.all(/^\/api(\/.*)?$/, (req, res) => res.status(404).json({ error: "Not found.", code: "not_found" }));
  installErrorHandlers(app);
  return { app, token, version };
}
