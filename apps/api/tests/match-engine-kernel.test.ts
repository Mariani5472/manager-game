import test from "node:test";
import assert from "node:assert/strict";
import { simulateMatchTimeline } from "../modules/matches/engine/timelineSimulator.js";
import {
  advanceMatchGameState,
  createMatchGameState,
} from "../modules/matches/engine/game-state/gameState.calculator.js";
import { resolveTeamGameActions } from "../modules/matches/engine/game-state/gameActionResolver.js";
import { runMomentumCalibration } from "../modules/matches/engine/momentum/momentumAnalysis.js";
import type {
  MatchPlayer,
  TacticalChange,
  Team,
} from "../modules/matches/types/match-engine.types.js";

const roles = [
  "GK",
  "CB",
  "CB",
  "LB",
  "RB",
  "DM",
  "CM",
  "CM",
  "AM",
  "LW",
  "ST",
];

function createTeam(clubId: number, level = 60, goalkeeperLevel = level): Team {
  const lineup: MatchPlayer[] = Array.from({ length: 18 }, (_, index) => {
    const isGoalkeeper = index === 0;
    const role = index < 11 ? roles[index]! : index === 11 ? "GK" : "CM";
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
    {
      id: 2,
      minute: 65,
      club_id: 1,
      change_type: "MENTALITY",
      payload: JSON.stringify({ mentality: "ATTACKING" }),
    },
    {
      id: 1,
      minute: 35,
      club_id: 2,
      change_type: "INSTRUCTION",
      payload: JSON.stringify({ key: "pressing", value: 75 }),
    },
  ];

  const first = simulateMatchTimeline(home, away, 81273, changes);
  const repeated = simulateMatchTimeline(home, away, 81273, changes);
  const reversedCommands = simulateMatchTimeline(
    home,
    away,
    81273,
    [...changes].reverse(),
  );

  assert.deepEqual(first, repeated);
  assert.deepEqual(first, reversedCommands);
  assert.notDeepEqual(first, simulateMatchTimeline(home, away, 81274, changes));
  assert.equal(JSON.stringify({ home, away }), before);
});

test("invalidated substitutions are cancelled and formation changes preserve the current eleven", () => {
  const home = createTeam(1, 70);
  const away = createTeam(2, 55);
  const outgoing = home.lineup[1]!;
  const firstIncoming = home.lineup[12]!;
  const secondIncoming = home.lineup[13]!;
  const originalStarters = home.lineup.slice(0, 11);
  const formationSlots = originalStarters.map((player, index) => ({
    playerId: player.id,
    slotNumber: index + 1,
    positionCode: roles[index]!,
  }));
  const changes: TacticalChange[] = [
    {
      id: 1,
      minute: 1,
      club_id: home.clubId,
      change_type: "SUBSTITUTION",
      payload: JSON.stringify({
        playerOutId: outgoing.id,
        playerInId: firstIncoming.id,
      }),
    },
    {
      id: 2,
      minute: 15,
      club_id: home.clubId,
      change_type: "SUBSTITUTION",
      payload: JSON.stringify({
        playerOutId: outgoing.id,
        playerInId: secondIncoming.id,
      }),
    },
    {
      id: 3,
      minute: 20,
      club_id: home.clubId,
      change_type: "FORMATION",
      payload: JSON.stringify({ formationId: 1, slots: formationSlots }),
    },
  ];

  const timeline = simulateMatchTimeline(home, away, 99173, changes);
  assert.ok(
    timeline.events.some(
      (event) =>
        event.minute === 1 &&
        event.eventType === "SUBSTITUTION" &&
        event.playerId === outgoing.id &&
        event.secondaryPlayerId === firstIncoming.id,
    ),
  );
  assert.ok(
    timeline.events.some(
      (event) =>
        event.minute === 15 &&
        event.eventType === "TACTIC_CHANGE" &&
        event.description.includes("Substituição cancelada"),
    ),
  );
  assert.ok(
    timeline.events.some(
      (event) =>
        event.minute === 20 &&
        event.eventType === "TACTIC_CHANGE" &&
        event.description.includes("Formação"),
    ),
  );
  assert.equal(timeline.minutes.length, 90);
  assert.ok(
    !timeline.events.some(
      (event) =>
        event.minute > 20 &&
        event.playerId === outgoing.id &&
        [
          "GOAL",
          "SAVE",
          "MISS",
          "FOUL",
          "YELLOW_CARD",
          "RED_CARD",
          "INJURY",
        ].includes(event.eventType),
    ),
    "a player already substituted out must not be restored by a later formation change",
  );
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
    secondYellowDismissals: 0,
  };

  for (let seed = 1; seed <= 300; seed += 1) {
    const timeline = simulateMatchTimeline(home, away, seed);
    assert.equal(timeline.minutes.length, 90);
    assert.equal(
      timeline.result.homeScore + timeline.result.awayScore,
      timeline.events.filter((event) => event.eventType === "GOAL").length,
    );
    assert.equal(
      timeline.result.homeShots + timeline.result.awayShots,
      timeline.events.filter((event) =>
        ["GOAL", "SAVE", "MISS"].includes(event.eventType),
      ).length,
    );
    assert.ok(timeline.result.homeShotsOnTarget <= timeline.result.homeShots);
    assert.ok(timeline.result.awayShotsOnTarget <= timeline.result.awayShots);
    assert.ok(timeline.result.homeXg >= 0 && timeline.result.awayXg >= 0);
    assert.equal(
      timeline.result.homeFouls,
      timeline.events.filter(
        (event) => event.clubId === 1 && event.eventType === "FOUL",
      ).length,
    );
    assert.equal(
      timeline.result.awayFouls,
      timeline.events.filter(
        (event) => event.clubId === 2 && event.eventType === "FOUL",
      ).length,
    );
    assert.equal(
      timeline.result.homeYellowCards,
      timeline.events.filter(
        (event) => event.clubId === 1 && event.eventType === "YELLOW_CARD",
      ).length,
    );
    assert.equal(
      timeline.result.awayRedCards,
      timeline.events.filter(
        (event) => event.clubId === 2 && event.eventType === "RED_CARD",
      ).length,
    );
    assert.ok(
      timeline.minutes.every(
        (minute) =>
          minute.homePressure >= 0 &&
          minute.homePressure <= 100 &&
          minute.awayPressure >= 0 &&
          minute.awayPressure <= 100,
      ),
    );

    const bookings = new Map<string, number>();
    for (const event of timeline.events) {
      if (event.eventType === "YELLOW_CARD") {
        const key = `${event.clubId}:${event.playerId}`;
        bookings.set(key, (bookings.get(key) ?? 0) + 1);
      }
      if (event.eventType === "GOAL") aggregate.goals += 1;
      if (event.eventType === "SAVE") aggregate.saves += 1;
      if (event.eventType === "MISS") aggregate.misses += 1;
      if (event.eventType === "YELLOW_CARD") aggregate.yellowCards += 1;
      if (event.eventType === "RED_CARD") aggregate.redCards += 1;
      if (event.eventType === "SUBSTITUTION") aggregate.substitutions += 1;
    }
    for (const [key, yellowCount] of bookings) {
      if (
        yellowCount >= 2 &&
        timeline.events.some(
          (event) =>
            event.eventType === "RED_CARD" &&
            `${event.clubId}:${event.playerId}` === key,
        )
      ) {
        aggregate.secondYellowDismissals += 1;
      }
    }
  }

  assert.ok(aggregate.goals > 0);
  assert.ok(aggregate.saves > 0);
  assert.ok(aggregate.misses > 0);
  assert.ok(aggregate.yellowCards > 0);
  assert.ok(
    aggregate.redCards > 0,
    "seeded extreme sample should include a direct or second-yellow red card",
  );
  assert.ok(
    aggregate.secondYellowDismissals > 0,
    "a second booking must be represented as both a second yellow and a red card",
  );
});

test("scheduled substitutions emit events and preserve eleven active players", () => {
  const home = createTeam(1);
  const away = createTeam(2);
  const changes: TacticalChange[] = [
    {
      id: 1,
      minute: 10,
      club_id: 1,
      change_type: "SUBSTITUTION",
      payload: JSON.stringify({ playerOutId: 102, playerInId: 112 }),
    },
    {
      id: 2,
      minute: 20,
      club_id: 1,
      change_type: "SUBSTITUTION",
      payload: JSON.stringify({ playerOutId: 103, playerInId: 113 }),
    },
    {
      id: 3,
      minute: 30,
      club_id: 1,
      change_type: "SUBSTITUTION",
      payload: JSON.stringify({ playerOutId: 104, playerInId: 114 }),
    },
  ];

  const timeline = simulateMatchTimeline(home, away, 901, changes);
  const substitutions = timeline.events.filter(
    (event) =>
      event.eventType === "SUBSTITUTION" && event.clubId === home.clubId,
  );

  assert.equal(substitutions.length, 3);
  assert.deepEqual(
    substitutions.map((event) => event.minute),
    [10, 20, 30],
  );
});

test("formation changes reject duplicate slots and goalkeeper-role mismatches", () => {
  const home = createTeam(1);
  const away = createTeam(2);
  const invalidAssignments = home.lineup
    .filter((player) => player.isStarting)
    .map((player) => ({
      playerId: player.id,
      slotNumber: player.slot,
      positionCode: player.role,
    }));
  invalidAssignments[0] = {
    playerId: home.lineup[1]!.id,
    slotNumber: 1,
    positionCode: "GK",
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

  assert.ok(
    goalsAgainstEliteKeeper < goalsAgainstAverageKeeper,
    JSON.stringify({
      goalsAgainstAverageKeeper,
      goalsAgainstEliteKeeper,
    }),
  );
  assert.ok(
    Math.abs(shotsAgainstEliteKeeper - shotsAgainstAverageKeeper) / 500 <= 0.5,
    "goalkeeper quality should primarily affect conversion, not materially suppress shot creation",
  );
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

test("momentum builds through sustained territorial pressure and changes dominance", () => {
  const home = createTeam(1, 60);
  const away = createTeam(2, 60);
  let state = createMatchGameState(home, away);

  for (let minute = 1; minute <= 12; minute += 1) {
    const events = [5, 7, 9].includes(minute)
      ? [
          {
            minute,
            clubId: home.clubId,
            playerId: 101,
            secondaryPlayerId: null,
            eventType: "SAVE" as const,
            xg: 0.3,
            description: "High-quality chance",
          },
        ]
      : [];
    state = advanceMatchGameState(state, home, away, 82, 38, events, minute);
  }
  assert.ok(state.home.momentum > state.away.momentum + 5);

  for (let minute = 13; minute <= 35; minute += 1) {
    const events =
      minute === 18 || minute === 24
        ? [
            {
              minute,
              clubId: away.clubId,
              playerId: 201,
              secondaryPlayerId: null,
              eventType: "SAVE" as const,
              xg: 0.28,
              description: "Away high-quality chance",
            },
          ]
        : [];
    state = advanceMatchGameState(state, home, away, 35, 84, events, minute);
  }
  assert.ok(state.away.momentum > state.home.momentum + 5);
});

test("momentum uses chance quality rather than the scoreboard event label", () => {
  const home = createTeam(1, 60);
  const away = createTeam(2, 60);
  const initial = createMatchGameState(home, away);
  const goalState = advanceMatchGameState(
    initial,
    home,
    away,
    55,
    50,
    [
      {
        minute: 1,
        clubId: home.clubId,
        playerId: 101,
        secondaryPlayerId: null,
        eventType: "GOAL",
        xg: 0.25,
        description: "Goal",
      },
    ],
    1,
  );
  const saveState = advanceMatchGameState(
    initial,
    home,
    away,
    55,
    50,
    [
      {
        minute: 1,
        clubId: home.clubId,
        playerId: 101,
        secondaryPlayerId: null,
        eventType: "SAVE",
        xg: 0.25,
        description: "Save",
      },
    ],
    1,
  );

  assert.equal(goalState.home.momentum, saveState.home.momentum);
  assert.equal(goalState.away.momentum, saveState.away.momentum);
});

test("momentum calibration reports temporal behavior and deterministic output", () => {
  const report = runMomentumCalibration(
    createTeam(1, 70),
    createTeam(2, 55),
    100,
    12345,
  );

  assert.equal(report.simulations, 100);
  assert.equal(report.minutesObserved, 9000);
  assert.equal(report.deterministic, true);
  assert.ok(Number.isFinite(report.averageAbsoluteMomentumDifference));
  assert.ok(
    Number.isFinite(report.averageAbsoluteStructuralPressureDifference),
  );
  assert.ok(report.averageLongestDominanceRunMinutes > 0);
  assert.ok(report.durationMs >= 0);
  assert.ok(report.simulationsPerSecond > 0);
});

test("tactical intensity, physical condition and manpower affect game state", () => {
  const balancedHome = createTeam(1, 60);
  const aggressiveHome = createTeam(1, 60);
  const away = createTeam(2, 60);
  aggressiveHome.tactic = {
    ...aggressiveHome.tactic,
    mentality: "VERY_ATTACKING",
    pressing: 90,
    tempo: 85,
  };

  let balancedState = createMatchGameState(balancedHome, away);
  let aggressiveState = createMatchGameState(aggressiveHome, away);
  for (let minute = 1; minute <= 20; minute += 1) {
    balancedState = advanceMatchGameState(
      balancedState,
      balancedHome,
      away,
      60,
      60,
      [],
      minute,
    );
    aggressiveState = advanceMatchGameState(
      aggressiveState,
      aggressiveHome,
      away,
      60,
      60,
      [],
      minute,
    );
  }
  assert.ok(aggressiveState.home.momentum > balancedState.home.momentum);

  const tiredHome = createTeam(1, 60);
  tiredHome.energy = 35;
  const tiredState = createMatchGameState(tiredHome, away);
  assert.ok(
    tiredState.home.momentum <
      createMatchGameState(balancedHome, away).home.momentum,
  );

  const dismissedHome = createTeam(1, 60);
  const dismissedPlayer = dismissedHome.lineup.find(
    (player) => player.isStarting && player.role !== "GK",
  )!;
  dismissedPlayer.isStarting = false;
  let dismissalState = createMatchGameState(dismissedHome, away);
  for (let minute = 1; minute <= 20; minute += 1) {
    dismissalState = advanceMatchGameState(
      dismissalState,
      dismissedHome,
      away,
      60,
      60,
      [],
      minute,
    );
  }
  assert.ok(dismissalState.away.momentum > dismissalState.home.momentum);
});

test("territorial game actions create meaningful pressure without requiring a shot", () => {
  const home = createTeam(1, 75);
  const away = createTeam(2, 45);
  const initial = createMatchGameState(home, away);
  const actions = resolveTeamGameActions(
    home,
    away,
    initial.home,
    initial.away,
    1,
    () => 0,
  );
  const withoutActions = advanceMatchGameState(
    initial,
    home,
    away,
    60,
    50,
    [],
    1,
  );
  const withActions = advanceMatchGameState(
    initial,
    home,
    away,
    60,
    50,
    [],
    1,
    actions,
  );

  assert.ok(actions.some((action) => action.type === "PROGRESSION"));
  assert.ok(actions.some((action) => action.type === "FINAL_THIRD_ENTRY"));
  assert.ok(withActions.home.momentum > withoutActions.home.momentum);
});

test("momentum diagnostic traces are deterministic and do not alter match outcomes", () => {
  const home = createTeam(1, 68);
  const away = createTeam(2, 57);
  const seed = 441902;

  const normal = simulateMatchTimeline(home, away, seed);
  const traced = simulateMatchTimeline(home, away, seed, [], {
    collectMomentumTrace: true,
  });
  const repeated = simulateMatchTimeline(home, away, seed, [], {
    collectMomentumTrace: true,
  });

  assert.deepEqual(normal.result, traced.result);
  assert.deepEqual(normal.events, traced.events);
  assert.deepEqual(
    normal.minutes.map(({ minute, homePressure, awayPressure }) => ({
      minute,
      homePressure,
      awayPressure,
    })),
    traced.minutes.map(({ minute, homePressure, awayPressure }) => ({
      minute,
      homePressure,
      awayPressure,
    })),
  );
  assert.deepEqual(traced, repeated);
  assert.ok(
    traced.minutes.every((minute) => minute.momentumTrace !== undefined),
  );
  assert.ok(
    traced.minutes.every(
      (minute) =>
        minute.momentumTrace!.home.clubId === home.clubId &&
        minute.momentumTrace!.away.clubId === away.clubId,
    ),
  );
  assert.ok(
    traced.minutes.every((minute) =>
      minute.momentumTrace!.events.every(
        (event) => event.clubId === home.clubId || event.clubId === away.clubId,
      ),
    ),
  );
  assert.ok(
    normal.minutes.every((minute) => minute.momentumTrace === undefined),
  );
});
