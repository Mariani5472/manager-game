'use client';
import type { MatchLineupPlayerDto } from '@shared/index';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import styles from './match-section.module.css';

export function LineupList({
  title,
  players,
  managed,
  selectedIds,
  onReplace,
}: {
  title: string;
  players: MatchLineupPlayerDto[];
  managed: boolean;
  selectedIds: number[];
  onReplace?: (slot: number, playerId: number) => void;
}) {
  const startingSlots = players.filter((player) => player.isStarting);
  const substitutes = players.filter((player) =>
    managed ? !selectedIds.includes(player.playerId) : !player.isStarting,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={styles.lineupList}>
        <div className={styles.lineupGroupHeading}>
          <span>STARTING XI</span>
          <Badge variant={selectedIds.length === 11 || !managed ? 'success' : 'secondary'}>
            {managed ? selectedIds.length : startingSlots.length}/11
          </Badge>
        </div>
        {startingSlots.map((slotPlayer, index) => {
          const selectedId = managed ? selectedIds[index] ?? slotPlayer.playerId : slotPlayer.playerId;
          const selectedPlayer =
            players.find((option) => option.playerId === selectedId) ?? slotPlayer;

          return (
            <div className={styles.lineupRow} key={slotPlayer.slot}>
              <span className={styles.slot}>{slotPlayer.position}</span>
              <div className={styles.lineupPlayer}>
                <strong className={styles.playerName}>{selectedPlayer.name}</strong>
                <span className={styles.playerCondition}>
                  {selectedPlayer.position} · {Math.round(selectedPlayer.energy)}% energy
                </span>
              </div>
              {managed && onReplace ? (
                <select
                  aria-label={`Player for ${slotPlayer.position} slot`}
                  value={selectedId}
                  onChange={(event) => onReplace(index, Number(event.target.value))}
                >
                  {players.map((option) => (
                    <option key={option.playerId} value={option.playerId}>
                      {option.name} · {option.position} · {Math.round(option.energy)}%
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant="default">{slotPlayer.position}</Badge>
              )}
              <div className={styles.playerMetrics}>
                <span title="Morale">M {Math.round(selectedPlayer.morale)}</span>
                <span title="Sharpness">S {Math.round(selectedPlayer.sharpness)}</span>
              </div>
            </div>
          );
        })}

        <div className={styles.benchHeader}>
          <span>SUBSTITUTES</span>
          <Badge variant="secondary">{substitutes.length}/7</Badge>
        </div>
        {substitutes.length ? (
          substitutes.map((player) => (
            <div className={styles.benchRow} key={player.playerId}>
              <strong>{player.name}</strong>
              <span>
                {player.position} · {Math.round(player.energy)}% energy
              </span>
            </div>
          ))
        ) : (
          <p className={styles.benchEmpty}>No substitutes selected.</p>
        )}
      </CardContent>
    </Card>
  );
}
