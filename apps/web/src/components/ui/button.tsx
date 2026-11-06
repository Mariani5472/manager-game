import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import styles from './button.module.css';
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'default' | 'sm' | 'small' | 'lg' | 'large' | 'icon';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild = false,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : 'button';
    const variantClass = variant === 'default' ? styles.primary : styles[variant];
    const sizeClass =
      size === 'sm' || size === 'small'
        ? styles.small
        : size === 'lg' || size === 'large'
          ? styles.large
          : styles[size];
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(styles.button, variantClass, sizeClass, className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
