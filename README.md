# Manager Game

A data-driven, text-based football manager built with TypeScript, Node.js and SQLite.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
npm test
npm run build
```

## Database model

- `src/schema/game_manager_mvp.sql` is the master world/schema seed.
- `data/master.sqlite` is the initialized master database.
- Each campaign is a separate SQLite database under `data/saves/`. Playing matches in one save does not mutate another save or the master database.

## Commands

Initialize the master database:

```bash
npm run dev -- init-master
```

List the fictional clubs in the master database:

```bash
npm run dev -- clubs
```

Create a save from one selected club:

```bash
npm run dev -- new-save --name "Minha carreira" --manager "Meu Técnico" --club 1
```

List saved campaigns:

```bash
npm run dev -- saves
```

Use the printed SQLite path to list fixtures and play in that campaign:

```bash
npm run dev -- fixtures --save data/saves/minha-carreira-xxxxxxxx.sqlite
npm run dev -- play 1 --save data/saves/minha-carreira-xxxxxxxx.sqlite
npm run dev -- advance-round 1 --save data/saves/minha-carreira-xxxxxxxx.sqlite
```

## What is implemented

- Create and open independent save databases.
- Check schema/foreign-key integrity on initialization and save opening.
- Deterministic first-pass 90-minute match simulation driven by each fixture seed.
- Per-minute momentum data and match events.
- Score and fixture status persisted in a transaction.
- Batch command to process one competition round fixture-by-fixture.

## Known MVP limitations

The current match engine is a deterministic vertical slice, not the final tactical simulator. It does not yet model substitutions, cards, injuries in-match, tactical-change application, full player-by-player action resolution, overtime, penalties, standings recomputation, promotion/relegation, or schedule optimization. The schema is still being stabilized; fix the malformed trigger name in the current SQL before relying on it. Save creation uses a filesystem copy and therefore assumes the master database is closed/immutable during creation; use SQLite's online backup API if the master may be written concurrently.
