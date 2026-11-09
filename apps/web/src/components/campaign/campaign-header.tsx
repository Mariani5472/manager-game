'use client';
import { useState } from 'react';
import { Bell, Play, Settings, ShieldCheck, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import styles from './campaign-layout.module.css';
export function CampaignHeader({
  clubName,
  saveName,
  season,
  competition,
  nextFixture,
  onNextMatch,
  onExit,
}: {
  clubName?: string;
  saveName?: string;
  season?: number;
  competition?: string;
  nextFixture?: { id: number; status: string } | null;
  onNextMatch?: () => void;
  onExit: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  return (
    <>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.crest}>
            <Trophy size={19} />
          </span>
          <div className={styles.identityText}>
            <strong>{clubName ?? 'Loading club…'}</strong>
            <span>{saveName ?? 'Opening career…'}</span>
          </div>
        </div>
        <div className={styles.campaignContext}>
          <span>{season ? `Season ${season}` : 'Season —'}</span>
          <span className={styles.contextDivider} />
          <span>{competition ?? 'No active competition'}</span>
        </div>
        <div className={styles.headerActions}>
          {nextFixture && onNextMatch && ['SCHEDULED', 'IN_PROGRESS'].includes(nextFixture.status) && (
            <Button size="sm" onClick={onNextMatch}>
              <Play size={14} /> {nextFixture.status === 'IN_PROGRESS' ? 'Continuar partida' : 'Próxima partida'}
            </Button>
          )}
          <span className={styles.saveStatus}>
            <ShieldCheck size={14} />
            Career loaded
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            onClick={() => setNotificationsOpen(true)}
          >
            <Bell size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={17} />
          </Button>
          <Button variant="outline" size="sm" onClick={onExit}>
            Exit
          </Button>
        </div>
      </header>
      <Modal open={settingsOpen} title="Campaign settings" onClose={() => setSettingsOpen(false)}>
        <p className={styles.placeholderText}>
          Campaign settings are not available yet. Your save and gameplay data are unchanged.
        </p>
      </Modal>
      <Modal
        open={notificationsOpen}
        title="Notifications"
        onClose={() => setNotificationsOpen(false)}
      >
        <p className={styles.placeholderText}>There are no campaign notifications yet.</p>
      </Modal>
    </>
  );
}
