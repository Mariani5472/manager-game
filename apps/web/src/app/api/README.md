# API migration

All game data is served by the Express API in `apps/api/http`.
The Next.js route handlers that accessed SQLite directly have been removed.
Configure `NEXT_PUBLIC_API_URL` in the web app to point to the API origin.
