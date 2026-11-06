import type { SqliteDatabase } from "../db/database.js";

export type IntegritySeverity = "ERROR" | "WARNING";
export interface IntegrityFinding {
  severity: IntegritySeverity;
  code: string;
  entity: string;
  entityId: number | null;
  message: string;
}
export interface IntegrityAuditReport {
  checkedAt: string;
  completedFixtures: number;
  findings: IntegrityFinding[];
  ok: boolean;
}

type FixtureAuditRow = {
  id: number;
  home_club_id: number;
  away_club_id: number;
  home_score: number | null;
  away_score: number | null;
  random_seed: number | null;
  current_minute: number;
};

function tableExists(db: SqliteDatabase, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/**
 * Read-only consistency audit. It deliberately reports findings rather than repairing
 * persisted career data: silently "fixing" a save can destroy evidence of a partial write.
 */
export function auditGameIntegrity(db: SqliteDatabase, fixtureLimit = 500): IntegrityAuditReport {
  if (!Number.isSafeInteger(fixtureLimit) || fixtureLimit < 1 || fixtureLimit > 100_000) {
    throw new Error("Fixture audit limit must be an integer between 1 and 100000.");
  }

  const requiredTables = ["fixture", "match_event", "match_momentum", "match_simulation_state",
    "competition_round", "competition_stage", "stage_participant", "stage_standing"];
  const findings: IntegrityFinding[] = [];
  for (const table of requiredTables) {
    if (!tableExists(db, table)) {
      findings.push({ severity: "ERROR", code: "MISSING_REQUIRED_TABLE", entity: "database",
        entityId: null, message: `Required table '${table}' is missing.` });
    }
  }
  if (findings.length) {
    return { checkedAt: new Date().toISOString(), completedFixtures: 0, findings, ok: false };
  }

  const fixtures = db.prepare(`
    SELECT id, home_club_id, away_club_id, home_score, away_score, random_seed, current_minute
    FROM fixture WHERE status='COMPLETED' ORDER BY id DESC LIMIT ?
  `).all(fixtureLimit) as FixtureAuditRow[];

  const goalCounts = db.prepare(`
    SELECT club_id, COUNT(*) AS goals FROM match_event
    WHERE fixture_id=? AND event_type='GOAL' AND club_id IS NOT NULL GROUP BY club_id
  `);
  const momentumCount = db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=?");
  const checkpoint = db.prepare("SELECT state_version,simulation_minute,state_json FROM match_simulation_state WHERE fixture_id=?");
  const lineup = db.prepare(`
    SELECT club_id, COUNT(*) AS starters, COUNT(DISTINCT player_id) AS distinct_players,
      SUM(CASE WHEN position_code='GK' THEN 1 ELSE 0 END) AS goalkeeper_slots
    FROM match_lineup WHERE fixture_id=? AND is_starting=1 GROUP BY club_id
  `);

  for (const fixture of fixtures) {
    const goals = goalCounts.all(fixture.id) as Array<{club_id:number;goals:number}>;
    const homeGoals = goals.find(row => row.club_id === fixture.home_club_id)?.goals ?? 0;
    const awayGoals = goals.find(row => row.club_id === fixture.away_club_id)?.goals ?? 0;
    if (fixture.home_score === null || fixture.away_score === null ||
        homeGoals !== fixture.home_score || awayGoals !== fixture.away_score) {
      findings.push({ severity: "ERROR", code: "SCORE_EVENT_MISMATCH", entity: "fixture",
        entityId: fixture.id, message: `Stored score ${fixture.home_score}-${fixture.away_score} disagrees with GOAL events ${homeGoals}-${awayGoals}.` });
    }

    const momentum = (momentumCount.get(fixture.id) as {count:number}).count;
    if (momentum !== 90) {
      findings.push({ severity: "ERROR", code: "MOMENTUM_ROW_COUNT", entity: "fixture",
        entityId: fixture.id, message: `Completed fixture has ${momentum} momentum rows; expected 90.` });
    }

    const state = checkpoint.get(fixture.id) as {state_version:number;simulation_minute:number;state_json:string}|undefined;
    if (!state) {
      findings.push({ severity: "WARNING", code: "MISSING_CHECKPOINT", entity: "fixture",
        entityId: fixture.id, message: "Completed fixture has no simulation checkpoint (may be legacy data)." });
    } else {
      let completed = false;
      let parsed: {completed?:unknown;engineVersion?:unknown;seed?:unknown;config?:unknown} = {};
      try {
        parsed = JSON.parse(state.state_json) as typeof parsed;
        completed = parsed.completed === true;
      } catch {
        // JSON validity is also checked by SQLite's schema, but older schemas may not enforce it.
      }
      if (state.state_version < 1 || state.simulation_minute !== 90 || !completed) {
        findings.push({ severity: "ERROR", code: "INVALID_COMPLETION_CHECKPOINT", entity: "fixture",
          entityId: fixture.id, message: "Completed fixture checkpoint must be versioned, at minute 90, and marked completed." });
      }
      if (parsed.engineVersion === undefined || parsed.config === undefined) {
        findings.push({ severity: "WARNING", code: "LEGACY_SIMULATION_METADATA", entity: "fixture",
          entityId: fixture.id, message: "Checkpoint does not contain engine version and full simulation configuration metadata." });
      }
      if (parsed.seed !== undefined && fixture.random_seed !== null && parsed.seed !== fixture.random_seed) {
        findings.push({ severity: "ERROR", code: "CHECKPOINT_SEED_MISMATCH", entity: "fixture",
          entityId: fixture.id, message: "Checkpoint seed differs from the fixture's persisted seed." });
      }
    }

    if (fixture.current_minute !== 90) {
      findings.push({ severity: "ERROR", code: "FIXTURE_MINUTE_MISMATCH", entity: "fixture",
        entityId: fixture.id, message: `Completed fixture is stored at minute ${fixture.current_minute}, not 90.` });
    }
    if (fixture.random_seed === null) {
      findings.push({ severity: "WARNING", code: "MISSING_MATCH_SEED", entity: "fixture",
        entityId: fixture.id, message: "Fixture has no persisted random seed; exact replay may not be reproducible." });
    }

    const sides = lineup.all(fixture.id) as Array<{club_id:number;starters:number;distinct_players:number;goalkeeper_slots:number}>;
    for (const clubId of [fixture.home_club_id, fixture.away_club_id]) {
      const side = sides.find(row => row.club_id === clubId);
      if (!side || side.starters !== 11 || side.distinct_players !== 11 || side.goalkeeper_slots !== 1) {
        findings.push({ severity: "WARNING", code: "LINEUP_INVARIANT", entity: "fixture",
          entityId: fixture.id, message: `Club ${clubId} does not have exactly eleven distinct persisted starters and one GK slot.` });
      }
    }
  }

  if (tableExists(db, "player_contract") && tableExists(db, "squad_membership")) {
    const contractMismatches = db.prepare(`
      SELECT pc.player_id AS playerId, pc.club_id AS contractClub, sm.club_id AS membershipClub
      FROM player_contract pc
      LEFT JOIN squad_membership sm ON sm.player_id=pc.player_id
      WHERE pc.status='ACTIVE' AND (pc.club_id IS NULL OR sm.player_id IS NULL OR sm.club_id<>pc.club_id)
      LIMIT 100
    `).all() as Array<{playerId:number;contractClub:number|null;membershipClub:number|null}>;
    for (const row of contractMismatches) {
      findings.push({ severity: "ERROR", code: "ACTIVE_CONTRACT_MEMBERSHIP_MISMATCH", entity: "player",
        entityId: row.playerId, message: `Active contract club ${row.contractClub ?? "NULL"} does not match squad membership ${row.membershipClub ?? "missing"}.` });
    }
  }

  if (tableExists(db, "club_finance") && tableExists(db, "player_contract")) {
    const financeRows = db.prepare(`
      SELECT f.club_id AS clubId, f.balance, f.transfer_budget AS transferBudget,
        f.weekly_wage_budget AS wageBudget,
        COALESCE(SUM(CASE WHEN pc.status='ACTIVE' THEN pc.weekly_wage ELSE 0 END),0) AS wageBill
      FROM club_finance f LEFT JOIN player_contract pc ON pc.club_id=f.club_id
      GROUP BY f.club_id
    `).all() as Array<{clubId:number;balance:number;transferBudget:number;wageBudget:number;wageBill:number}>;
    for (const row of financeRows) {
      if (row.transferBudget > row.balance) {
        findings.push({ severity: "WARNING", code: "TRANSFER_BUDGET_EXCEEDS_BALANCE", entity: "club",
          entityId: row.clubId, message: `Transfer budget ${row.transferBudget} exceeds balance ${row.balance}.` });
      }
      if (row.wageBill > row.wageBudget) {
        findings.push({ severity: "WARNING", code: "WAGE_BILL_EXCEEDS_BUDGET", entity: "club",
          entityId: row.clubId, message: `Active weekly wage bill ${row.wageBill} exceeds budget ${row.wageBudget}.` });
      }
    }
  }

  const invalidParticipants = db.prepare(`
    SELECT sp.stage_id, sp.club_id FROM stage_participant sp
    JOIN competition_stage st ON st.id=sp.stage_id
    LEFT JOIN stage_standing ss ON ss.stage_id=sp.stage_id AND ss.club_id=sp.club_id
    WHERE st.stage_kind IN ('LEAGUE','GROUPS') AND ss.club_id IS NULL LIMIT 100
  `).all() as Array<{stage_id:number;club_id:number}>;
  for (const row of invalidParticipants) {
    findings.push({ severity: "ERROR", code: "PARTICIPANT_WITHOUT_STANDING", entity: "stage",
      entityId: row.stage_id, message: `Club ${row.club_id} participates in stage ${row.stage_id} without a standing row.` });
  }

  return {
    checkedAt: new Date().toISOString(),
    completedFixtures: fixtures.length,
    findings,
    ok: findings.every(finding => finding.severity !== "ERROR"),
  };
}
