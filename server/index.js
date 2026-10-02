// Entry point: pick a port, open the database and serve API + UI on 127.0.0.1.
import { createApp, resolveDataDir } from "./app.js";
import { findAvailablePort, validPort } from "./hoard-commons/server.js";
import { runServer } from "./hoard-commons/express.js";
import { startPoller, stopPoller } from "./commitments-poller.js";
import { startBackground, stopBackground } from "./background.js";
import { close as closeDb } from "./db.js";
import { setPublicUrl } from "./agenda.js";

const PREFERRED_PORT = validPort(process.env.PEOPLE_PORT || process.env.PORT, 5182);
const PORT = process.env.PORT_STRICT === "1" ? PREFERRED_PORT : await findAvailablePort(PREFERRED_PORT, { span: 100 });
const dataDir = resolveDataDir();

const stopAll = () => { stopPoller(); stopBackground(); closeDb(); };
try {
  const { port } = await runServer({
    service: "People's Hoard",
    port: PORT,
    createApp: () => createApp({ dataDir, dataDirConfigured: !!process.env.PEOPLE_DATA_DIR }).app,
    // SIGINT / SIGTERM: stop the background passes, then close the database (WAL checkpoint) before the process ends
    onShutdown: stopAll,
  });
  if (port !== PREFERRED_PORT) console.log(`Puerto ${PREFERRED_PORT} ocupado; usando ${port}.`);
  console.log(`People's Hoard en http://127.0.0.1:${port} · datos en ${dataDir}`);
  // Meeting minutes from Funes arrive by themselves while the hub answers (PEOPLE_COMMITMENTS_AUTO=0 turns it off).
  if (startPoller()) console.log("Compromisos: leyendo las actas de Funes desde el hub cada 60 s.");
  setPublicUrl(`http://127.0.0.1:${port}`);
  // Last contact from the hub's mail every 30 min, and the gift ideas before a birthday (PEOPLE_MAIL_AUTO=0: no mail pass).
  const background = startBackground();
  if (background.mail) console.log("Correo: leyendo del hub el último contacto de las personas con correo, cada 30 min.");
} catch (error) {
  console.error(`No se pudo iniciar People's Hoard: ${error.message}`);
  stopAll();
  process.exitCode = 1;
}
