# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Requirements

- Node.js 22+
- npm

## Validate a clean checkout

```bash
npm install
npm test
npm run build
```

The test suite builds strict TypeScript and runs integration tests against temporary SQLite databases. Tests cover the complete schema and trigger validation, WAL-safe save backups, independent saves, save discovery by stable ID, input validation, match rollback, standings and complete league-season persistence.

## Initialize the world

```bash
npm run dev -- init-master
npm run dev -- clubs
```

By default, the world is stored in `data/master.sqlite`. Initialization creates the parent directory when needed. Re-running `init-master` validates and preserves an existing world rather than overwriting it. A corrupt or incompatible existing database is reported as an error.

Optional path overrides are available for clean smoke tests or separate installations:

```bash
GMF_MASTER_DB=/tmp/gmf-master.sqlite \
GMF_SAVES_DIR=/tmp/gmf-saves \
npm run dev -- init-master
```

## Create and reopen a career

```bash
npm run dev -- new-save --name "Minha carreira" --manager "Meu Técnico" --club 1
npm run dev -- saves
```

The `new-save` command prints the stable save ID and its path. Prefer the save ID for normal gameplay commands. Path-based `--save <path>` remains available for scripts; supplying both `--save-id` and `--save` is rejected.

```bash
npm run dev -- club --save-id <save-id>
npm run dev -- squad --save-id <save-id>
npm run dev -- tactics --save-id <save-id>
npm run dev -- fixtures --save-id <save-id>
npm run dev -- fixtures --pending --save-id <save-id>
```

Each campaign is an independent SQLite database. Save creation uses SQLite's online backup API, validates schema and foreign-key integrity, writes metadata to a temporary database, and publishes the finished save by atomic rename. This avoids copying only the main database file while writes may still exist in the WAL. Saves reject missing/unsupported schema versions and missing selected clubs.

## Play the league

```bash
npm run dev -- play 1 --save-id <save-id>
npm run dev -- advance-round 1 --save-id <save-id>
npm run dev -- standings --stage 1 --save-id <save-id>
npm run dev -- season-status --save-id <save-id>
npm run dev -- next-season --stage 1 --save-id <save-id>
```

Round advancement simulates every scheduled fixture in the round, including AI-vs-AI matches, and updates standings and season state in one database transaction. A match is only simulated while the fixture is `SCHEDULED`; that state is re-checked under an immediate write transaction to prevent competing processes from committing two results for the same fixture.

The seeded fictional league contains four clubs, six rounds and 12 home/away fixtures. Results, match events, momentum, fatigue and standings survive closing and reopening the save. The next-season command creates a deterministic double round-robin calendar and is idempotent for the same competition/year.

## Current boundaries

This is a playable technical slice, not the final simulation engine. The match model is deterministic and event-driven, but remains a first-pass chance model. The league lifecycle is implemented for the seeded MVP; promotion/relegation application, qualification pools, complete cup knockout resolution, head-to-head tie-break calculations, generalized calendar optimization, desktop UI and executable packaging remain future work.

## CLI command reference

| Command | Purpose |
| --- | --- |
| `init-master` | Create and validate the master database; preserve an existing valid world |
| `clubs` | List clubs in the master world |
| `new-save --name <name> --manager <name> --club <id>` | Create an independent career and print its stable ID |
| `saves` | List campaign saves |
| `club --save-id <id>` | Display the controlled club |
| `squad [--club <id>] --save-id <id>` | List the selected or specified club's players |
| `tactics [--club <id>] --save-id <id>` | Display current tactics |
| `fixtures [--pending] --save-id <id>` | List fixtures |
| `play [fixture-id] --save-id <id>` | Simulate one scheduled fixture |
| `advance-round <round-id> --save-id <id>` | Simulate the scheduled matches of a round |
| `standings --stage <id> --save-id <id>` | Rebuild and display league standings |
| `season-status --save-id <id>` | Display competition-stage progress |
| `next-season [--stage <id>] --save-id <id>` | Generate the next league season |

Commands accept `--save-id` or `--save`, but not both.
