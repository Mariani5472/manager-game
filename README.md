# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Validate a clean checkout

```bash
npm install
npm test
npm run build
```

## Start a new world and career

```bash
npm run dev -- init-master
npm run dev -- clubs
npm run dev -- new-save --name "Minha carreira" --manager "Meu Técnico" --club 1
npm run dev -- saves
```

Prefer `--save-id <id>` for campaign commands. The path-based `--save <path>` remains available for scripts.

## Inspect the career

```bash
npm run dev -- club --save-id <save-id>
npm run dev -- squad --save-id <save-id>
npm run dev -- tactics --save-id <save-id>
npm run dev -- fixtures --save-id <save-id>
npm run dev -- standings --stage 1 --save-id <save-id>
npm run dev -- season-status --save-id <save-id>
```

## Play and advance

```bash
npm run dev -- play 1 --save-id <save-id>
npm run dev -- advance-round 1 --save-id <save-id>
npm run dev -- standings --stage 1 --save-id <save-id>
npm run dev -- next-season --stage 1 --save-id <save-id>
```

Round advancement simulates all scheduled games for that round, recalculates league standings, and updates league-season status. Next-season generation creates a new league season with a double round-robin schedule and can be repeated safely.

## Scope

This phase closes the lifecycle for league stages. It does not implement promotion/relegation, qualification pools, cup knockout resolution, generic calendar optimization, or the final tactical engine. The match simulator remains a deterministic first-pass model.
