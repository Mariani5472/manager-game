import app from "./app.js";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";

app.listen(port, host, () => {
  console.log(`Manager Game API listening on http://${host}:${port}`);
});
