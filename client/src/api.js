// Thin fetch wrapper. Every error surfaces as an Error with the server message.
async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `Error ${response.status}`);
  return data;
}

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return clean.length ? `?${new URLSearchParams(clean)}` : "";
};

export const api = {
  state: () => request("GET", "/api/state"),
  people: {
    list: (filter) => request("GET", `/api/people${qs(filter)}`),
    get: (id) => request("GET", `/api/people/${id}`),
    create: (data) => request("POST", "/api/people", data),
    update: (id, data) => request("PATCH", `/api/people/${id}`, data),
    remove: (id) => request("DELETE", `/api/people/${id}`),
    merge: (keep_id, drop_id) => request("POST", "/api/people/merge", { keep_id, drop_id }),
  },
  aliases: {
    add: (personId, data) => request("POST", `/api/people/${personId}/aliases`, data),
    update: (id, data) => request("PATCH", `/api/aliases/${id}`, data),
    remove: (id) => request("DELETE", `/api/aliases/${id}`),
  },
  facts: {
    add: (personId, data) => request("POST", `/api/people/${personId}/facts`, data),
    update: (id, data) => request("PATCH", `/api/facts/${id}`, data),
    remove: (id) => request("DELETE", `/api/facts/${id}`),
  },
  interactions: {
    add: (personId, data) => request("POST", `/api/people/${personId}/interactions`, data),
    update: (id, data) => request("PATCH", `/api/interactions/${id}`, data),
    remove: (id) => request("DELETE", `/api/interactions/${id}`),
  },
  reminders: {
    add: (personId, data) => request("POST", `/api/people/${personId}/reminders`, data),
    addGeneral: (data) => request("POST", "/api/reminders", data),
    update: (id, data) => request("PATCH", `/api/reminders/${id}`, data),
    remove: (id) => request("DELETE", `/api/reminders/${id}`),
  },
  resolve: (name) => request("GET", `/api/resolve${qs({ name })}`),
  upcoming: (days) => request("GET", `/api/upcoming${qs({ days })}`),
  circles: () => request("GET", "/api/circles"),
  importBackup: (data) => request("POST", "/api/import", data),
};
