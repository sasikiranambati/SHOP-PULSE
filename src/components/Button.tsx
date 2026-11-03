import React from 'react';
import { Loader2 } from 'lucide-react';

// React 19 passes `ref` as a regular prop, so it reaches the <button> through ...props.
interface ButtonProps extends React.ComponentPropsWithRef<'button'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  /** Shows a spinner, disables the button and marks it busy while an operation runs. */
  loading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'font-semibold rounded-lg transition-all duration-150 inline-flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed shadow-2xs select-none focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantStyles = {
    primary: 'bg-[#234B3A] hover:bg-[#18382B] active:bg-[#142e23] text-white border border-[#234B3A] shadow-xs focus-visible:outline-[#234B3A]',
    secondary: 'bg-white hover:bg-[#F7F5EF] active:bg-[#E5EEE6] text-[#202923] border border-[#E3E5DE] hover:border-[#69736C]/40 focus-visible:outline-[#234B3A]',
    danger: 'bg-[#B93838] hover:bg-[#9e2d2d] active:bg-[#852525] text-white border border-[#B93838] shadow-xs focus-visible:outline-[#B93838]',
    outline: 'bg-transparent hover:bg-[#E5EEE6] text-[#234B3A] border border-[#234B3A] active:bg-[#E5EEE6]/80 focus-visible:outline-[#234B3A]',
    ghost: 'bg-transparent hover:bg-[#E5EEE6] text-[#234B3A] border border-transparent shadow-none focus-visible:outline-[#234B3A]',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs sm:text-sm min-h-[36px]',
    md: 'px-4 py-2.5 text-sm sm:text-base min-h-[44px]',
    lg: 'px-6 py-3 text-base sm:text-lg font-bold min-h-[48px]',
  };

  const shownIcon = loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon;

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {shownIcon && <span className="shrink-0">{shownIcon}</span>}
      <span>{children}</span>
    </button>
  );
};
