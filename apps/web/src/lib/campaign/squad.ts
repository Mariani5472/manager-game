import type { CampaignPlayerDto } from '@shared/index';

export function getSquadPositions(players: CampaignPlayerDto[]): string[] {
  return [...new Set(players.flatMap((player) => player.positions))].sort();
}

export function filterSquadPlayers(
  players: CampaignPlayerDto[],
  search: string,
  position: string,
): CampaignPlayerDto[] {
  const normalizedSearch = search.trim().toLowerCase();
  return players.filter(
    (player) =>
      `${player.name} ${player.positions.join(' ')}`.toLowerCase().includes(normalizedSearch) &&
      (position === 'ALL' || player.positions.includes(position)),
  );
}

export function getPlayerStatusVariant(status: string): 'default' | 'success' | 'warning' | 'info' {
  if (status === 'FIRST_TEAM') return 'success';
  if (status === 'RESERVE') return 'info';
  return 'default';
}
