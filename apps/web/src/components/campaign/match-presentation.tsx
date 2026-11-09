'use client';

import { useId } from 'react';
import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MatchCenterResponse, MatchEventDto, MatchEventType } from '@shared/index';
import styles from './match-section.module.css';

type MatchTeams = MatchCenterResponse['teams'];
type MatchFixture = MatchCenterResponse['fixture'];

function formatMinute(minute: number, addedTime: number): string {
  return addedTime > 0 ? `${minute}+${addedTime}'` : `${minute}'`;
}

function formatScheduledAt(value: string | null): string {
  if (!value) return 'Date to be confirmed';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be confirmed';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getEventIcon(type: MatchEventType): string {
  const icons: Partial<Record<MatchEventType, string>> = {
    GOAL: '⚽',
    OWN_GOAL: '⚽',
    PENALTY_GOAL: '⚽',
    PENALTY: '⚽',
    PENALTY_MISS: '❌',
    YELLOW_CARD: '🟨',
    RED_CARD: '🟥',
    SUBSTITUTION: '🔄',
    SHOT: '◉',
    SHOT_ON_TARGET: '🎯',
    SAVE: '🧤',
    MISS: '↗',
    BLOCK: '🛡',
    CORNER: '🚩',
    FOUL: '⚑',
    OFFSIDE: '⚐',
    INJURY: '✚',
    CHANCE: '⚡',
    TACTIC_CHANGE: '📋',
    KICK_OFF: '▶',
  };

  return icons[type] ?? '•';
}

function getEventLabel(type: MatchEventType): string {
  const labels: Partial<Record<MatchEventType, string>> = {
    GOAL: 'Goal',
    OWN_GOAL: 'Own goal',
    PENALTY_GOAL: 'Penalty scored',
    PENALTY: 'Penalty',
    PENALTY_MISS: 'Penalty missed',
    YELLOW_CARD: 'Yellow card',
    RED_CARD: 'Red card',
    SUBSTITUTION: 'Substitution',
    SHOT: 'Shot',
    SHOT_ON_TARGET: 'Shot on target',
    SAVE: 'Save',
    MISS: 'Miss',
    BLOCK: 'Blocked shot',
    CORNER: 'Corner',
    FOUL: 'Foul',
    OFFSIDE: 'Offside',
    INJURY: 'Injury',
    CHANCE: 'Chance',
    TACTIC_CHANGE: 'Tactical change',
  };

  return labels[type] ?? type.replaceAll('_', ' ').toLowerCase();
}

function getPlayerName(event: MatchEventDto, teams: MatchTeams): string | null {
  if (event.playerId === null) return null;

  for (const team of teams) {
    const player = team.lineup.find((lineupPlayer) => lineupPlayer.playerId === event.playerId);
    if (player) return player.name;
  }

  return null;
}

function MatchTeamScore({
  team,
  side,
  scorers,
}: {
  team: MatchTeams[number];
  side: 'home' | 'away';
  scorers: MatchEventDto[];
}) {
  return (
    <div className={side === "home" ? `${styles.matchTeam} ${styles.matchTeamHome}` : `${styles.matchTeam} ${styles.matchTeamAway}`}>
      <span className={styles.matchCrest}>{team.name.slice(0, 1)}</span>
      <strong>{team.name}</strong>
      <small>{side === 'home' ? 'HOME' : 'AWAY'}</small>
      <div className={styles.matchScorers}>
        {scorers.length > 0 ? scorers.map((event) => {
          const name = event.playerId === null
            ? null
            : team.lineup.find((player) => player.playerId === event.playerId)?.name ?? null;
          return (
            <span key={event.id}>
              {name ?? event.description ?? 'Unknown scorer'} · {formatMinute(event.minute, event.addedTime)}
            </span>
          );
        }) : <span className={styles.noScorers}>—</span>}
      </div>
    </div>
  );
}

export function MatchHeader({
  fixture,
  teams,
  events,
  isFinished,
  isPlaying,
  currentMinute,
}: {
  fixture: MatchFixture;
  teams: MatchTeams;
  events: MatchEventDto[];
  isFinished: boolean;
  isPlaying: boolean;
  currentMinute: number;
}) {
  const home = teams[0];
  const away = teams[1];
  const goalEvents = events.filter((event) =>
    event.type === 'GOAL' || event.type === 'OWN_GOAL' || event.type === 'PENALTY_GOAL',
  );
  const homeScorers = goalEvents.filter((event) => event.clubId === home.clubId);
  const awayScorers = goalEvents.filter((event) => event.clubId === away.clubId);
  const penaltiesAvailable =
    fixture.score.homePenalties !== null && fixture.score.awayPenalties !== null;

  return (
    <Card className={styles.matchHeader}>
      <div className={styles.matchHeaderMeta}>
        <span>{formatScheduledAt(fixture.scheduledAt)}</span>
        <strong>{fixture.competition}</strong>
        <span>{fixture.stage} · {fixture.round}</span>
      </div>
      <div className={styles.matchScoreLayout}>
        <MatchTeamScore team={home} side="home" scorers={homeScorers} />
        <div className={styles.matchResult}>
          <span className={styles.matchStatus}>
            {isFinished ? 'FULL TIME' : fixture.status === 'IN_PROGRESS' ? `${currentMinute}'` : 'KICK-OFF'}
          </span>
          <strong>{fixture.score.home} – {fixture.score.away}</strong>
          {penaltiesAvailable && (
            <span className={styles.penaltyScore}>
              Pens {fixture.score.homePenalties} – {fixture.score.awayPenalties}
            </span>
          )}
          <Badge variant={isFinished ? 'success' : 'info'}>
            {isFinished ? 'Completed' : isPlaying ? 'Live' : fixture.status === 'IN_PROGRESS' ? 'Paused' : 'Scheduled'}
          </Badge>
        </div>
        <MatchTeamScore team={away} side="away" scorers={awayScorers} />
      </div>
    </Card>
  );
}

function buildMomentumCurve(points: { x: number; y: number }[]): string {
  if (points.length < 2) {
    const point = points[0];
    return point ? `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}` : '';
  }

  const commands: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];
    if (!previous || !current || !next || !following) continue;

    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (following.x - current.x) / 6;
    const control2Y = next.y - (following.y - current.y) / 6;

    commands.push(
      `C ${control1X.toFixed(1)} ${control1Y.toFixed(1)} ${control2X.toFixed(1)} ${control2Y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`,
    );
  }

  const first = points[0];
  return first ? `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ${commands.join(' ')}` : '';
}

export function MatchMomentum({
  data,
  events,
  teams,
}: {
  data: MatchCenterResponse['momentum'];
  events: MatchEventDto[];
  teams: MatchTeams;
}) {
  const gradientId = useId().replace(/:/g, '');
  const lineGradientId = `momentum-line-${gradientId}`;
  const areaGradientId = `momentum-area-${gradientId}`;
  const latestPoint = data[data.length - 1];
  const chartWidth = 900;
  const chartHeight = 240;
  const centerY = 112;
  const maxAmplitude = 88;
  const visualGain = 5;
  const points = data.map((point) => {
    const difference = Math.max(-100, Math.min(100, point.homePressure - point.awayPressure));
    const amplifiedDifference = Math.max(-maxAmplitude, Math.min(maxAmplitude, difference * visualGain));
    return {
      x: (Math.max(0, Math.min(90, point.minute)) / 90) * chartWidth,
      y: centerY - amplifiedDifference,
    };
  });
  const linePath = buildMomentumCurve(points);
  const curveCommands = linePath.replace(/^M\s+[-\d.]+\s+[-\d.]+\s*/, '');
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = firstPoint && lastPoint
    ? `M ${firstPoint.x.toFixed(1)} ${centerY} L ${firstPoint.x.toFixed(1)} ${firstPoint.y.toFixed(1)} ${curveCommands} L ${lastPoint.x.toFixed(1)} ${centerY} Z`
    : '';
  const markedEvents = events.filter((event) =>
    event.type === 'GOAL' || event.type === 'OWN_GOAL' || event.type === 'PENALTY_GOAL' || event.type === 'RED_CARD',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle><Activity size={16} /> Match momentum</CardTitle>
      </CardHeader>
      <CardContent className={styles.momentum}>
        <div className={styles.momentumLegend}>
          <span><i className={styles.homeDot} /> Home advantage ↑</span>
          <span><i className={styles.awayDot} /> Away advantage ↓</span>
        </div>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Match momentum differential. Above the centre line favours the home team; below favours the away team."
        >
          <defs>
            <linearGradient id={lineGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#48bd83" />
              <stop offset="50%" stopColor="#a1aaa5" />
              <stop offset="100%" stopColor="#e0a35b" />
            </linearGradient>
            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#48bd83" stopOpacity=".42" />
              <stop offset="50%" stopColor="#8c9b91" stopOpacity=".04" />
              <stop offset="100%" stopColor="#e0a35b" stopOpacity=".28" />
            </linearGradient>
          </defs>
          {[0, 30, 60, 90].map((minute) => (
            <g key={minute}>
              <line
                x1={(minute / 90) * chartWidth}
                y1="8"
                x2={(minute / 90) * chartWidth}
                y2="222"
                className={styles.gridLine}
              />
              <text x={(minute / 90) * chartWidth + 5} y="235" className={styles.axisLabel}>
                {minute}&apos;
              </text>
            </g>
          ))}
          <line x1="0" y1={centerY} x2={chartWidth} y2={centerY} className={styles.axis} />
          {points.length > 0 && (
            <>
              <path d={areaPath} className={styles.momentumArea} style={{ fill: `url(#${areaGradientId})` }} />
              <path d={linePath} className={styles.momentumLine} style={{ stroke: `url(#${lineGradientId})` }} />
            </>
          )}
          {markedEvents.map((event) => {
            const minute = Math.min(90, event.minute + event.addedTime);
            const x = (minute / 90) * chartWidth;
            const isHomeEvent = event.clubId === teams[0].clubId;
            const markerY = isHomeEvent ? 18 : 204;
            const connectorStartY = isHomeEvent ? 31 : 187;
            const connectorEndY = isHomeEvent ? 43 : 174;
            const icon = event.type === 'RED_CARD' ? '🟥' : '⚽';

            return (
              <g key={event.id}>
                <line
                  x1={x}
                  y1={connectorStartY}
                  x2={x}
                  y2={connectorEndY}
                  className={styles.eventMarkerLine}
                />
                <circle cx={x} cy={markerY} r="11" className={styles.eventMarker} />
                <text x={x} y={markerY + 4} textAnchor="middle" className={styles.eventMarkerIcon}>
                  {icon}
                </text>
              </g>
            );
          })}
        </svg>
        {data.length === 0 && (
          <p className={styles.chartEmpty}>Momentum will build as the match progresses.</p>
        )}
        {latestPoint && (
          <div className={styles.momentumStateGrid}>
            {([
              { label: 'Home', state: latestPoint.homeState, tone: 'home' },
              { label: 'Away', state: latestPoint.awayState, tone: 'away' },
            ] as const).map(({ label, state, tone }) => (
              <section className={styles.momentumTeamState} key={label} aria-label={`${label} team game state`}>
                <strong>{label} team state</strong>
                {([
                  ['Territorial control', state.territorialControl],
                  ['Offensive threat', state.offensiveThreat],
                  ['Physical condition', state.physicalCondition],
                ] as const).map(([metric, value]) => (
                  <div className={styles.momentumMetric} key={metric}>
                    <span><small>{metric}</small><b>{Math.round(value)}</b></span>
                    <div className={styles.momentumMetricTrack}>
                      <i className={tone === 'home' ? styles.momentumMetricHome : styles.momentumMetricAway}
                        style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function MatchTimelineItem({
  event,
  side,
  teams,
}: {
  event: MatchEventDto;
  side: 'home' | 'away';
  teams: MatchTeams;
}) {
  const playerName = getPlayerName(event, teams);
  const author = playerName ?? event.description;
  const isKeyEvent = event.type === 'GOAL' || event.type === 'OWN_GOAL' || event.type === 'PENALTY_GOAL' || event.type === 'RED_CARD';

  return (
    <div className={`${styles.timelineEvent} ${side === 'home' ? styles.timelineHome : styles.timelineAway}`}>
      <span className={styles.timelineMinute}>{formatMinute(event.minute, event.addedTime)}</span>
      <span className={styles.timelineEventText}>
        <span className={styles.timelineIcon}>{getEventIcon(event.type)}</span>
        <strong>{author ?? getEventLabel(event.type)}</strong>
        {author && !isKeyEvent && <small>{getEventLabel(event.type)}</small>}
        {event.description && playerName && event.description !== playerName && (
          <small>{event.description}</small>
        )}
      </span>
    </div>
  );
}

export function MatchTimeline({
  events,
  teams,
}: {
  events: MatchEventDto[];
  teams: MatchTeams;
}) {
  const home = teams[0];
  const away = teams[1];
  const orderedEvents = [...events].sort((a, b) =>
    a.minute - b.minute || a.addedTime - b.addedTime || a.id - b.id,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match timeline</CardTitle>
      </CardHeader>
      <CardContent className={styles.timeline}>
        <div className={styles.timelineTeamLabels}>
          <strong>{home.name}</strong>
          <span>EVENT</span>
          <strong>{away.name}</strong>
        </div>
        {orderedEvents.length === 0 ? (
          <p className={styles.chartEmpty}>Match events will appear here as the game progresses.</p>
        ) : orderedEvents.map((event) => {
          if (event.type === 'HALF_TIME' || event.type === 'FULL_TIME' || event.type === 'KICK_OFF') {
            const label = event.type === 'HALF_TIME' ? 'HALF TIME' : event.type === 'FULL_TIME' ? 'FULL TIME' : 'KICK-OFF';
            return (
              <div className={styles.timelinePeriod} key={event.id}>
                <span />
                <strong>{label} · {formatMinute(event.minute, event.addedTime)}</strong>
                <span />
              </div>
            );
          }

          const side = event.clubId === home.clubId ? 'home' : event.clubId === away.clubId ? 'away' : null;
          return (
            <div className={styles.timelineRow} key={event.id}>
              {side === 'home' ? <MatchTimelineItem event={event} side="home" teams={teams} /> : <span />}
              {side === null ? (
                <span className={styles.timelineCenterEvent}>
                  {formatMinute(event.minute, event.addedTime)} {getEventIcon(event.type)} {event.description ?? getEventLabel(event.type)}
                </span>
              ) : <span className={styles.timelineSpine} />}
              {side === 'away' ? <MatchTimelineItem event={event} side="away" teams={teams} /> : <span />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
