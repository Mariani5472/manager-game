import { clamp } from "../mathUtils.js";
import type { Team } from "../../types/match-engine.types.js";
import type { GameAction, TeamGameState } from "./gameState.types.js";
import { getCounterAttackOpportunityChance, getTacticalProgressionModifier } from "../tacticalModel.js";

export function resolveTeamGameActions(
  team: Team,
  opponent: Team,
  state: TeamGameState,
  opponentState: TeamGameState,
  minute: number,
  random: () => number,
): GameAction[] {
  const actions: GameAction[] = [];
  const activeRatio =
    team.lineup.filter((player) => player.isStarting).length / 11;
  const attackingMatchup = team.attacking - opponent.defending;
  const fatiguePenalty = (100 - state.physicalCondition) * 0.0008;

  const progressionChance = clamp(
    0.24 +
      attackingMatchup * 0.0015 +
      getTacticalProgressionModifier(team.tactic) +
      (state.territorialControl - 50) * 0.0015 -
      fatiguePenalty +
      (activeRatio - 1) * 0.2,
    0.08,
    0.52,
  );

  if (random() >= progressionChance) {
    if (
      team.tactic.counter_attack &&
      opponentState.territorialControl >= 62 &&
      random() <
        getCounterAttackOpportunityChance(
          team.tactic,
          opponent.tactic,
          team.attacking,
          opponent.defending,
        )
    ) {
      actions.push({ minute, clubId: team.clubId, type: "COUNTER_ATTACK" });
    }
    return actions;
  }

  actions.push({ minute, clubId: team.clubId, type: "PROGRESSION" });

  const finalThirdChance = clamp(
    0.2 +
      attackingMatchup * 0.0012 +
      (state.territorialControl - 50) * 0.0018 +
      (team.tactic.passing_directness - 50) * 0.0005 -
      fatiguePenalty,
    0.06,
    0.38,
  );
  if (random() >= finalThirdChance) return actions;

  actions.push({ minute, clubId: team.clubId, type: "FINAL_THIRD_ENTRY" });

  const boxEntryChance = clamp(
    0.24 +
      (team.attacking - 50) * 0.0008 +
      (50 - opponentState.defensiveStability) * 0.0008 +
      (state.territorialControl - 50) * 0.001,
    0.06,
    0.42,
  );
  if (random() < boxEntryChance) {
    actions.push({ minute, clubId: team.clubId, type: "BOX_ENTRY" });
  }

  return actions;
}
