import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const logDir = process.env.TETRAD_LOG_DIR ?? "./games";

startServer({ port, logDir });
console.log(`tetrad server listening on ws://0.0.0.0:${port} (logs: ${logDir})`);
