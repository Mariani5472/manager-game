import type { TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import styles from './table.module.css';

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className={styles.viewport}>
      <table className={[styles.table, className].filter(Boolean).join(' ')} {...props} />
    </div>
  );
}
export function TableHead(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} className={[styles.headCell, props.className].filter(Boolean).join(' ')} />;
}
export function TableCell(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={[styles.cell, props.className].filter(Boolean).join(' ')} />;
}
