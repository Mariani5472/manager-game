import { LoaderCircle } from 'lucide-react';
import styles from './campaign-shell.module.css';
export function PageLoading({ label }: { label: string }) {
  return <p className={styles.state}><LoaderCircle className={styles.spinner} size={17} />{label}</p>;
}
export function PageError({ message }: { message: string }) {
  return <p className={styles.error}>{message}</p>;
}
