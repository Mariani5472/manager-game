# Manager Game — Web application

The Next.js frontend lives in `apps/web`. It consumes the Express API in `apps/api`; SQLite access stays inside API repositories and existing infrastructure services.

## Stack

- Next.js App Router, React and TypeScript
- React Hook Form and Zod
- TanStack Query and Zustand
- Tailwind CSS v4 and shadcn/ui-compatible components
- Vitest and jsdom
- ESLint and Prettier

## Run locally

From the repository root:

```bash
npm install
npm install --prefix apps/web
npm run dev -- init-master
```

Start the API and frontend in separate terminals:

```bash
npm run api
npm run ui
```

Open http://localhost:3000. Next.js proxies `/api/*` to Express at `http://127.0.0.1:3001` by default. Set `API_INTERNAL_URL` when the API runs elsewhere.

The menu contains New Game, Load Game and Config. New Game reads countries and clubs from the master database and creates an independent save. Load Game lists and opens saves. Config remains a scaffold until game preferences are defined.

## Quality checks

```bash
npm run lint
npm test
npm run test:ui
npm run ui:build
```

The local-filesystem version is intended for a trusted local environment. A remote or multi-instance deployment needs authentication and shared persistence.
