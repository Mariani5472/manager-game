import type { HTMLAttributes } from "react";
import styles from "./badge.module.css";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";
export function Badge({ variant = "default", className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span className={[styles.badge, styles[variant], className].filter(Boolean).join(" ")} {...props} />;
}
