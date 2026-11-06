import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("simulate-season CLI completes all league and cup rounds and prints standings between rounds", () => {
  const root = mkdtempSync(join(tmpdir(), "gmf-simulate-season-"));
  const env = {
    ...process.env,
    GMF_MASTER_DB: join(root, "world", "master.sqlite"),
    GMF_SAVES_DIR: join(root, "world", "saves"),
    GMF_SCHEMA_SQL: resolve("src/schema/game_manager_mvp.sql"),
  };
  const cliPath = resolve("dist/cli.js");
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
    result = run("simulate-season", "--save-id", save.id);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Não há rodadas pendentes para simular nesta campanha\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
