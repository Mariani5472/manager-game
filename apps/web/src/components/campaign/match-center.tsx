'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Pause, Play, Radio, RotateCcw, SkipForward, Timer, Zap } from 'lucide-react';
import type { MatchCenterResponse, MatchTacticalChangeRequest } from '@shared/index';
import { gameApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineupList } from './lineup-list';
import styles from './match-section.module.css';
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
    queryFn: () => gameApi.matchCenter(saveId, fixtureId),
    refetchInterval: false,
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [decisionMinute, setDecisionMinute] = useState(1);
  const [mentality, setMentality] = useState<Extract<MatchTacticalChangeRequest, { type: 'MENTALITY' }>['mentality']>('BALANCED');
  const [instructionKey, setInstructionKey] = useState<Extract<MatchTacticalChangeRequest, { type: 'INSTRUCTION' }>['key']>('pressing');
  const [instructionValue, setInstructionValue] = useState(65);
  const [playerOutId, setPlayerOutId] = useState<number | null>(null);
  const [playerInId, setPlayerInId] = useState<number | null>(null);
  const [formationId, setFormationId] = useState('');
  // A ref closes the interval race: state updates from React are asynchronous,
  // while a timer callback can otherwise enqueue another advance immediately.
  const advanceInFlight = useRef(false);
  const advance = useMutation({
    mutationFn: (minute: number) => gameApi.advanceMatch(saveId, fixtureId, minute),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      if (data.fixture.status === 'COMPLETED') setPlaying(false);
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
      if (advanceInFlight.current) return;
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
    mutationFn: (input: MatchTacticalChangeRequest) => gameApi.scheduleTacticalChange(saveId, fixtureId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const latestEvent = useMemo(
    () => center.data?.events.filter((event) => event.minute > 0).at(-1),
    [center.data?.events],
  );
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);
  useEffect(() => {
    setDecisionMinute((minute) => Math.max(currentMinute + 1, minute));
  }, [currentMinute]);
  if (center.isLoading) return <p className={styles.loading}>Opening match centre…</p>;
  if (center.isError || !center.data)
    return (
      <p className={styles.error}>{center.error?.message ?? 'Unable to load match centre.'}</p>
    );
  const data = center.data;
  const home = data.teams[0],
    away = data.teams[1];
  const isFinished = data.fixture.status === 'COMPLETED';
  const managedClubId = data.fixture.home.clubId === data.teams[0].clubId ? data.teams[0].clubId : data.teams[1].clubId;
  const userCanDecide = data.fixture.status !== 'COMPLETED';
  const managedLineup = data.teams.find((team) => team.clubId === managedClubId)?.lineup ?? [];
  const activePlayers = managedLineup.filter((player) => player.isStarting);
  const benchPlayers = managedLineup.filter((player) => !player.isStarting);
  const nextDecisionMinute = Math.max(currentMinute + 1, decisionMinute);
  

  const submitDecision = async (input: MatchTacticalChangeRequest) => {
    setPlaying(false);
    try {
      await scheduleDecision.mutateAsync({ ...input, minute: nextDecisionMinute } as MatchTacticalChangeRequest);
      setDecisionMinute(nextDecisionMinute + 1);
      setPlayerOutId(null);
      setPlayerInId(null);
    } catch {
      // The mutation error is displayed next to the decision controls.
    }
  };

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
          <p>
            {data.fixture.competition} · {data.fixture.stage} · {data.fixture.round}
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <RotateCcw size={15} /> Calendar
        </Button>
      </div>
      <Card className={styles.scoreboard}>
        <div className={styles.teamScore}>
          <span className={styles.crest}>{home.name.slice(0, 1)}</span>
          <strong>{home.name}</strong>
          <small>HOME</small>
        </div>
        <div className={styles.scoreBlock}>
          <span className={styles.matchMinute}>
            {isFinished
              ? 'FULL TIME'
              : data.fixture.status === 'IN_PROGRESS'
                ? `${currentMinute}'`
                : 'KICK-OFF'}
          </span>
          <strong>
            {data.fixture.score.home} : {data.fixture.score.away}
          </strong>
          <Badge variant={isFinished ? 'success' : 'info'}>
            {isFinished ? 'Completed' : playing ? 'Live' : 'Paused'}
          </Badge>
        </div>
        <div className={styles.teamScore}>
          <span className={styles.crest}>{away.name.slice(0, 1)}</span>
          <strong>{away.name}</strong>
          <small>AWAY</small>
        </div>
      </Card>
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
      <Card>
        <CardHeader>
          <CardTitle>Manager decisions</CardTitle>
        </CardHeader>
        <CardContent className={styles.playback}>
          <p className={styles.speedHint}>Decisions are applied at the selected future minute and affect the simulation from that point onward.</p>
          <label className={styles.decisionField}>
            Apply at minute
            <input aria-label="Decision minute" type="number" min={currentMinute + 1} max="90" value={nextDecisionMinute} onChange={(event) => setDecisionMinute(Math.max(currentMinute + 1, Number(event.target.value) || currentMinute + 1))} />
          </label>
          <div className={styles.decisionGrid}>
            <section className={styles.decisionPanel}>
              <strong>Substitution</strong>
              <select aria-label="Player to substitute" value={playerOutId ?? ''} onChange={(event) => setPlayerOutId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Outgoing starter</option>
                {activePlayers.map((player) => <option key={player.playerId} value={player.playerId}>{player.name} · {player.position}</option>)}
              </select>
              <select aria-label="Substitute player" value={playerInId ?? ''} onChange={(event) => setPlayerInId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Incoming substitute</option>
                {benchPlayers.map((player) => <option key={player.playerId} value={player.playerId}>{player.name} · {player.position}</option>)}
              </select>
              <Button size="sm" disabled={!userCanDecide || !playerOutId || !playerInId || scheduleDecision.isPending || nextDecisionMinute > 90} onClick={() => submitDecision({ minute: nextDecisionMinute, type: 'SUBSTITUTION', playerOutId: playerOutId!, playerInId: playerInId! })}>Schedule substitution</Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Mentality</strong>
              <select aria-label="Team mentality" value={mentality} onChange={(event) => setMentality(event.target.value as typeof mentality)}>
                <option value="VERY_DEFENSIVE">Very defensive</option><option value="DEFENSIVE">Defensive</option><option value="BALANCED">Balanced</option><option value="ATTACKING">Attacking</option><option value="VERY_ATTACKING">Very attacking</option>
              </select>
              <Button size="sm" disabled={!userCanDecide || scheduleDecision.isPending || nextDecisionMinute > 90} onClick={() => submitDecision({ minute: nextDecisionMinute, type: 'MENTALITY', mentality })}>Change mentality</Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Tactical instruction</strong>
              <select aria-label="Instruction" value={instructionKey} onChange={(event) => setInstructionKey(event.target.value as typeof instructionKey)}>
                <option value="pressing">Pressing</option><option value="tempo">Tempo</option><option value="defensive_line">Defensive line</option><option value="width">Width</option><option value="passing_directness">Passing directness</option><option value="counter_attack">Counter attack</option>
              </select>
              <input aria-label="Instruction value" type="number" min="0" max={instructionKey === 'counter_attack' ? 1 : 100} value={instructionValue} onChange={(event) => setInstructionValue(Number(event.target.value))} />
              <Button size="sm" disabled={!userCanDecide || scheduleDecision.isPending || nextDecisionMinute > 90 || instructionValue < 0 || instructionValue > (instructionKey === 'counter_attack' ? 1 : 100)} onClick={() => submitDecision({ minute: nextDecisionMinute, type: 'INSTRUCTION', key: instructionKey, value: instructionValue })}>Apply instruction</Button>
            </section>
            <section className={styles.decisionPanel}>
              <strong>Formation</strong>
              <input aria-label="Formation id" inputMode="numeric" placeholder="Formation id" value={formationId} onChange={(event) => setFormationId(event.target.value.replace(/[^0-9]/g, ''))} />
              <Button size="sm" disabled={!userCanDecide || !formationId || scheduleDecision.isPending || nextDecisionMinute > 90} onClick={() => submitDecision({ minute: nextDecisionMinute, type: 'FORMATION', formationId: Number(formationId) })}>Change formation</Button>
            </section>
          </div>
          {scheduleDecision.isError && <p className={styles.error}>{scheduleDecision.error.message}</p>}
          {scheduleDecision.isSuccess && <p className={styles.speedHint}>Decision #{scheduleDecision.data.changeId} scheduled for minute {nextDecisionMinute}.</p>}
        </CardContent>
      </Card>
      <div className={styles.centerGrid}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Activity size={16} /> Match momentum
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MomentumChart data={data.momentum} />
          </CardContent>
        </Card>
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
      </div>
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
          <CardTitle>
            <Zap size={16} /> Live commentary
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.commentary}>
          {latestEvent ? (
            <div className={styles.latestCommentary} aria-live="polite" aria-atomic="true">
              <Badge variant="info">{latestEvent.minute}&apos;</Badge>
              <p>{latestEvent.description ?? latestEvent.type.replaceAll('_', ' ')}</p>
            </div>
          ) : (
            <p className={styles.chartEmpty}>
              The referee is ready. Start the match to receive live commentary.
            </p>
          )}
          <div
            className={styles.eventList}
            role="log"
            aria-label="Match event commentary"
            aria-live="polite"
          >
            {[...data.events]
              .reverse()
              .filter((event) => event.minute > 0)
              .slice(0, 16)
              .map((event) => (
                <div key={event.id}>
                  <time>{event.minute}&apos;</time>
                  <span>
                    <b>{event.type.replaceAll('_', ' ')}</b>
                    {event.description ? ` · ${event.description}` : ''}
                  </span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
