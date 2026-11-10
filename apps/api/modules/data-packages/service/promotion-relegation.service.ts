import type { SqliteDatabase } from "../../../db/database.js";
import { ensureDataPackageSchema } from "../repo/data-package-schema.repository.js";
import type {
  PromotionRelegationMovement,
  PromotionRelegationResult,
} from "../types/data-package.types.js";
import { assert } from "./validation.utils.js";

interface PromotionRuleRow {
  id: number;
  source_stage_id: number;
  position_from: number;
  position_to: number;
  movement_type: string;
  target_competition_id: number | null;
  target_stage_id: number | null;
  target_tier: number | null;
  priority: number;
  stageId: number;
  year: number;
  sourceName: string;
}

export function applyPromotionRelegation(
  db: SqliteDatabase,
  seasonYear: number,
): PromotionRelegationResult {
  ensureDataPackageSchema(db);

  const rules = db
    .prepare(
      `
      SELECT
        pr.*,
        st.id AS stageId,
        cs.season_year AS year,
        co.name AS sourceName

      FROM promotion_relegation_rule pr

      JOIN competition_stage st
        ON st.id = pr.source_stage_id

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      WHERE cs.season_year = ?
        AND cs.status = 'COMPLETED'

      ORDER BY
        pr.priority,
        pr.id
    `,
    )
    .all(seasonYear) as PromotionRuleRow[];

  const movements: PromotionRelegationMovement[] = [];

  const tx = db.transaction(() => {
    for (const rule of rules) {
      const targetCompetition =
        rule.target_competition_id ??
        (rule.target_tier === null
          ? null
          : ((
              db
                .prepare(
                  "SELECT competition_id AS id FROM data_package_competition_tier WHERE tier=? ORDER BY competition_id LIMIT 1",
                )
                .get(rule.target_tier) as { id: number } | undefined
            )?.id ?? null));
      if (!targetCompetition)
        throw new Error(
          `No target competition found for movement rule ${rule.id} (tier ${rule.target_tier ?? "unset"}).`,
        );
      const sourceStage = db
        .prepare("SELECT season_id FROM competition_stage WHERE id=?")
        .get(rule.source_stage_id) as { season_id: number };
      const targetSeason = db
        .prepare(
          "SELECT id FROM competition_season WHERE competition_id=? AND season_year=?",
        )
        .get(targetCompetition, seasonYear + 1) as { id: number } | undefined;
      if (!targetSeason)
        throw new Error(
          `Target competition ${targetCompetition} has no season ${seasonYear + 1}; install/prepare it before applying movements.`,
        );
      const targetStage = db
        .prepare(
          "SELECT id FROM competition_stage WHERE season_id=? ORDER BY stage_order LIMIT 1",
        )
        .get(targetSeason.id) as { id: number } | undefined;
      if (!targetStage)
        throw new Error(
          `Target competition ${targetCompetition} has no stage in season ${seasonYear + 1}.`,
        );
      const sourceCompetitionId = (
        db
          .prepare(
            "SELECT competition_id AS id FROM competition_season WHERE id=?",
          )
          .get(sourceStage.season_id) as { id: number }
      ).id;
      const sourceNextSeason = db
        .prepare(
          "SELECT id FROM competition_season WHERE competition_id=? AND season_year=?",
        )
        .get(sourceCompetitionId, seasonYear + 1) as { id: number } | undefined;
      const sourceNextStage = sourceNextSeason
        ? (db
            .prepare(
              "SELECT id FROM competition_stage WHERE season_id=? ORDER BY stage_order LIMIT 1",
            )
            .get(sourceNextSeason.id) as { id: number } | undefined)
        : undefined;
      const targetName = (
        db
          .prepare("SELECT name FROM competition WHERE id=?")
          .get(targetCompetition) as { name: string }
      ).name;
      const ranking = db
        .prepare(
          `
        SELECT ss.club_id AS clubId,c.name AS club,ss.points,ss.goals_for-ss.goals_against AS goalDifference,ss.goals_for AS goalsFor
        FROM stage_standing ss JOIN club c ON c.id=ss.club_id WHERE ss.stage_id=?
        ORDER BY ss.points DESC,goalDifference DESC,goalsFor DESC,ss.club_id
      `,
        )
        .all(rule.source_stage_id) as Array<{
        clubId: number;
        club: string;
        points: number;
        goalDifference: number;
        goalsFor: number;
      }>;
      for (const row of ranking.slice(
        rule.position_from - 1,
        rule.position_to,
      )) {
        if (rule.movement_type !== "PLAYOFF" && sourceNextStage) {
          db.prepare(
            "DELETE FROM stage_participant WHERE stage_id=? AND club_id=?",
          ).run(sourceNextStage.id, row.clubId);
          db.prepare(
            "DELETE FROM stage_standing WHERE stage_id=? AND club_id=?",
          ).run(sourceNextStage.id, row.clubId);
          db.prepare(
            "DELETE FROM competition_entry WHERE season_id=? AND club_id=?",
          ).run(sourceNextSeason!.id, row.clubId);
        }
        const already = db
          .prepare(
            "SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?",
          )
          .get(targetStage.id, row.clubId);
        if (!already) {
          const group = db
            .prepare(
              "SELECT id FROM stage_group WHERE stage_id=? ORDER BY sort_order LIMIT 1",
            )
            .get(targetStage.id) as { id: number } | undefined;
          assert(group, "Target stage has no group.");
          db.prepare(
            "INSERT INTO stage_participant(stage_id,club_id,group_id,seed,source_note) VALUES(?,?,?,?,?)",
          ).run(
            targetStage.id,
            row.clubId,
            group.id,
            rule.position_from,
            `${rule.movement_type} from ${rule.sourceName}`,
          );
          db.prepare(
            "INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,?) ON CONFLICT(stage_id,club_id,group_id) DO NOTHING",
          ).run(targetStage.id, row.clubId, group.id);
          db.prepare(
            "INSERT INTO competition_entry(season_id,club_id,seed,entry_source) VALUES(?,?,?,'PROMOTION_RELEGATION') ON CONFLICT(season_id,club_id) DO NOTHING",
          ).run(targetSeason.id, row.clubId, rule.position_from);
        }
        movements.push({
          clubId: row.clubId,
          club: row.club,
          movement: rule.movement_type,
          from: rule.sourceName,
          to: targetName,
        });
      }
    }
  });

  tx();

  return {
    movements,
  };
}
