export interface GeneratedFixture {
  home: number;
  away: number;
}

export type GeneratedRound = GeneratedFixture[];

export function roundRobin(ids: number[], legs: number): GeneratedRound[] {
  const teams = [...ids];

  if (teams.length % 2) {
    teams.push(-1);
  }

  const rounds: GeneratedRound[] = [];

  for (let leg = 0; leg < legs; leg++) {
    const rotating = [...teams];

    for (let round = 0; round < rotating.length - 1; round++) {
      const fixtures: GeneratedRound = [];

      for (let i = 0; i < rotating.length / 2; i++) {
        const a = rotating[i]!;
        const b = rotating[rotating.length - 1 - i]!;

        if (a !== -1 && b !== -1) {
          fixtures.push(
            (round + leg) % 2 === 0
              ? {
                  home: a,
                  away: b,
                }
              : {
                  home: b,
                  away: a,
                },
          );
        }
      }

      rounds.push(fixtures);

      const fixed = rotating[0]!;
      const rest = rotating.slice(1);

      rest.unshift(rest.pop()!);

      rotating.splice(0, rotating.length, fixed, ...rest);
    }
  }

  return rounds;
}
