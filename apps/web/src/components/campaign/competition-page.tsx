'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/formatters/date';
import { gameApi } from '@/lib/api';
import { PageError, PageLoading } from './page-state';
import { PageHeading } from './section-ui';
import styles from './campaign-sections.module.css';

export function CompetitionPage({ saveId }: { saveId: string }) {
  const router = useRouter();
  const overview = useQuery({ queryKey: ['campaign', saveId, 'overview'], queryFn: () => gameApi.campaignOverview(saveId) });
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const stageId = selectedStageId ?? overview.data?.competitions[0]?.stageId ?? null;
  const detail = useQuery({
    queryKey: ['campaign', saveId, 'competition', stageId],
    queryFn: () => gameApi.competition(saveId, stageId!),
    enabled: stageId !== null,
  });
  if (overview.isLoading || (stageId !== null && detail.isLoading)) return <PageLoading label="Loading competition…" />;
  if (overview.isError) return <PageError message={overview.error.message} />;
  if (!overview.data?.competitions.length) return <PageError message="No competition stages are registered for this save." />;
  if (detail.isError || !detail.data) return <PageError message={detail.error?.message ?? 'Unable to load competition.'} />;
  const data = detail.data;
  const standingGroups = data.standings.reduce<Array<{ groupId: number; groupName: string; rows: typeof data.standings }>>((groups, row) => {
    let group = groups.find((item) => item.groupId === row.groupId);
    if (!group) {
      group = { groupId: row.groupId, groupName: row.groupName, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    return groups;
  }, []);
  return <div className={styles.page}>
    <PageHeading eyebrow="COMPETITIONS" title="Competition centre" description="Standings and round-by-round results for this stage, with top scorers across the competition season." />
    <div className={styles.competitionPicker}>
      {overview.data.competitions.map(stage => <Button key={stage.stageId} size="sm" variant={stage.stageId === stageId ? 'default' : 'outline'} onClick={() => { setSelectedStageId(stage.stageId); setSelectedRoundId(null); }}>{stage.competition} · {stage.stage}</Button>)}
    </div>
    <Card>
      <CardHeader><div><CardTitle>{data.stage.competition}</CardTitle><CardDescription>{data.stage.stage} · {data.stage.seasonYear}</CardDescription></div><Badge variant={data.stage.stageStatus === 'COMPLETED' ? 'success' : 'secondary'}>{data.stage.stageStatus.replace('_',' ')}</Badge></CardHeader>
      <CardContent>
        {standingGroups.length > 0 ? <div className={styles.competitionTableWrap}>{standingGroups.map(group => <section key={group.groupId} className={styles.competitionStandingGroup}>{data.stage.stageKind === 'GROUPS' && <h3>{group.groupName}</h3>}<table className={styles.competitionTable}><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{group.rows.map(row => <tr key={row.clubId}><td>{row.position}</td><td>{row.club}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></section>)}</div> : <p className={styles.emptyText}>This stage does not use a league table.</p>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><div><CardTitle>Rounds and fixtures</CardTitle><CardDescription>Completed matches can be opened to inspect their timeline and momentum.</CardDescription></div></CardHeader>
      <CardContent>
        {data.rounds.length ? (() => {
          const selectedRoundIndex = Math.max(0, data.rounds.findIndex(round => round.roundId === selectedRoundId));
          const selectedRound = data.rounds[selectedRoundIndex];
          return <>
            <div className={styles.roundNavigation}>
              <Button size="sm" variant="outline" disabled={selectedRoundIndex === 0} onClick={() => setSelectedRoundId(data.rounds[selectedRoundIndex - 1].roundId)}>Previous</Button>
              <label className={styles.roundSelector}>
                <span>Round</span>
                <select aria-label="Select competition round" value={selectedRound.roundId} onChange={event => setSelectedRoundId(Number(event.target.value))}>
                  {data.rounds.map(round => <option key={round.roundId} value={round.roundId}>{round.name}</option>)}
                </select>
              </label>
              <Button size="sm" variant="outline" disabled={selectedRoundIndex === data.rounds.length - 1} onClick={() => setSelectedRoundId(data.rounds[selectedRoundIndex + 1].roundId)}>Next</Button>
            </div>
            <section className={styles.competitionRound} key={selectedRound.roundId}>
              <div className={styles.competitionRoundHeading}><strong>{selectedRound.name}</strong><span>{selectedRound.completedCount}/{selectedRound.fixtureCount} completed</span></div>
              {selectedRound.fixtures.length ? selectedRound.fixtures.map(fixture => <button key={fixture.id} className={styles.competitionFixture} type="button" disabled={fixture.status !== 'COMPLETED'} onClick={() => router.push('/game/' + saveId + '/match/' + fixture.id + '/center')}>
                <span>{formatDate(fixture.scheduledAt)}</span><strong>{fixture.homeClub}</strong><b>{fixture.score ?? 'vs'}</b><strong>{fixture.awayClub}</strong><Badge variant={fixture.status === 'COMPLETED' ? 'success' : 'secondary'}>{fixture.status.replace('_',' ')}</Badge>
              </button>) : <p className={styles.emptyText}>No fixtures are scheduled for this round.</p>}
            </section>
          </>;
        })() : <p className={styles.emptyText}>No rounds are available for this stage.</p>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><div><CardTitle>Top scorers</CardTitle><CardDescription>Goals from completed fixtures across all stages of this competition season.</CardDescription></div></CardHeader>
      <CardContent>{data.topScorers.length ? <div className={styles.scorerList}>{data.topScorers.map((scorer) => <div key={scorer.playerId}><span>{scorer.position}</span><strong>{scorer.player}<small>{scorer.clubs}</small></strong><b>{scorer.goals}</b></div>)}</div> : <p className={styles.emptyText}>No goals recorded in completed matches yet.</p>}</CardContent>
    </Card>
  </div>;
}
