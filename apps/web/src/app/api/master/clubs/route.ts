import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { masterPath } from "../../../../../src/client/config.js";
import { open, validate } from "../../../../../src/db/database.js";

export const runtime = "nodejs";

export async function GET() {
  if (!existsSync(masterPath)) return NextResponse.json({ ready: false, clubs: [] });
  try {
    const db = open(masterPath, true);
    try {
      validate(db);
      const columns = db.pragma("table_info(club)") as Array<{ name: string }>;
      const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const tables = new Set(tableNames.map((table) => table.name));
      const hasCity = columns.some((column) => column.name === "city_id") && tables.has("city");
      const hasNation = tables.has("nation");
      const query = db.prepare(`
        SELECT c.id, c.name, COALESCE(c.reputation, 0) AS reputation,
               ${hasCity ? "COALESCE(ci.name, 'Unknown')" : "'Unknown'"} AS city
        FROM club c
        ${hasCity ? "LEFT JOIN city ci ON ci.id = c.city_id" : ""}
        WHERE COALESCE(c.extinct, 0) = 0
        ORDER BY c.reputation DESC, c.name
      `);
      const clubs = query.all();
      return NextResponse.json({ ready: true, clubs });
    } finally {
      db.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read master database." }, { status: 500 });
  }
}
