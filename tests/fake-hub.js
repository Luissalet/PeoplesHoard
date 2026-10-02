// A stand-in for the Hoard Link hub: just the endpoints People talks to. Tests drive it through `state`.
import http from "node:http";

export async function startFakeHub() {
  const state = {
    emitted: [],            // events People posted
    authHeaders: [],        // Authorization headers seen
    feed: [],               // events served on GET /api/events: { id, type, source, data }
    lastId: 0,
    calls: [],              // proxy calls People made: { app, tool, arguments }
    minutes: {},            // session_id -> scribe_minutes result (or { __error: { status, error } })
    chat: { status: 200, body: { ok: true, text: "{}", json: { commitments: [] }, model: "fake-model" } },
    chats: [],              // chat bodies People sent
    eventQueries: [],       // GET /api/events urls
    tools: {},              // "app.tool" -> (arguments) => result, or { __error: { status, error } }
    mailStatus: { ready: true, interval_min: 10, fresh_s: 5 },
    mail: [],               // messages the gateway holds: { id, message_id, subject, from_addr, from_name, date_ts, ... }
    mailRequests: [],       // GET /api/mail/messages urls
    interests: [],          // specs People registered
    refs: [],               // links People posted to /api/refs
    claims: [],             // mail claims People posted (it must make none)
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      state.authHeaders.push(req.headers.authorization || "");
      const url = new URL(req.url, "http://hub");
      const body = raw ? JSON.parse(raw) : {};
      const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.method === "POST" && url.pathname === "/api/events") { state.emitted.push(body); return send(200, { ok: true }); }
      if (req.method === "GET" && url.pathname === "/api/events") {
        state.eventQueries.push(req.url);
        const since = Number(url.searchParams.get("since_id") || 0);
        const type = url.searchParams.get("type");
        const events = state.feed.filter((e) => e.id > since && (!type || e.type === type));
        return send(200, { ok: true, last_id: state.lastId, events });
      }
      if (req.method === "POST" && url.pathname === "/api/refs") { state.refs.push(body); return send(200, { ok: true }); }
      if (req.method === "POST" && url.pathname === "/api/mail/claim") { state.claims.push(body); return send(200, { ok: true }); }
      if (req.method === "GET" && url.pathname === "/api/mail/status") return send(200, { ok: true, ...state.mailStatus });
      if (req.method === "POST" && url.pathname === "/api/mail/interests") { state.interests.push(body.spec); return send(200, { ok: true }); }
      if (req.method === "GET" && url.pathname === "/api/mail/messages") {
        state.mailRequests.push(req.url);
        const since = Number(url.searchParams.get("since_id") || 0);
        const limit = Number(url.searchParams.get("limit") || 100);
        const wanted = state.interests.at(-1)?.from_addresses;
        const rows = state.mail.filter((m) => m.id > since && (!wanted || wanted.includes(String(m.from_addr).toLowerCase()))).sort((a, b) => a.id - b.id).slice(0, limit);
        return send(200, { ok: true, messages: rows, last_id: rows.length ? rows.at(-1).id : since });
      }
      const proxy = url.pathname.match(/^\/api\/apps\/([^/]+)\/call$/);
      if (req.method === "POST" && proxy && state.tools[`${proxy[1]}.${body.tool}`]) {
        state.calls.push({ app: proxy[1], tool: body.tool, arguments: body.arguments });
        const result = state.tools[`${proxy[1]}.${body.tool}`](body.arguments);
        if (result && result.__error) return send(200, { ok: false, app: proxy[1], tool: body.tool, status: result.__error.status, error: result.__error.error });
        return send(200, { ok: true, app: proxy[1], tool: body.tool, status: 200, result });
      }
      if (req.method === "POST" && proxy) {
        state.calls.push({ app: proxy[1], tool: body.tool, arguments: body.arguments });
        const result = state.minutes[body.arguments?.session_id];
        if (!result) return send(404, { ok: false, app: proxy[1], tool: body.tool, status: 404, error: "unknown session" });
        if (result.__error) return send(200, { ok: false, app: proxy[1], tool: body.tool, status: result.__error.status, error: result.__error.error });
        return send(200, { ok: true, app: proxy[1], tool: body.tool, status: 200, result });
      }
      if (req.method === "POST" && url.pathname === "/api/link/chat") {
        state.chats.push(body);
        return send(state.chat.status, state.chat.body);
      }
      return send(404, { error: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => server.close(resolve));
  return { url, state, stop, event: (type, data) => { state.lastId += 1; state.feed.push({ id: state.lastId, type, source: "funes", data }); return state.lastId; } };
}
