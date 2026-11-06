'use client';
import { useEffect, type ReactNode } from 'react';
import styles from './modal.module.css';

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <h2>{title}</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        <div className={styles.content}>{children}</div>
      </section>
    </div>
  );
}
