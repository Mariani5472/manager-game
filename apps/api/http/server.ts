import app from "./app.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Manager Game API listening on http://${host}:${port}`);
});
