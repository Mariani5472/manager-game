'use client';
import type {CampaignOverviewResponse} from '@shared/index';
import {ArrowRight,CalendarDays,Shield,Trophy} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Table,TableCell,TableHead} from '@/components/ui/table';
import {formatDate} from '@/lib/formatters/date';
import {PageHeading,StatCard} from './section-ui';
import styles from './campaign-sections.module.css';
export function OverviewSection({ data }: { data: CampaignOverviewResponse }) {
  const pendingFixtures = data.competitions.reduce(
    (total, competition) => total + competition.pendingFixtures,
    0,
  );
  const next = data.nextFixture;
  return (
    <div className={styles.sectionStack}>
      <PageHeading
        eyebrow="SEASON HUB"
        title="Club dashboard"
        description={`The latest picture of ${data.club.name} and its season.`}
      />
      <section className={styles.dashboardHero} aria-label="Next fixture">
        <div className={styles.heroMain}>
          <div className={styles.heroEyebrow}>
            <CalendarDays size={14} /> NEXT FIXTURE{' '}
            <Badge variant={next?.status === 'IN_PROGRESS' ? 'success' : 'default'}>
              {next?.status?.replaceAll('_', ' ') ?? 'NO FIXTURE'}
            </Badge>
          </div>
          {next ? (
            <>
              <p className={styles.heroCompetition}>
                {next.competition} <span>·</span> {next.stage}
              </p>
              <div className={styles.heroMatch}>
                <div className={styles.heroClub}>
                  <span className={styles.clubInitial}>
                    {next.homeClub.slice(0, 1).toUpperCase()}
                  </span>
                  <strong>{next.homeClub}</strong>
                  <small>HOME</small>
                </div>
                <span className={styles.heroVersus}>VS</span>
                <div className={styles.heroClub}>
                  <span className={styles.clubInitial}>
                    {next.awayClub.slice(0, 1).toUpperCase()}
                  </span>
                  <strong>{next.awayClub}</strong>
                  <small>AWAY</small>
                </div>
              </div>
              <div className={styles.heroFooter}>
                <span>
                  {formatDate(next.scheduledAt, {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <span>{next.round}</span>
              </div>
            </>
          ) : (
            <div className={styles.heroEmpty}>
              <strong>No upcoming fixture</strong>
              <span>Your next match will appear here when the calendar is available.</span>
            </div>
          )}
        </div>
        <div className={styles.heroAside}>
          <span className={styles.asideLabel}>LAST RESULT</span>
          {data.recentResult ? (
            <>
              <strong className={styles.lastScore}>{data.recentResult.score ?? '—'}</strong>
              <span className={styles.lastTeams}>{data.recentResult.homeClub}</span>
              <span className={styles.lastTeams}>{data.recentResult.awayClub}</span>
              <span className={styles.lastCompetition}>{data.recentResult.competition}</span>
            </>
          ) : (
            <span className={styles.noResult}>No completed matches yet.</span>
          )}
        </div>
      </section>
      <div className={styles.statsGrid}>
        <StatCard label="SQUAD" value={data.squadSize} detail="Registered players" icon={Shield} />
        <StatCard
          label="COMPETITIONS"
          value={data.competitions.length}
          detail="Season entries"
          icon={Trophy}
        />
        <StatCard
          label="FIXTURES LEFT"
          value={pendingFixtures}
          detail="Across competitions"
          icon={CalendarDays}
        />
        <StatCard
          label="REPUTATION"
          value={data.club.reputation}
          detail="Club reputation"
          icon={ArrowRight}
        />
      </div>
      <div className={styles.dashboardColumns}>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Competition overview</CardTitle>
              <CardDescription>Progress and league position</CardDescription>
            </div>
          </CardHeader>
          <CardContent className={styles.competitionList}>
            {data.competitions.map((competition) => {
              const standing = competition.standing.find((row) => row.isManaged);
              const total = competition.completedFixtures + competition.pendingFixtures;
              return (
                <section className={styles.competitionBlock} key={competition.stageId}>
                  <div className={styles.competitionHeading}>
                    <div>
                      <strong>{competition.competition}</strong>
                      <span>
                        {competition.stage} · {competition.seasonYear}
                      </span>
                    </div>
                    <Badge variant={competition.stageStatus === 'COMPLETED' ? 'success' : 'info'}>
                      {competition.stageStatus === 'COMPLETED' ? 'Completed' : 'In progress'}
                    </Badge>
                  </div>
                  <div className={styles.competitionProgress}>
                    <div>
                      <span>{competition.completedFixtures} played</span>
                      <span>{competition.pendingFixtures} remaining</span>
                    </div>
                    <div className={styles.progressTrack}>
                      <span
                        style={{
                          width: `${total ? (competition.completedFixtures / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  {competition.standing.length ? (
                    <>
                      <div className={styles.standingSummary}>
                        <span>YOUR POSITION</span>
                        <strong>{standing ? `#${standing.position}` : '—'}</strong>
                        <span>
                          {standing
                            ? `${standing.points} pts · ${standing.played} played`
                            : 'Not ranked'}
                        </span>
                      </div>
                      <Table className={styles.standingTable}>
                        <thead>
                          <tr>
                            <TableHead>#</TableHead>
                            <TableHead>Club</TableHead>
                            <TableHead className={styles.alignRight}>P</TableHead>
                            <TableHead className={styles.alignRight}>GD</TableHead>
                            <TableHead className={styles.alignRight}>Pts</TableHead>
                          </tr>
                        </thead>
                        <tbody>
                          {competition.standing.slice(0, 5).map((row) => (
                            <tr
                              key={row.position}
                              className={row.isManaged ? styles.managedRow : undefined}
                            >
                              <TableCell>{row.position}</TableCell>
                              <TableCell>
                                <span className={styles.clubCell}>
                                  {row.club}
                                  {row.isManaged && <Badge variant="success">You</Badge>}
                                </span>
                              </TableCell>
                              <TableCell className={styles.alignRight}>{row.played}</TableCell>
                              <TableCell className={styles.alignRight}>
                                {row.goalDifference > 0
                                  ? `+${row.goalDifference}`
                                  : row.goalDifference}
                              </TableCell>
                              <TableCell className={styles.alignRight}>
                                <strong>{row.points}</strong>
                              </TableCell>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </>
                  ) : (
                    <p className={styles.competitionNote}>
                      Knockout competition · {competition.completedFixtures} completed,{' '}
                      {competition.pendingFixtures} remaining.
                    </p>
                  )}
                </section>
              );
            })}
            {!data.competitions.length && (
              <p className={styles.emptyText}>
                No competition entries are available for this season.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Club profile</CardTitle>
            <CardDescription>Identity and home ground</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={styles.clubProfile}>
              <span className={styles.profileCrest}>
                <Shield size={25} />
              </span>
              <div>
                <h2>{data.club.name}</h2>
                <p>
                  {data.club.city ?? 'City unavailable'} · {data.club.nation}
                </p>
              </div>
            </div>
            <div className={styles.profileFacts}>
              <div>
                <span>STADIUM</span>
                <strong>{data.club.stadium ?? 'Not registered'}</strong>
              </div>
              <div>
                <span>CAPACITY</span>
                <strong>{data.club.stadiumCapacity?.toLocaleString('en-GB') ?? '—'}</strong>
              </div>
              <div>
                <span>REPUTATION</span>
                <strong>{data.club.reputation}</strong>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

