// Entry point: pick a port, open the database and serve API + UI on 127.0.0.1.
import { createApp, resolveDataDir } from "./app.js";
import { findAvailablePort, validPort } from "./port.js";
import { startPoller } from "./commitments-poller.js";

const PREFERRED_PORT = validPort(process.env.PEOPLE_PORT || process.env.PORT, 5182);
const PORT = process.env.PORT_STRICT === "1" ? PREFERRED_PORT : await findAvailablePort(PREFERRED_PORT);
const dataDir = resolveDataDir();
const { app } = createApp({ dataDir, dataDirConfigured: !!process.env.PEOPLE_DATA_DIR });

const server = app.listen(PORT, "127.0.0.1", () => {
  if (PORT !== PREFERRED_PORT) console.log(`Puerto ${PREFERRED_PORT} ocupado; usando ${PORT}.`);
  console.log(`People's Hoard en http://127.0.0.1:${PORT} · datos en ${dataDir}`);
  // Meeting minutes from Funes arrive by themselves while the hub answers (PEOPLE_COMMITMENTS_AUTO=0 turns it off).
  if (startPoller()) console.log("Compromisos: leyendo las actas de Funes desde el hub cada 60 s.");
});
server.on("error", (error) => {
  console.error(`No se pudo iniciar People's Hoard: ${error.message}`);
  process.exitCode = 1;
});
