export function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value);
}
