// Shared test helpers: temp data dir and an in-process server on a free port.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { close } from "../server/db.js";

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "peoples-hoard-test-"));
}

export async function bootServer(options = {}) {
  const dataDir = tempDir();
  const { app, token } = createApp({ dataDir, dataDirConfigured: true, serveStatic: false, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const agent = (name, args) => call("POST", "/api/agent/call", { name, arguments: args }, { Authorization: `Bearer ${token}` });
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { base, dataDir, token, call, agent, stop };
}

// Fictional fixtures only.
export const FIXTURE_PEOPLE = [
  { name: "José Ramírez", nickname: "Pepe", circles: ["amigos"], birthday: "1990-03-14", location: "Sevilla" },
  { name: "María Fernández", nickname: "", circles: ["trabajo"], birthday: "--11-02", location: "Madrid" },
  { name: "Ana García", nickname: "Anita", circles: ["familia", "amigos"], birthday: "1985-12-30", location: "Bilbao" },
];
