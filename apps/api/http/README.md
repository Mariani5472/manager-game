# Express API

The API is a modular Express application with dependency injection.

```text
apps/api/
  container.ts
  http/                 # Express bootstrap, middleware and server
  shared/               # API-wide errors and HTTP helpers
  modules/
    master/
    data-packages/
    saves/
apps/shared/src/         # DTOs shared by API and frontend
```

Each module uses the following layers where applicable:

- **Routes** map HTTP methods and paths to controller handlers.
- **Controllers** validate transport input, invoke application services and write HTTP responses.
- **Services** enforce business rules without importing Express or SQLite.
- **Repository interfaces** define the persistence operations required by the module.
- **Repository adapters** own SQL, filesystem access and existing infrastructure integrations.

The composition root (`container.ts`) wires repositories, services and controllers. Tests can inject dependencies into `createApp`.

## Run locally

From the repository root:

```bash
npm install
npm install --prefix apps/web
npm run dev -- init-master
npm run api
```

In another terminal:

```bash
npm run ui
```

The API defaults to `0.0.0.0:3001` (`API_HOST`, `API_PORT`). The Next.js server proxies `/api/*` to `http://127.0.0.1:3001`; set `API_INTERNAL_URL` when the API is hosted elsewhere.

Database configuration:

- `GM_MASTER_DB`: master SQLite path.
- `GM_SAVE_DIR`: save directory.
- `GMF_SCHEMA_SQL`: schema SQL path.
- `WEB_ORIGIN`: comma-separated origins for direct cross-origin browser requests. Not needed when using the Next.js same-origin proxy.

The current Commander CLI exposes master initialization and master club listing. The previous broader command surface is retained temporarily as `npm run legacy:game -- <command>` while its use cases are migrated into the modular CLI. Do not remove `apps/api/legacy-cli.ts` until those commands have been migrated or explicitly retired.

SQLite access belongs in repository adapters or existing infrastructure services, never in controllers or frontend code.
