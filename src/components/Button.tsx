import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  ...props
}) => {
  const baseStyles = 'font-bold rounded-xl transition-all duration-150 inline-flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed shadow-xs select-none';
  
  const variantStyles = {
    primary: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white border border-emerald-600/80 shadow-emerald-600/20',
    secondary: 'bg-slate-800 hover:bg-slate-900 active:bg-black text-white border border-slate-800',
    danger: 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white border border-rose-600',
    outline: 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-300/90 hover:border-slate-400',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs sm:text-sm min-h-[36px]',
    md: 'px-4 py-2.5 text-sm sm:text-base min-h-[44px]',
    lg: 'px-6 py-3.5 text-base sm:text-lg font-extrabold min-h-[50px]',
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
