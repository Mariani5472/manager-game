import test from "node:test";
import assert from "node:assert/strict";
import { simulateMatchTimeline } from "../game/matchEngine/timelineSimulator.js";
import type { MatchPlayer, TacticalChange, Team } from "../game/matchEngine/types.js";

const roles = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "ST"];

function createTeam(clubId: number, level = 60, goalkeeperLevel = level): Team {
  const lineup: MatchPlayer[] = Array.from({ length: 18 }, (_, index) => {
    const isGoalkeeper = index === 0;
    const role = index < 11 ? roles[index]! : (index === 11 ? "GK" : "CM");
    const value = isGoalkeeper ? goalkeeperLevel : level;
    return {
      id: clubId * 100 + index + 1,
      name: `Player ${clubId}-${index + 1}`,
      goalkeeper: isGoalkeeper ? 1 : 0,
      energy: 100,
      morale: 50,
      sharpness: 50,
      pace: value,
      stamina: value,
      strength: value,
      positioning: value,
      decisions: value,
      composure: value,
      teamwork: value,
      work_rate: value,
      passing: value,
      vision: value,
      crossing: value,
      dribbling: value,
      finishing: value,
      long_shots: value,
      heading: value,
      tackling: value,
      marking: value,
      aggression: value,
      concentration: value,
      reflexes: value,
      handling: value,
      aerial_reach: value,
      role,
      slot: index < 11 ? index + 1 : index + 1,
      isStarting: index < 11,
      positionRating: value,
    };
  });

  return {
    clubId,
    reputation: level,
    tactic: {
      formation_id: 1,
      mentality: "BALANCED",
      pressing: 50,
      tempo: 50,
      defensive_line: 50,
      width: 50,
      passing_directness: 50,
      counter_attack: 1,
    },
    lineup,
    attacking: level,
    defending: level,
    goalkeeping: goalkeeperLevel,
    energy: 100,
    fitness: 100,
    context: {
      weather: "CLEAR",
      temperatureC: 20,
      pitchCondition: 70,
      restHours: 168,
      travelKm: 0,
      travelHours: 0,
    },
  };
}

test("same teams, seed and tactical commands produce an identical timeline without mutating inputs", () => {
  const home = createTeam(1, 70);
  const away = createTeam(2, 55);
  const before = JSON.stringify({ home, away });
  const changes: TacticalChange[] = [
    { id: 2, minute: 65, club_id: 1, change_type: "MENTALITY", payload: JSON.stringify({ mentality: "ATTACKING" }) },
    { id: 1, minute: 35, club_id: 2, change_type: "INSTRUCTION", payload: JSON.stringify({ key: "pressing", value: 75 }) },
  ];

  const first = simulateMatchTimeline(home, away, 81273, changes);
  const repeated = simulateMatchTimeline(home, away, 81273, changes);
  const reversedCommands = simulateMatchTimeline(home, away, 81273, [...changes].reverse());

  assert.deepEqual(first, repeated);
  assert.deepEqual(first, reversedCommands);
  assert.equal(JSON.stringify({ home, away }), before);
});

test("generated timelines keep scores, shots, xG and minute events internally consistent", () => {
  const home = createTeam(1, 72);
  const away = createTeam(2, 48);
  const aggregate = {
    goals: 0,
    saves: 0,
    misses: 0,
    yellowCards: 0,
    redCards: 0,
    substitutions: 0,
  };

  for (let seed = 1; seed <= 300; seed += 1) {
    const timeline = simulateMatchTimeline(home, away, seed);
    assert.equal(timeline.minutes.length, 90);
    assert.equal(timeline.result.homeScore + timeline.result.awayScore,
      timeline.events.filter(event => event.eventType === "GOAL").length);
    assert.equal(timeline.result.homeShots + timeline.result.awayShots,
      timeline.events.filter(event => ["GOAL", "SAVE", "MISS"].includes(event.eventType)).length);
    assert.ok(timeline.result.homeShotsOnTarget <= timeline.result.homeShots);
    assert.ok(timeline.result.awayShotsOnTarget <= timeline.result.awayShots);
    assert.ok(timeline.result.homeXg >= 0 && timeline.result.awayXg >= 0);
    assert.ok(timeline.minutes.every(minute =>
      minute.homePressure >= 0 && minute.homePressure <= 100 &&
      minute.awayPressure >= 0 && minute.awayPressure <= 100
    ));

    for (const event of timeline.events) {
      if (event.eventType === "GOAL") aggregate.goals += 1;
      if (event.eventType === "SAVE") aggregate.saves += 1;
      if (event.eventType === "MISS") aggregate.misses += 1;
      if (event.eventType === "YELLOW_CARD") aggregate.yellowCards += 1;
      if (event.eventType === "RED_CARD") aggregate.redCards += 1;
      if (event.eventType === "SUBSTITUTION") aggregate.substitutions += 1;
    }
  }

  assert.ok(aggregate.goals > 0);
  assert.ok(aggregate.saves > 0);
  assert.ok(aggregate.misses > 0);
  assert.ok(aggregate.yellowCards > 0);
  assert.ok(aggregate.redCards > 0, "seeded extreme sample should include a direct or second-yellow red card");
});

test("scheduled substitutions emit events and preserve eleven active players", () => {
  const home = createTeam(1);
  const away = createTeam(2);
  const changes: TacticalChange[] = [
    { id: 1, minute: 10, club_id: 1, change_type: "SUBSTITUTION", payload: JSON.stringify({ playerOutId: 102, playerInId: 112 }) },
    { id: 2, minute: 20, club_id: 1, change_type: "SUBSTITUTION", payload: JSON.stringify({ playerOutId: 103, playerInId: 113 }) },
    { id: 3, minute: 30, club_id: 1, change_type: "SUBSTITUTION", payload: JSON.stringify({ playerOutId: 104, playerInId: 114 }) },
  ];

  const timeline = simulateMatchTimeline(home, away, 901, changes);
  const substitutions = timeline.events.filter(event =>
    event.eventType === "SUBSTITUTION" && event.clubId === home.clubId
  );

  assert.equal(substitutions.length, 3);
  assert.deepEqual(substitutions.map(event => event.minute), [10, 20, 30]);
});

test("formation changes reject duplicate slots and goalkeeper-role mismatches", () => {
  const home = createTeam(1);
  const away = createTeam(2);
  const invalidAssignments = home.lineup
    .filter(player => player.isStarting)
    .map(player => ({
      playerId: player.id,
      slotNumber: player.slot,
      positionCode: player.role,
    }));
  invalidAssignments[0] = {
    playerId: home.lineup[0]!.id,
    slotNumber: 1,
    positionCode: "CB",
  };

  const change: TacticalChange = {
    id: 1,
    minute: 45,
    club_id: 1,
    change_type: "FORMATION",
    payload: JSON.stringify({ formationId: 2, slots: invalidAssignments }),
  };

  assert.throws(
    () => simulateMatchTimeline(home, away, 44, [change]),
    /invalid slot assignments/,
  );
});

test("exceptional goalkeeper lowers conversion without removing shot creation", () => {
  const averageGoalkeeper = createTeam(2, 60, 50);
  const eliteGoalkeeper = createTeam(2, 60, 100);
  const home = createTeam(1, 60);
  let goalsAgainstAverageKeeper = 0;
  let goalsAgainstEliteKeeper = 0;
  let shotsAgainstAverageKeeper = 0;
  let shotsAgainstEliteKeeper = 0;

  for (let seed = 100; seed < 600; seed += 1) {
    const average = simulateMatchTimeline(home, averageGoalkeeper, seed).result;
    const elite = simulateMatchTimeline(home, eliteGoalkeeper, seed).result;
    goalsAgainstAverageKeeper += average.homeScore;
    goalsAgainstEliteKeeper += elite.homeScore;
    shotsAgainstAverageKeeper += average.homeShots;
    shotsAgainstEliteKeeper += elite.homeShots;
  }

  assert.ok(goalsAgainstEliteKeeper < goalsAgainstAverageKeeper, JSON.stringify({
    goalsAgainstAverageKeeper,
    goalsAgainstEliteKeeper,
  }));
  assert.equal(shotsAgainstEliteKeeper, shotsAgainstAverageKeeper);
});

test("extreme player ratings remain bounded and never produce invalid match statistics", () => {
  const dominant = createTeam(1, 100, 100);
  const underdog = createTeam(2, 0, 0);

  for (let seed = 1; seed <= 100; seed += 1) {
    const result = simulateMatchTimeline(dominant, underdog, seed).result;
    assert.ok(result.homeScore >= 0 && result.awayScore >= 0);
    assert.ok(result.homeShots >= result.homeShotsOnTarget);
    assert.ok(result.awayShots >= result.awayShotsOnTarget);
    assert.ok(Number.isFinite(result.homeXg) && Number.isFinite(result.awayXg));
    assert.ok(result.homeXg >= 0 && result.awayXg >= 0);
  }
});
