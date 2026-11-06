# Express API architecture

The API uses a modular, dependency-injected architecture:

```text
apps/api/
  container.ts
  http/                 # Express bootstrap, middleware and server
  shared/               # API-wide errors and HTTP helpers
  modules/
    master/
      master.routes.ts
      master.controller.ts
      master.service.ts
      master.repository.ts
      sqlite-master.repository.ts
    saves/
      save.routes.ts
      save.controller.ts
      save.service.ts
      save.repository.ts
      save-manager.repository.ts
apps/shared/src/         # DTOs/contracts shared by API and web
```

## Responsibilities

- **Routes:** map HTTP methods and paths to controller handlers.
- **Controllers:** validate transport input, invoke application services, and write HTTP responses.
- **Services:** enforce business rules and coordinate use cases. They do not import Express or SQLite.
- **Repository interfaces:** define persistence operations required by a module.
- **Repository implementations:** own SQL, filesystem and existing infrastructure adapters.
- **Shared contracts:** define DTOs consumed by both API and web.
- **Container:** wires implementations to services and controllers. Tests can inject dependencies into `createApp`.

## Run locally

From the repository root:

```bash
npm install
npm run dev -- init-master
npm run api
```

In another terminal:

```bash
npm run ui
```

The API listens on `127.0.0.1:4000` by default. Configure `API_HOST`, `API_PORT`, `GM_MASTER_DB`, `GM_SAVE_DIR` and (only for direct cross-origin browser calls) `WEB_ORIGIN`.

Next.js proxies `/api/*` to Express. Set `API_INTERNAL_URL` if Express is hosted at a different address from the Next.js server.

SQLite access belongs in repository implementations or existing infrastructure services. Do not query SQLite from controllers or web route handlers.
