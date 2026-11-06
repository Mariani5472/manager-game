import type { HTMLAttributes } from 'react';
import styles from './card.module.css';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={[styles.card, className].filter(Boolean).join(' ')} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.header, className].filter(Boolean).join(' ')} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={[styles.title, className].filter(Boolean).join(' ')} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={[styles.description, className].filter(Boolean).join(' ')} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.content, className].filter(Boolean).join(' ')} {...props} />;
}
