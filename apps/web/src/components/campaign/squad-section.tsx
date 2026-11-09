'use client';
import { useMemo, useState } from 'react';
import type { CampaignPlayerDto, CampaignSquadResponse } from '@shared/index';
import { Search, Shield, SlidersHorizontal, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Table, TableCell, TableHead } from '@/components/ui/table';
import {
  getSquadPositions,
  filterSquadPlayers,
  getPlayerStatusVariant,
} from '@/lib/campaign/squad';
import { PageHeading } from './section-ui';
import styles from './campaign-sections.module.css';
function MetricBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.metricBar}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <span className={styles.metricTrack}>
        <span style={{ width: `${safeValue}%` }} />
      </span>
    </div>
  );
}
function getPlayerStatusVariant(status: string): 'default' | 'success' | 'warning' | 'info' {
  if (status === 'FIRST_TEAM') return 'success';
  if (status === 'RESERVE') return 'info';
  return 'default';
}
function PlayerDetails({ player }: { player: CampaignPlayerDto }) {
  return (
    <div className={styles.playerDetails}>
      <div className={styles.playerIdentity}>
        <span className={styles.playerNumber}>{player.shirtNumber ?? '—'}</span>
        <div>
          <strong>{player.name}</strong>
          <span>{player.positions.join(' · ') || 'Position not registered'}</span>
        </div>
      </div>
      <div className={styles.playerStatusLine}>
        <span>Squad status</span>
        <Badge variant={getPlayerStatusVariant(player.squadStatus)}>
          {player.squadStatus.replaceAll('_', ' ')}
        </Badge>
      </div>
      <div className={styles.playerMetrics}>
        <MetricBar label="Energy" value={player.energy} />
        <MetricBar label="Morale" value={player.morale} />
        <MetricBar label="Sharpness" value={player.sharpness} />
      </div>
      <p className={styles.detailDisclaimer}>
        These are the condition values currently available in this save. Technical attributes and
        contract details are not part of this screen&apos;s data yet.
      </p>
    </div>
  );
}
export function SquadSection({ data }: { data: CampaignSquadResponse }) {
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('ALL');
  const [selectedPlayer, setSelectedPlayer] = useState<CampaignPlayerDto | null>(null);
  const positions = useMemo(() => getSquadPositions(data.players), [data.players]);
  const players = useMemo(
    () => filterSquadPlayers(data.players, search, position),
    [data.players, position, search],
  );
  const firstTeamCount = data.players.filter(
    (player) => player.squadStatus === 'FIRST_TEAM',
  ).length;
  return (
    <div className={styles.sectionStack}>
      <PageHeading
        eyebrow="FIRST TEAM"
        title="Squad"
        description={`${data.club.name} · ${data.players.length} registered players`}
      />
      <div className={styles.squadSummary}>
        <div>
          <Users size={17} />
          <span>
            <strong>{data.players.length}</strong> players registered
          </span>
        </div>
        <div>
          <Shield size={17} />
          <span>
            <strong>{firstTeamCount}</strong> first-team players
          </span>
        </div>
      </div>
      <Card>
        <CardHeader className={styles.squadHeader}>
          <div>
            <CardTitle>Player list</CardTitle>
            <CardDescription>Select a player to inspect their current condition</CardDescription>
          </div>
          <label className={styles.searchBox}>
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search players"
              aria-label="Search players"
            />
          </label>
        </CardHeader>
        <CardContent className={styles.squadContent}>
          <div className={styles.positionFilters} aria-label="Filter by position">
            <SlidersHorizontal size={14} />
            <Button
              size="sm"
              variant={position === 'ALL' ? 'secondary' : 'ghost'}
              aria-pressed={position === 'ALL'}
              onClick={() => setPosition('ALL')}
            >
              All positions
            </Button>
            {positions.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={position === item ? 'secondary' : 'ghost'}
                aria-pressed={position === item}
                onClick={() => setPosition(item)}
              >
                {item}
              </Button>
            ))}
          </div>
          <Table className={styles.squadTable}>
            <thead>
              <tr>
                <TableHead>No.</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Energy</TableHead>
                <TableHead>Morale</TableHead>
                <TableHead>Sharpness</TableHead>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <TableCell>{player.shirtNumber ?? '—'}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className={styles.playerLink}
                      onClick={() => setSelectedPlayer(player)}
                    >
                      {player.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className={styles.positionText}>
                      {player.positions.join(' / ') || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getPlayerStatusVariant(player.squadStatus)}>
                      {player.squadStatus.replaceAll('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={styles.tableMetric}>{player.energy}</span>
                  </TableCell>
                  <TableCell>
                    <span className={styles.tableMetric}>{player.morale}</span>
                  </TableCell>
                  <TableCell>
                    <span className={styles.tableMetric}>{player.sharpness}</span>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
          {!players.length && (
            <div className={styles.emptyState}>
              <Users size={22} />
              <strong>No players found</strong>
              <span>Try another name or position filter.</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Modal
        open={selectedPlayer !== null}
        title="Player details"
        onClose={() => setSelectedPlayer(null)}
      >
        {selectedPlayer && <PlayerDetails player={selectedPlayer} />}
      </Modal>
    </div>
  );
}
