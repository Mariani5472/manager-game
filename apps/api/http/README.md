# Express API

Run from the repository root:

```bash
npm install
npm run dev -- init-master
npm run api
```

The API listens on `127.0.0.1:3001` by default. Override with:

- `API_HOST`
- `API_PORT`
- `GM_MASTER_DB`
- `GM_SAVE_DIR`
- `WEB_ORIGIN` (comma-separated browser origins)

In another terminal, run the Next.js frontend:

```bash
npm run ui
```

Next.js proxies `/api/*` to the Express server. Set `API_INTERNAL_URL` when the API is not reachable at `http://127.0.0.1:3001` from the Next.js server. For direct browser-to-API requests, set `NEXT_PUBLIC_API_URL` and configure `WEB_ORIGIN` accordingly.

The API owns all SQLite access. Do not add Next.js route handlers that open the master or save databases.
