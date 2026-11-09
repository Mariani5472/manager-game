import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SaveManager } from "../modules/saves/repo/save-manager.js";

test("simulate-season CLI completes all league and cup rounds and prints standings between rounds", () => {
  const root = mkdtempSync(join(tmpdir(), "gmf-simulate-season-"));
  const env = {
    ...process.env,
    GM_MASTER_DB: join(root, "world", "master.sqlite"),
    GM_SAVE_DIR: join(root, "world", "saves"),
    GMF_SCHEMA_SQL: resolve("apps/api/schema/game_manager_mvp.sql"),
  };
  const cliPath = resolve("dist/api/legacy-cli.js");
  const run = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8", env, cwd: process.cwd(), maxBuffer: 5 * 1024 * 1024, timeout: 120_000,
  });
  try {
    let result = run("init-master");
    assert.equal(result.status, 0, result.stderr);
    result = run("new-save", "--name", "Full season CLI", "--manager", "CLI test", "--club", "1");
    assert.equal(result.status, 0, result.stderr);
    const save = JSON.parse(result.stdout) as { id: string };
    result = run("simulate-season", "--save-id", save.id);
    assert.equal(result.status, 0, result.stderr || result.stdout.slice(-2000));
    assert.match(result.stdout, /Classificação após Liga Nacional de Teste — rodada 30:/);
    assert.match(result.stdout, /Classificação após Copa Nacional de Teste — rodada 4:/);
    assert.match(result.stdout, /Temporada processada: 34 rodada\(s\) simulada\(s\)\./);
    assert.match(result.stdout, /COMPLETED/);
    const manager = new SaveManager(env.GM_MASTER_DB, env.GM_SAVE_DIR);
    const saved = manager.list().find(item => item.id === save.id);
    assert.ok(saved, "the campaign save must remain available after simulation");
    const db = manager.open(saved.filePath);
    try {
      const fixtures = db.prepare(`
        SELECT st.stage_kind AS stageKind,f.status,f.current_minute AS minute,
          f.home_score AS homeScore,f.away_score AS awayScore
        FROM fixture f
        JOIN competition_round r ON r.id=f.round_id
        JOIN competition_stage st ON st.id=r.stage_id
        ORDER BY st.stage_kind,r.round_number,f.id
      `).all() as Array<{stageKind:string;status:string;minute:number;homeScore:number|null;awayScore:number|null}>;
      const league = fixtures.filter(f => f.stageKind === "LEAGUE");
      const cup = fixtures.filter(f => f.stageKind === "KNOCKOUT");
      assert.equal(league.length, 240, "16-team double round-robin has 240 league fixtures");
      assert.equal(cup.length, 15, "16-team knockout cup must produce 15 fixtures");
      assert.ok(fixtures.every(f => f.status === "COMPLETED" && f.minute === 90), "AI and managed fixtures must all reach full time");
      assert.ok(fixtures.every(f => Number.isInteger(f.homeScore) && Number.isInteger(f.awayScore)), "every result must be persisted");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_simulation_state WHERE simulation_minute<>90").get() as {count:number}).count, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE minute=90").get() as {count:number}).count, fixtures.length);
      const standings = db.prepare("SELECT COUNT(*) AS count,MIN(played) AS minPlayed,MAX(played) AS maxPlayed FROM stage_standing WHERE stage_id=1").get() as {count:number;minPlayed:number;maxPlayed:number};
      assert.equal(standings.count, 16);
      assert.equal(standings.minPlayed, 30);
      assert.equal(standings.maxPlayed, 30);
      assert.equal(db.pragma("integrity_check", {simple:true}), "ok");
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally {
      db.close();
    }

    result = run("simulate-season", "--save-id", save.id);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Não há rodadas pendentes para simular nesta campanha\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
