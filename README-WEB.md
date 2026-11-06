# Manager Game — Web menu

The Next.js frontend lives in `apps/web`. The existing TypeScript/SQLite engine remains at the repository root and is called only by Next.js Node.js route handlers.

## Stack

- Next.js App Router, React and TypeScript
- React Hook Form and Zod
- TanStack Query and Zustand
- Tailwind CSS v4 and shadcn/ui-compatible components
- Vitest and MSW
- ESLint and Prettier

## Run locally

Initialize the factory database from the repository root:

```bash
npm install
npm run dev -- init-master
```

Then install and run the web application:

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000.

The menu contains only **New Game**, **Load Game**, and **Config**. New Game reads clubs from the master SQLite database and creates an independent save using the existing `SaveManager`. Load Game lists and validates campaign files. Config is a scaffold until game preferences are defined.

The API uses the Node.js runtime because `better-sqlite3` is a native Node dependency. Keep this local-filesystem and unauthenticated version bound to localhost; serverless or multi-instance deployment needs shared persistence and an authentication layer.
