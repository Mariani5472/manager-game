export interface ParticipantRow {
  club_id: number;
  group_id: number;
  seed: number | null;
}


export function roundRobin(
  teams: ParticipantRow[],
  legs: number
): Array<Array<{
  home: number;
  away: number;
}>> {
  if (teams.length < 2) {
    throw new Error(
      "A league needs at least two participants."
    );
  }

  if (
    !Number.isSafeInteger(legs) ||
    legs < 1
  ) {
    throw new Error(
      "League legs must be a positive integer."
    );
  }


  const rotating = teams.map(
    t => t.club_id
  );

  if (rotating.length % 2) {
    rotating.push(-1);
  }


  const n = rotating.length;

  const rounds: Array<
    Array<{
      home: number;
      away: number;
    }>
  > = [];


  for (let r = 0; r < n - 1; r++) {
    const matches: Array<{
      home: number;
      away: number;
    }> = [];


    for (let i = 0; i < n / 2; i++) {
      let home = rotating[i]!;
      let away = rotating[n - 1 - i]!;


      if (
        home === -1 ||
        away === -1
      ) {
        continue;
      }


      if ((r + i) % 2) {
        [home, away] = [away, home];
      }


      matches.push({
        home,
        away,
      });
    }


    rounds.push(matches);


    const fixed = rotating[0]!;
    const rest = rotating.slice(1);

    rest.unshift(
      rest.pop()!
    );

    rotating.splice(
      0,
      rotating.length,
      fixed,
      ...rest
    );
  }


  const first = rounds;
  const all = [...first];


  for (let leg = 1; leg < legs; leg++) {
    all.push(
      ...first.map(
        matches =>
          matches.map(
            m => ({
              home: m.away,
              away: m.home,
            })
          )
      )
    );
  }


  return all;
}