'use client';
import type {CampaignTeamResponse} from '@shared/index';
import {Shield} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {formatAmount} from '@/lib/formatters/number';
import {PageHeading,TeamStat} from './section-ui';
import styles from './campaign-sections.module.css';
export function TeamSection({ data }: { data: CampaignTeamResponse }) {
  const wageUsage =
    data.finances && data.finances.weeklyWageBudget > 0
      ? Math.max(
          0,
          Math.min(100, (data.finances.wageBillWeekly / data.finances.weeklyWageBudget) * 100),
        )
      : null;
  const remainingWageBudget = data.finances
    ? data.finances.weeklyWageBudget - data.finances.wageBillWeekly
    : null;
  return (
    <div className={styles.sectionStack}>
      <PageHeading
        eyebrow="CLUB MANAGEMENT"
        title="Club"
        description="Club identity, tactical approach and financial overview."
      />
      <Card>
        <CardHeader>
          <CardTitle>Club identity</CardTitle>
          <CardDescription>Profile and home ground</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={styles.clubIdentity}>
            <span className={styles.clubIdentityCrest}>
              <Shield size={29} />
            </span>
            <div>
              <h2>{data.club.name}</h2>
              <p>
                {data.club.city ?? 'City unavailable'} · {data.club.nation}
              </p>
              <Badge variant="success">Managed club</Badge>
            </div>
            <div className={styles.reputation}>
              <strong>{data.club.reputation}</strong>
              <span>REPUTATION</span>
            </div>
          </div>
          <div className={styles.clubFacts}>
            <TeamStat label="HOME STADIUM" value={data.club.stadium ?? 'Not registered'} />
            <TeamStat
              label="CAPACITY"
              value={data.club.stadiumCapacity?.toLocaleString('en-GB') ?? '—'}
            />
            <TeamStat label="COUNTRY" value={data.club.nation} />
            <TeamStat label="CITY" value={data.club.city ?? '—'} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tactical identity</CardTitle>
          <CardDescription>Current saved team instructions</CardDescription>
        </CardHeader>
        <CardContent className={styles.tacticalContent}>
          <div className={styles.tacticHero}>
            <span>FORMATION</span>
            <strong>{data.tactics.formation}</strong>
            <Badge variant="info">{data.tactics.mentality}</Badge>
          </div>
          <div className={styles.tacticsGrid}>
            <TeamStat label="PRESSING" value={data.tactics.pressing} detail="Intensity" />
            <TeamStat label="TEMPO" value={data.tactics.tempo} detail="Match tempo" />
            <TeamStat label="DEFENSIVE LINE" value={data.tactics.defensiveLine} />
            <TeamStat label="WIDTH" value={data.tactics.width} />
            <TeamStat label="PASSING DIRECTNESS" value={data.tactics.passingDirectness} />
            <TeamStat
              label="COUNTER ATTACK"
              value={data.tactics.counterAttack ? 'Enabled' : 'Disabled'}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Club finances</CardTitle>
          <CardDescription>Budgets and weekly wage commitments</CardDescription>
        </CardHeader>
        <CardContent>
          {data.finances ? (
            <>
              <div className={styles.financeGrid}>
                <TeamStat label="CLUB BALANCE" value={formatAmount(data.finances.balance)} />
                <TeamStat
                  label="TRANSFER BUDGET"
                  value={formatAmount(data.finances.transferBudget)}
                />
                <TeamStat
                  label="WEEKLY WAGE BUDGET"
                  value={formatAmount(data.finances.weeklyWageBudget)}
                />
                <TeamStat
                  label="WEEKLY WAGE BILL"
                  value={formatAmount(data.finances.wageBillWeekly)}
                />
              </div>
              <div className={styles.wageOverview}>
                <div>
                  <span>Wage budget remaining</span>
                  <strong>
                    {remainingWageBudget === null ? '—' : formatAmount(remainingWageBudget)}
                  </strong>
                </div>
                {wageUsage !== null && (
                  <>
                    <div className={styles.wageTrack}>
                      <span style={{ width: `${wageUsage}%` }} />
                    </div>
                    <small>{Math.round(wageUsage)}% of weekly wage budget committed</small>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className={styles.emptyText}>
              Financial data has not been initialized in this save.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

