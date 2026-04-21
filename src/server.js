import { createApp } from "./app.js";

const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createApp();
  const server = app.listen(DEFAULT_PORT, () => {
    console.log(`Tuya setup server listening on http://127.0.0.1:${DEFAULT_PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${DEFAULT_PORT} is already in use. Run: lsof -ti :${DEFAULT_PORT} | xargs kill -9`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
