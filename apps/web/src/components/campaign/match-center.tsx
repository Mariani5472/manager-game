'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Pause, Play, Radio, RotateCcw, SkipForward, Timer, Zap } from 'lucide-react';
import type { MatchCenterResponse, MatchTacticalChangeRequest } from '@shared/index';
import { gameApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineupList } from './lineup-list';
import { MatchHeader, MatchMomentum, MatchTimeline } from './match-presentation';
import styles from './match-section.module.css';
import { Badge } from '@/components/ui/badge';
function MomentumChart({ data }: { data: MatchCenterResponse['momentum'] }) {
  const home = data
    .map((point) => `${(point.minute / 90) * 900},${112 - point.homePressure * 0.92}`)
    .join(' ');
  const away = data
    .map((point) => `${(point.minute / 90) * 900},${112 + point.awayPressure * 0.92}`)
    .join(' ');
  return (
    <div className={styles.momentum}>
      <div className={styles.momentumLegend}>
        <span>
          <i className={styles.homeDot} /> Home pressure
        </span>
        <span>
          <i className={styles.awayDot} /> Away pressure
        </span>
      </div>
      <svg
        viewBox="0 0 900 224"
        role="img"
        aria-label="Match momentum chart showing home and away attacking pressure"
      >
        <line x1="0" y1="112" x2="900" y2="112" className={styles.axis} />
        {[0, 30, 60, 90].map((minute) => (
          <g key={minute}>
            <line
              x1={(minute / 90) * 900}
              y1="0"
              x2={(minute / 90) * 900}
              y2="224"
              className={styles.gridLine}
            />
            <text x={(minute / 90) * 900 + 4} y="218" className={styles.axisLabel}>
              {minute}&apos;
            </text>
          </g>
        ))}
        {data.length > 0 && (
          <>
            <polyline points={home} className={styles.homeLine} />
            <polyline points={away} className={styles.awayLine} />
          </>
        )}
      </svg>
      {!data.length && (
        <p className={styles.chartEmpty}>Momentum will build as the match progresses.</p>
      )}
    </div>
  );
}

export function MatchCenter({
  saveId,
  fixtureId,
  onBack,
}: {
  saveId: string;
  fixtureId: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['match-center', saveId, fixtureId];
  const center = useQuery({
    queryKey,
    queryFn: async () => {
      const match = await gameApi.matchCenter(saveId, fixtureId);
      return match.fixture.status === 'COMPLETED' ? gameApi.matchHistory(saveId, fixtureId) : match;
    },
    refetchInterval: false,
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [mentality, setMentality] =
    useState<Extract<MatchTacticalChangeRequest, { type: 'MENTALITY' }>['mentality']>('BALANCED');
  const [instructionKey, setInstructionKey] =
    useState<Extract<MatchTacticalChangeRequest, { type: 'INSTRUCTION' }>['key']>('pressing');
  const [instructionValue, setInstructionValue] = useState(65);
  const [playerOutId, setPlayerOutId] = useState<number | null>(null);
  const [playerInId, setPlayerInId] = useState<number | null>(null);
  const [formationId, setFormationId] = useState<number | null>(null);
  // A ref closes the interval race: state updates from React are asynchronous,
  // while a timer callback can otherwise enqueue another advance immediately.
  const advanceInFlight = useRef(false);
  const decisionInFlight = useRef(false);
  const advance = useMutation({
    mutationFn: (minute: number) => gameApi.advanceMatch(saveId, fixtureId, minute),
    onSuccess: async (data) => {
      if (data.fixture.status === 'COMPLETED') {
        setPlaying(false);
        const history = await gameApi.matchHistory(saveId, fixtureId);
        queryClient.setQueryData(queryKey, history);
        return;
      }
      queryClient.setQueryData(queryKey, data);
    },
    onSettled: () => {
      advanceInFlight.current = false;
    },
    onError: () => setPlaying(false),
  });
  const currentMinute = center.data?.fixture.currentMinute ?? 0;
  const advanceMatch = advance.mutate;
  useEffect(() => {
    if (!playing || !center.data || center.data.fixture.status === 'COMPLETED' || advance.isPending)
      return;
    const interval = window.setInterval(() => {
      // Advance a small batch per second. This keeps the playback rate intuitive
      // while avoiding four HTTP round-trips per second at 4x speed.
      if (advanceInFlight.current || decisionInFlight.current) return;
      const nextMinute = Math.min(90, currentMinute + speed);
      if (nextMinute <= currentMinute) {
        setPlaying(false);
        return;
      }
      advanceInFlight.current = true;
      advanceMatch(nextMinute);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [playing, center.data, currentMinute, speed, advance.isPending, advanceMatch]);
  const scheduleDecision = useMutation({
    mutationFn: (input: MatchTacticalChangeRequest) =>
      gameApi.scheduleTacticalChange(saveId, fixtureId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  if (center.isLoading) return <p className={styles.loading}>Opening match centre…</p>;
  if (center.isError || !center.data)
    return (
      <p className={styles.error}>{center.error?.message ?? 'Unable to load match centre.'}</p>
    );
  const data = center.data;
  const latestEvent = [...data.events]
    .filter((event) => event.minute > 0)
    .sort((a, b) => b.minute - a.minute || b.addedTime - a.addedTime || b.id - a.id)[0];
  const home = data.teams[0],
    away = data.teams[1];
  const isFinished = data.fixture.status === 'COMPLETED';
  const managedClubId = data.managedClubId;
  const userCanDecide = data.fixture.status !== 'COMPLETED';
  const managedLineup = data.teams.find((team) => team.clubId === managedClubId)?.lineup ?? [];
  const activePlayers = managedLineup.filter((player) => player.isStarting);
  const benchPlayers = managedLineup.filter((player) => !player.isStarting);
  const nextDecisionMinute = currentMinute + 1;
  const decisionBusy =
    advance.isPending ||
    scheduleDecision.isPending ||
    advanceInFlight.current ||
    decisionInFlight.current;

  const submitDecision = async (input: MatchTacticalChangeRequest) => {
    if (!userCanDecide || decisionBusy || nextDecisionMinute > 90) return;
    // Lock synchronously before React can tear down the playback interval.
    // This prevents a minute advance and a tactical decision racing each other.
    decisionInFlight.current = true;
    setPlaying(false);
    try {
      await scheduleDecision.mutateAsync({
        ...input,
        minute: nextDecisionMinute,
      } as MatchTacticalChangeRequest);
      setPlayerOutId(null);
      setPlayerInId(null);
    } catch {
      // The mutation error is displayed next to the decision controls.
    } finally {
      decisionInFlight.current = false;
    }
  };

  const playerName = (playerId: number) =>
    data.teams.flatMap((team) => team.lineup).find((player) => player.playerId === playerId)
      ?.name ?? `Player #${playerId}`;
  const stats = [
    ['Shots', data.statistics.home.shots, data.statistics.away.shots],
    ['On target', data.statistics.home.shotsOnTarget, data.statistics.away.shotsOnTarget],
    [
      'Expected goals',
      data.statistics.home.expectedGoals.toFixed(2),
      data.statistics.away.expectedGoals.toFixed(2),
    ],
    ['Fouls', data.statistics.home.fouls, data.statistics.away.fouls],
    ['Yellow cards', data.statistics.home.yellowCards, data.statistics.away.yellowCards],
    ['Red cards', data.statistics.home.redCards, data.statistics.away.redCards],
    ['Substitutions', data.statistics.home.substitutions, data.statistics.away.substitutions],
    ['Injuries', data.statistics.home.injuries, data.statistics.away.injuries],
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>LIVE MATCH ENGINE</span>
          <h1>Match centre</h1>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <RotateCcw size={15} /> Calendar
        </Button>
      </div>
      <MatchHeader
        fixture={data.fixture}
        teams={data.teams}
        events={data.events}
        isFinished={isFinished}
        isPlaying={playing}
        currentMinute={currentMinute}
      />
      {data.history && (
        <Card>
          <CardHeader>
            <CardTitle>Historical match record</CardTitle>
          </CardHeader>
          <CardContent className={styles.historyTactics}>
            <p>
              {data.history.isLegacy
                ? 'Reconstructed from a legacy checkpoint; kickoff details may be approximate.'
                : 'Kickoff snapshot preserved · Saved at full-time'}{' '}
              · Engine {data.history.engineVersion} · Seed {data.history.randomSeed}
            </p>
            <div>
              {[data.history.homeTactics, data.history.awayTactics].map((team) => (
                <section key={team.clubId}>
                  <strong>{team.clubName}</strong>
                  <span>
                    {team.tactic.formation_name} ·{' '}
                    {team.tactic.mentality.replaceAll('_', ' ').toLowerCase()}
                  </span>
                  <span>
                    Pressing {team.tactic.pressing} · Tempo {team.tactic.tempo} · Defensive line{' '}
                    {team.tactic.defensive_line}
                  </span>
                  <span>
                    Width {team.tactic.width} · Passing {team.tactic.passing_directness} · Counter
                    attack {team.tactic.counter_attack ? 'On' : 'Off'}
                  </span>
                </section>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className={styles.controlHeader}>
          <CardTitle>
            <Radio size={16} /> Match playback
          </CardTitle>
          <div className={styles.speedControls} aria-label="Playback speed">
            {([1, 2, 4] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={speed === value ? 'secondary' : 'ghost'}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
              >
                {value}x
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className={styles.playback}>
          <div className={styles.playActions}>
            <div className={styles.playButtons}>
              <Button
                disabled={isFinished || advance.isPending}
                onClick={() => setPlaying((value) => !value)}
              >
                {playing ? (
                  <>
                    <Pause size={15} /> Pause
                  </>
                ) : (
                  <>
                    <Play size={15} /> {currentMinute ? 'Resume' : 'Start match'}
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                disabled={isFinished || playing || advance.isPending || currentMinute >= 90}
                onClick={() => {
                  if (advanceInFlight.current) return;
                  advanceInFlight.current = true;
                  advance.mutate(Math.min(90, currentMinute + 1));
                }}
              >
                <SkipForward size={15} /> Next minute
              </Button>
            </div>
            <span>
              <Timer size={14} /> {currentMinute} / 90 min
            </span>
          </div>
          <p className={styles.speedHint}>
            Playback speed: {speed} match {speed === 1 ? 'minute' : 'minutes'} per update (about one
            second plus processing time). Playback pauses when this tab is hidden.
          </p>
          <div className={styles.progress}>
            <span style={{ width: `${(currentMinute / 90) * 100}%` }} />
          </div>
          {advance.isError && <p className={styles.error}>{advance.error.message}</p>}
        </CardContent>
      </Card>

      <MatchMomentum data={data.momentum} events={data.events} teams={data.teams} />
      <MatchTimeline events={data.events} teams={data.teams} />
      <Card>
        <CardHeader>
          <CardTitle>Match statistics</CardTitle>
        </CardHeader>
        <CardContent className={styles.stats}>
          <div className={styles.statTeams}>
            <span>{home.name}</span>
            <span>STAT</span>
            <span>{away.name}</span>
          </div>
          {stats.map(([label, h, a]) => (
            <div className={styles.statRow} key={label}>
              <strong>{h}</strong>
              <span>{label}</span>
              <strong>{a}</strong>
            </div>
          ))}
        </CardContent>
      </Card>
      {isFinished && data.playerStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Player performances</CardTitle>
          </CardHeader>
          <CardContent className={styles.playerMatchStats}>
            {data.teams.map((team) => (
              <section key={team.clubId}>
                <strong>{team.name}</strong>
                <div className={styles.playerMatchStatsHeader}>
                  <span>Player</span>
                  <span>MIN</span>
                  <span>RATING</span>
                  <span>G</span>
                  <span>A</span>
                  <span>YC</span>
                  <span>RC</span>
                </div>
                {data.playerStats
                  .filter((player) => player.clubId === team.clubId)
                  .map((player) => (
                    <div className={styles.playerMatchStatsRow} key={player.playerId}>
                      <span>
                        {playerName(player.playerId)}
                        {player.substitutedOut ? ' · Subbed' : ''}
                      </span>
                      <span>{player.minutesPlayed}</span>
                      <span>{player.rating.toFixed(1)}</span>
                      <span>{player.goals}</span>
                      <span>{player.assists}</span>
                      <span>{player.yellowCards}</span>
                      <span>{player.redCard ? '1' : '—'}</span>
                    </div>
                  ))}
              </section>
            ))}
          </CardContent>
        </Card>
      )}
      <div className={styles.centerGrid}>
        <LineupList
          title={`Home XI · ${home.name}`}
          players={home.lineup}
          managed={false}
          selectedIds={[]}
        />
        <LineupList
          title={`Away XI · ${away.name}`}
          players={away.lineup}
          managed={false}
          selectedIds={[]}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Manager decisions</CardTitle>
        </CardHeader>
        <CardContent className={styles.playback}>
          <p className={styles.speedHint}>
            Changes take effect from minute {nextDecisionMinute}. Pause the playback to make a
            decision; the current match minute is never modified retroactively.
          </p>
          <div className={styles.decisionGrid}>
            <section className={styles.decisionPanel}>
              <strong>Substitution</strong>
              <span className={styles.speedHint}>1. Choose the player leaving the pitch.</span>
              <div className={styles.choiceList}>
                {activePlayers.map((player) => (
                  <button
                    type="button"
                    key={player.playerId}
                    className={
                      playerOutId === player.playerId ? styles.choiceSelected : styles.choiceButton
                    }
                    aria-pressed={playerOutId === player.playerId}
                    disabled={!userCanDecide || decisionBusy}
                    onClick={() => {
                      setPlayerOutId(player.playerId);
                      setPlayerInId(null);
                    }}
                  >
                    <span>{player.name}</span>
                    <small>
                      {player.position} · {Math.round(player.energy)}% energy
                    </small>
                  </button>
                ))}
              </div>
              <span className={styles.speedHint}>2. Choose the substitute entering.</span>
              <div className={styles.choiceList}>
                {benchPlayers.map((player) => (
                  <button
                    type="button"
                    key={player.playerId}
                    className={
                      playerInId === player.playerId ? styles.choiceSelected : styles.choiceButton
                    }
                    aria-pressed={playerInId === player.playerId}
                    disabled={!userCanDecide || decisionBusy || playerOutId === null}
                    onClick={() => setPlayerInId(player.playerId)}
                  >
                    <span>{player.name}</span>
                    <small>
                      {player.position} · {Math.round(player.energy)}% energy
                    </small>
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={
                  !userCanDecide ||
                  decisionBusy ||
                  !playerOutId ||
                  !playerInId ||
                  nextDecisionMinute > 90
                }
                onClick={() =>
                  submitDecision({
                    minute: nextDecisionMinute,
                    type: 'SUBSTITUTION',
                    playerOutId: playerOutId!,
                    playerInId: playerInId!,
                  })
                }
              >
                Confirm substitution
              </Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Team mentality</strong>
              <div className={styles.optionGrid}>
                {(
                  [
                    ['VERY_DEFENSIVE', 'Very defensive'],
                    ['DEFENSIVE', 'Defensive'],
                    ['BALANCED', 'Balanced'],
                    ['ATTACKING', 'Attacking'],
                    ['VERY_ATTACKING', 'Very attacking'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={mentality === value ? styles.choiceSelected : styles.choiceButton}
                    aria-pressed={mentality === value}
                    disabled={!userCanDecide || decisionBusy}
                    onClick={() => setMentality(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={!userCanDecide || decisionBusy || nextDecisionMinute > 90}
                onClick={() =>
                  submitDecision({ minute: nextDecisionMinute, type: 'MENTALITY', mentality })
                }
              >
                Apply mentality
              </Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Tactical instruction</strong>
              <span className={styles.speedHint}>Choose an instruction to tune.</span>
              <div className={styles.optionGrid}>
                {(
                  [
                    ['pressing', 'Pressing'],
                    ['tempo', 'Tempo'],
                    ['defensive_line', 'Defensive line'],
                    ['width', 'Width'],
                    ['passing_directness', 'Passing'],
                    ['counter_attack', 'Counter attack'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={
                      instructionKey === value ? styles.choiceSelected : styles.choiceButton
                    }
                    aria-pressed={instructionKey === value}
                    disabled={!userCanDecide || decisionBusy}
                    onClick={() => {
                      setInstructionKey(value);
                      if (value === 'counter_attack') setInstructionValue(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {instructionKey === 'counter_attack' ? (
                <div className={styles.optionGrid}>
                  {(
                    [
                      ['0', 'Off'],
                      ['1', 'On'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={
                        instructionValue === Number(value)
                          ? styles.choiceSelected
                          : styles.choiceButton
                      }
                      aria-pressed={instructionValue === Number(value)}
                      disabled={!userCanDecide || decisionBusy}
                      onClick={() => setInstructionValue(Number(value))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <label className={styles.sliderField}>
                  <span>
                    {instructionKey.replaceAll('_', ' ')}: <b>{instructionValue}</b>
                  </span>
                  <input
                    aria-label="Instruction intensity"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={instructionValue}
                    disabled={!userCanDecide || decisionBusy}
                    onChange={(event) => setInstructionValue(Number(event.target.value))}
                  />
                  <span className={styles.sliderScale}>
                    <small>Lower</small>
                    <small>Higher</small>
                  </span>
                </label>
              )}
              <Button
                size="sm"
                disabled={!userCanDecide || decisionBusy || nextDecisionMinute > 90}
                onClick={() =>
                  submitDecision({
                    minute: nextDecisionMinute,
                    type: 'INSTRUCTION',
                    key: instructionKey,
                    value: instructionValue,
                  })
                }
              >
                Apply instruction
              </Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Formation</strong>
              <span className={styles.speedHint}>
                Choose one of the formations supported by your data package.
              </span>
              <div className={styles.optionGrid}>
                {data.formations.map((formation) => (
                  <button
                    type="button"
                    key={formation.id}
                    className={
                      formationId === formation.id ? styles.choiceSelected : styles.choiceButton
                    }
                    aria-pressed={formationId === formation.id}
                    disabled={!userCanDecide || decisionBusy}
                    onClick={() => setFormationId(formation.id)}
                  >
                    {formation.name}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={
                  !userCanDecide || decisionBusy || formationId === null || nextDecisionMinute > 90
                }
                onClick={() =>
                  submitDecision({
                    minute: nextDecisionMinute,
                    type: 'FORMATION',
                    formationId: formationId!,
                  })
                }
              >
                Change formation
              </Button>
            </section>
          </div>
          {scheduleDecision.isError && (
            <p className={styles.error}>{scheduleDecision.error.message}</p>
          )}
          {scheduleDecision.isSuccess && (
            <p className={styles.speedHint}>
              Decision #{scheduleDecision.data.changeId} scheduled for minute {nextDecisionMinute}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
