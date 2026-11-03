import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  action,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-w-0">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#202923] tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-xs sm:text-sm text-[#69736C] font-normal break-words">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 w-full sm:w-auto flex items-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
};
