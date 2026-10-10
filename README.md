# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Requirements

- Node.js 20+
- npm

## Clean checkout validation

Run these commands after cloning the repository:

```bash
npm install
npm test
npm run build
```

The test command compiles the strict TypeScript project and runs the Node.js test suite against temporary SQLite databases. The tests must not depend on a pre-existing `data/` directory or a locally created career.

## Initialize a new world

Create the master database from the checked-in schema and seed data:

```bash
npm run dev -- init-master
```

By default this creates `data/master.sqlite`. If it already exists, the command preserves it and does not overwrite existing data. To test from a truly clean state, use an empty checkout or remove/relocate the local `data/` directory before initialization.

List the fictional clubs in the master database:

```bash
npm run dev -- clubs
```

## Campaign saves

Create a career:

```bash
npm run dev -- new-save --name "Minha carreira" --manager "Meu Técnico" --club 1
```

The command prints a stable save ID, display name and file path. Use the save ID for later commands; do not make players manage SQLite filenames:

```bash
npm run dev -- saves
npm run dev -- fixtures --save-id <save-id>
npm run dev -- play 1 --save-id <save-id>
npm run dev -- advance-round 1 --save-id <save-id>
```

For scripts and backwards compatibility, campaign commands also accept `--save <path>`. If both `--save-id` and `--save` are supplied, the CLI rejects the ambiguous request.

Each career is stored in its own SQLite database below `data/saves/`. Mutating one career must not change the master database or another career.

## Database model

- `src/schema/game_manager_mvp.sql` is the master schema and fictional-world seed.
- `data/master.sqlite` is the initialized master database.
- `data/saves/` contains independent campaign databases.

The checked-in SQL defines the trigger `trg_match_lineup_validate_update`; the schema is validated in automated tests using `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.

## Implemented

- Create and list independent campaign saves.
- Initialize the master world using the checked-in schema and seed.
- Validate SQLite integrity and foreign-key constraints.
- Deterministic first-pass 90-minute match simulation using a fixture seed.
- Persist match events, per-minute momentum, score, fixture state and fatigue.
- Batch-process scheduled fixtures in a competition round.

## Current boundaries

This is a playable technical slice, not yet a complete football manager. The match simulator is a first-pass strength/chance model. Substitutions, cards, in-match injuries, applied tactical changes, full player-by-player action resolution, extra time, penalties, standings recalculation, promotion/relegation and schedule optimization are not complete.

Save creation currently copies the master SQLite file and assumes the master is immutable and not being written to concurrently during creation. If a future workflow allows live writes to the master database, switch save creation to SQLite's online backup API.
