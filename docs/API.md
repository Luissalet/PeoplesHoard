# Native API and shared assistant

The native API and MCP tool catalog are documented in `README.md`. The stdio bridge exposes 29 tools and proxies requests to the running app.

The shared assistant uses `/api/copilot/info`, `/api/copilot/panel.js`, `/api/copilot/launcher.js` and `/api/copilot/proxy`. Identity and credentials remain on the server; conversations, drafts and model requests live in Faustus, using the global LLM configured on Sparks.

Context contains real people, commitments and gifts from the native API together with complete unsaved form fields. Creation and missing objects do not invent references. Turn completion refreshes the current page without resetting typed drafts. Partial person edits preserve other fields changed by an agent. Summary and notes autosaves only acknowledge the text actually sent after a successful save; later edits and drafts after a failed response remain available.
