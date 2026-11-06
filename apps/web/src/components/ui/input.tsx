import * as React from 'react';
import styles from './input.module.css';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={[styles.input, className].filter(Boolean).join(' ')} {...props} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={[styles.input, className].filter(Boolean).join(' ')} {...props} />
));
Select.displayName = 'Select';
