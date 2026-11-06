'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Pause, Play, Radio, RotateCcw, Shield, Timer, Zap } from 'lucide-react';
import type { MatchCenterResponse, MatchLineupPlayerDto, MatchPreparationResponse } from '@shared/index';
import { gameApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import styles from './match-section.module.css';

function formatKickoff(value: string | null): string {
  if (!value) return 'Kick-off time not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function LineupList({
  title, players, managed, selectedIds, onReplace,
}: {
  title: string;
  players: MatchLineupPlayerDto[];
  managed: boolean;
  selectedIds: number[];
  onReplace?: (slot: number, playerId: number) => void;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className={styles.lineupList}>
        {players.filter(player => player.isStarting).map((player, index) => {
          const selectedId = selectedIds[index] ?? player.playerId;
          const selectedPlayer = players.find(option => option.playerId === selectedId) ?? player;
          return (
            <div className={styles.lineupRow} key={player.slot}>
              <span className={styles.slot}>{player.position}</span>
              <span className={styles.playerName}>{selectedPlayer.name}</span>
              <span className={styles.playerCondition}>{Math.round(selectedPlayer.energy)}% energy</span>
              {managed && onReplace ? (
                <select aria-label={`Replace ${player.name}`} value={selectedId}
                  onChange={event => onReplace(index, Number(event.target.value))}>
                  {players.map(option => <option key={option.playerId} value={option.playerId}>{option.name}</option>)}
                </select>
              ) : <Badge variant="default">{player.position}</Badge>}
            </div>
          );
        })}
        <div className={styles.benchLabel}>SUBSTITUTES</div>
        {players.filter(player => managed ? !selectedIds.includes(player.playerId) : !player.isStarting).map(player => (
          <div className={styles.benchRow} key={player.playerId}>
            <span>{player.name}</span><span>{player.position} · {Math.round(player.energy)}%</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PreparationView({ saveId, fixtureId, onBack, onKickOff }: {
  saveId: string; fixtureId: number; onBack: () => void; onKickOff: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['match-preparation', saveId, fixtureId];
  const preparation = useQuery({
    queryKey,
    queryFn: () => gameApi.matchPreparation(saveId, fixtureId),
  });
  const [starterIds, setStarterIds] = useState<number[]>([]);
  const [benchIds, setBenchIds] = useState<number[]>([]);
  useEffect(() => {
    if (!preparation.data) return;
    const managed = preparation.data.managedClubIsHome ? preparation.data.homeLineup : preparation.data.awayLineup;
    setStarterIds(managed.filter(player => player.isStarting).map(player => player.playerId));
    setBenchIds(managed.filter(player => !player.isStarting).map(player => player.playerId));
  }, [preparation.data]);
  const saveLineup = useMutation({
    mutationFn: () => gameApi.saveMatchLineup(saveId, fixtureId, { starterIds, benchIds }),
    onSuccess: data => queryClient.setQueryData(queryKey, data),
  });
  if (preparation.isLoading) return <p className={styles.loading}>Loading match preparation…</p>;
  if (preparation.isError || !preparation.data) return <p className={styles.error}>{preparation.error?.message ?? 'Unable to load match preparation.'}</p>;
  const data = preparation.data;
  const managedPlayers = data.managedClubIsHome ? data.homeLineup : data.awayLineup;
  const opponentPlayers = data.managedClubIsHome ? data.awayLineup : data.homeLineup;
  const managedTeam = data.managedClubIsHome ? data.fixture.home : data.fixture.away;
  const opponentTeam = data.managedClubIsHome ? data.fixture.away : data.fixture.home;
  const swapStarter = (slot: number, playerId: number) => {
    const previous = starterIds[slot];
    if (previous === playerId) return;
    const replacementIndex = starterIds.indexOf(playerId);
    const next = [...starterIds];
    next[slot] = playerId;
    if (replacementIndex >= 0) next[replacementIndex] = previous!;
    setStarterIds(next);
    setBenchIds(current => {
      const without = current.filter(id => id !== playerId && id !== previous);
      if (replacementIndex < 0 && previous !== undefined) without.push(previous);
      return without.slice(0, 7);
    });
  };
  return (
    <div className={styles.stack}>
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>MATCH DAY</span><h1>Match preparation</h1><p>Confirm your starting eleven before kick-off.</p></div>
        <Button variant="ghost" onClick={onBack}><RotateCcw size={15}/> Back to calendar</Button>
      </div>
      <Card className={styles.fixtureBanner}>
        <div><span>{data.fixture.competition} · {data.fixture.stage}</span><h2>{data.fixture.home.name} <b>vs</b> {data.fixture.away.name}</h2><p>{formatKickoff(data.fixture.scheduledAt)} · {data.fixture.round}</p></div>
        <Badge variant="info">{data.fixture.status.replaceAll('_', ' ')}</Badge>
      </Card>
      <div className={styles.prepGrid}>
        <div className={styles.stack}>
          <div className={styles.sectionTitle}><Shield size={16}/> YOUR SQUAD · {managedTeam.name}</div>
          <LineupList title={`Starting XI · ${starterIds.length}/11`} players={managedPlayers} managed selectedIds={starterIds} onReplace={swapStarter}/>
          <Card><CardHeader><CardTitle>Selection notes</CardTitle></CardHeader><CardContent className={styles.notes}>Use the selectors to exchange starters with substitutes. Position order follows the club's saved formation. Injured and suspended players are excluded by the backend.</CardContent></Card>
        </div>
        <div className={styles.stack}>
          <div className={styles.sectionTitle}><Shield size={16}/> OPPONENT · {opponentTeam.name}</div>
          <LineupList title="Predicted starting XI" players={opponentPlayers} managed={false} selectedIds={[]}/>
          <Card><CardHeader><CardTitle>Match conditions</CardTitle></CardHeader><CardContent className={styles.notes}>Weather, pitch condition, travel and rest are resolved from the saved fixture context when the match starts.</CardContent></Card>
        </div>
      </div>
      <div className={styles.actionBar}>
        {saveLineup.isError && <p className={styles.error}>{saveLineup.error.message}</p>}
        <Button variant="secondary" disabled={saveLineup.isPending || starterIds.length !== 11} onClick={() => saveLineup.mutate()}>
          {saveLineup.isPending ? 'Saving…' : 'Save lineup'}
        </Button>
        <Button disabled={starterIds.length !== 11 || saveLineup.isPending} onClick={async () => {
          try { await saveLineup.mutateAsync(); onKickOff(); } catch { /* mutation error is rendered above */ }
        }}>Continue to match centre <Play size={15}/></Button>
      </div>
    </div>
  );
}

function MomentumChart({ data }: { data: MatchCenterResponse['momentum'] }) {
  const home = data.map((point, index) => `${data.length < 2 ? 450 : (index / (data.length - 1)) * 900},${112 - point.homePressure * 0.92}`).join(' ');
  const away = data.map((point, index) => `${data.length < 2 ? 450 : (index / (data.length - 1)) * 900},${112 + point.awayPressure * 0.92}`).join(' ');
  return (
    <div className={styles.momentum}>
      <div className={styles.momentumLegend}><span><i className={styles.homeDot}/> Home pressure</span><span><i className={styles.awayDot}/> Away pressure</span></div>
      <svg viewBox="0 0 900 224" role="img" aria-label="Match momentum chart showing home and away attacking pressure">
        <line x1="0" y1="112" x2="900" y2="112" className={styles.axis}/>
        {[0,30,60,90].map(minute => <g key={minute}><line x1={minute/90*900} y1="0" x2={minute/90*900} y2="224" className={styles.gridLine}/><text x={minute/90*900+4} y="218" className={styles.axisLabel}>{minute}'</text></g>)}
        {data.length > 0 && <><polyline points={home} className={styles.homeLine}/><polyline points={away} className={styles.awayLine}/></>}
      </svg>
      {!data.length && <p className={styles.chartEmpty}>Momentum will build as the match progresses.</p>}
    </div>
  );
}

export function MatchSection({ saveId, fixtureId, onBack }: { saveId: string; fixtureId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = ['match-center', saveId, fixtureId];
  const center = useQuery({ queryKey, queryFn: () => gameApi.matchCenter(saveId, fixtureId), refetchInterval: false });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const advance = useMutation({
    mutationFn: (minute: number) => gameApi.advanceMatch(saveId, fixtureId, minute),
    onSuccess: data => {
      queryClient.setQueryData(queryKey, data);
      if (data.fixture.status === 'COMPLETED') setPlaying(false);
    },
    onError: () => setPlaying(false),
  });
  const currentMinute = center.data?.fixture.currentMinute ?? 0;
  useEffect(() => {
    if (!playing || !center.data || center.data.fixture.status === 'COMPLETED' || advance.isPending) return;
    const interval = window.setInterval(() => {
      const nextMinute = Math.min(90, currentMinute + 1);
      advance.mutate(nextMinute);
    }, Math.max(150, 1000 / speed));
    return () => window.clearInterval(interval);
  }, [playing, center.data, currentMinute, speed, advance.isPending]);
  const latestEvent = useMemo(() => center.data?.events.filter(event => event.minute > 0).at(-1), [center.data?.events]);
  if (center.isLoading) return <p className={styles.loading}>Opening match centre…</p>;
  if (center.isError || !center.data) return <p className={styles.error}>{center.error?.message ?? 'Unable to load match centre.'}</p>;
  const data = center.data;
  const home = data.teams[0], away = data.teams[1];
  const isFinished = data.fixture.status === 'COMPLETED';
  const stats = [
    ['Shots', data.statistics.home.shots, data.statistics.away.shots],
    ['On target', data.statistics.home.shotsOnTarget, data.statistics.away.shotsOnTarget],
    ['Expected goals', data.statistics.home.expectedGoals.toFixed(2), data.statistics.away.expectedGoals.toFixed(2)],
    ['Fouls', data.statistics.home.fouls, data.statistics.away.fouls],
    ['Yellow cards', data.statistics.home.yellowCards, data.statistics.away.yellowCards],
    ['Red cards', data.statistics.home.redCards, data.statistics.away.redCards],
    ['Substitutions', data.statistics.home.substitutions, data.statistics.away.substitutions],
    ['Injuries', data.statistics.home.injuries, data.statistics.away.injuries],
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>LIVE MATCH ENGINE</span><h1>Match centre</h1><p>{data.fixture.competition} · {data.fixture.stage} · {data.fixture.round}</p></div>
        <Button variant="ghost" onClick={onBack}><RotateCcw size={15}/> Calendar</Button>
      </div>
      <Card className={styles.scoreboard}>
        <div className={styles.teamScore}><span className={styles.crest}>{home.name.slice(0,1)}</span><strong>{home.name}</strong><small>HOME</small></div>
        <div className={styles.scoreBlock}><span className={styles.matchMinute}>{isFinished ? 'FULL TIME' : data.fixture.status === 'IN_PROGRESS' ? `${currentMinute}'` : 'KICK-OFF'}</span><strong>{data.fixture.score.home} : {data.fixture.score.away}</strong><Badge variant={isFinished ? 'success' : 'info'}>{isFinished ? 'Completed' : playing ? 'Live' : 'Paused'}</Badge></div>
        <div className={styles.teamScore}><span className={styles.crest}>{away.name.slice(0,1)}</span><strong>{away.name}</strong><small>AWAY</small></div>
      </Card>
      <Card>
        <CardHeader className={styles.controlHeader}><CardTitle><Radio size={16}/> Match playback</CardTitle><div className={styles.speedControls} aria-label="Playback speed">
          {([1,2,4] as const).map(value => <Button key={value} size="sm" variant={speed===value?'secondary':'ghost'} aria-pressed={speed===value} onClick={()=>setSpeed(value)}>{value}x</Button>)}
        </div></CardHeader>
        <CardContent className={styles.playback}>
          <div className={styles.playActions}>
            <Button disabled={isFinished || advance.isPending} onClick={()=>setPlaying(value=>!value)}>{playing ? <><Pause size={15}/> Pause</> : <><Play size={15}/> {currentMinute ? 'Resume' : 'Start match'}</>}</Button>
            <span><Timer size={14}/> {currentMinute} / 90 min</span>
          </div>
          <div className={styles.progress}><span style={{width:`${currentMinute/90*100}%`}}/></div>
          {advance.isError && <p className={styles.error}>{advance.error.message}</p>}
        </CardContent>
      </Card>
      <div className={styles.centerGrid}>
        <Card><CardHeader><CardTitle><Activity size={16}/> Match momentum</CardTitle></CardHeader><CardContent><MomentumChart data={data.momentum}/></CardContent></Card>
        <Card><CardHeader><CardTitle>Match statistics</CardTitle></CardHeader><CardContent className={styles.stats}>
          <div className={styles.statTeams}><span>{home.name}</span><span>STAT</span><span>{away.name}</span></div>
          {stats.map(([label,h,a])=><div className={styles.statRow} key={label}><strong>{h}</strong><span>{label}</span><strong>{a}</strong></div>)}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle><Zap size={16}/> Commentary</CardTitle></CardHeader><CardContent className={styles.commentary}>
        {latestEvent ? <div className={styles.latestCommentary}><Badge variant="info">{latestEvent.minute}'</Badge><p>{latestEvent.description ?? latestEvent.type.replaceAll('_',' ')}</p></div> : <p className={styles.chartEmpty}>The referee is ready. Start the match to receive live commentary.</p>}
        <div className={styles.eventList}>{[...data.events].reverse().filter(event=>event.minute>0).slice(0,12).map(event=><div key={event.id}><time>{event.minute}'</time><span>{event.description ?? event.type.replaceAll('_',' ')}</span></div>)}</div>
      </CardContent></Card>
    </div>
  );
}

export function MatchSectionRouter({ saveId, fixtureId, mode, onBack, onKickOff }: {
  saveId:string;fixtureId:number;mode:'preparation'|'center';onBack:()=>void;onKickOff:()=>void;
}) {
  return mode === 'preparation'
    ? <PreparationView saveId={saveId} fixtureId={fixtureId} onBack={onBack} onKickOff={onKickOff}/>
    : <MatchSection saveId={saveId} fixtureId={fixtureId} onBack={onBack}/>;
}
