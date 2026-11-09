import type {
  SqliteDatabase,
} from "../../../../db/database.js";
import {
  resolveMatchContext,
} from "../service/match-context.service.js";
import { selectLineup } from "./lineupService.js";
import {
  bestPosition,
  loadPlayers,
  loadPositions,
  loadTactic,
} from "./playerLoader.js";
import {
  fit,
  skill,
} from "./strengthCalculator.js";
import { mean } from "./mathUtils.js";
import type {
  Team,
} from "./types.js";


export function loadTeam(
  db: SqliteDatabase,
  fixtureId: number,
  clubId: number,
  persistLineup = true
): Team {
  const club = db
    .prepare(
      "SELECT reputation FROM club WHERE id=?"
    )
    .get(clubId) as {
      reputation: number;
    } | undefined;

  if (!club) {
    throw new Error(
      `Club ${clubId} not found.`
    );
  }


  const tactic = loadTactic(
    db,
    clubId
  );

  const players = loadPlayers(
    db,
    clubId,
    fixtureId
  );

  const lineup = selectLineup(
    db,
    fixtureId,
    clubId,
    players,
    tactic,
    persistLineup
  );

  const starters = lineup.filter(
    player => player.isStarting
  );

  const positions = loadPositions(
    db,
    clubId
  );


  const positionRating = mean(
    starters.map(
      player =>
        player.positionRating *
        fit(
          bestPosition(
            player.id,
            positions
          ),
          player.role
        )
    )
  );


  const attacking = mean(
    starters.map(
      player =>
        skill(player, player.role) * 0.72 +
        player.positionRating * 0.28 +
        player.energy * 0.18 +
        player.morale * 0.08 +
        player.sharpness * 0.08
    )
  );


  const defending = mean(
    starters.map(
      player =>
        mean([
          player.tackling,
          player.marking,
          player.positioning,
          player.concentration,
          player.strength,
        ])
    )
  );


  const keeper = starters.find(
    player =>
      player.isStarting &&
      player.role === "GK"
  );


  return {
    clubId,
    reputation: club.reputation,
    tactic,
    lineup,

    attacking:
      attacking +
      (positionRating - 50) * 0.15,

    defending,

    goalkeeping: keeper
      ? mean([
          keeper.reflexes,
          keeper.handling,
          keeper.aerial_reach,
          keeper.positioning,
        ])
      : 45,

    energy: mean(
      starters.map(
        player => player.energy
      )
    ),

    fitness: mean(
      starters.map(
        player => player.stamina
      )
    ),

    context: resolveMatchContext(
      db,
      fixtureId,
      clubId
    ),
  };
}