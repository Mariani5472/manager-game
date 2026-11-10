import { resolve } from "node:path";

const root = process.cwd();

export const masterPath = resolve(
  process.env.GM_MASTER_DB ?? resolve(root, "data/master.sqlite"),
);

export const saveDir = resolve(
  process.env.GM_SAVE_DIR ?? resolve(root, "data/saves"),
);

export const schemaPath = resolve(
  process.env.GMF_SCHEMA_SQL ??
    resolve(root, "apps/api/modules/world/schema/game_manager_mvp.sql"),
);
