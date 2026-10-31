import React, { useState, useId } from 'react';
import { TrendingUp, Calendar, Info } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';

export interface SalesChartDataPoint {
  day: string;
  amount: number;
  height?: string;
  isToday?: boolean;
  date?: string;
  itemsCount?: number;
}

export interface SalesChartProps {
  className?: string;
  data?: SalesChartDataPoint[];
  peakText?: string;
  title?: string;
  subtitle?: string;
  showPeriodToggle?: boolean;
  period?: '7days' | '30days';
  onPeriodChange?: (period: '7days' | '30days') => void;
  isLoading?: boolean;
}

function formatCompactRupee(val: number): string {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(val)}`;
}

function getEmpty7Days(): SalesChartDataPoint[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const res: SalesChartDataPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    res.push({
      day: days[d.getDay()],
      date: d.toISOString().split('T')[0],
      amount: 0,
      itemsCount: 0,
      isToday: i === 0,
    });
  }
  return res;
}

export const SalesChart: React.FC<SalesChartProps> = ({ 
  className = '', 
  data: propData,
  peakText: propPeakText,
  title = 'Revenue Performance',
  subtitle = 'Daily sales trend from verified customer transactions',
  showPeriodToggle = false,
  period = '7days',
  onPeriodChange,
  isLoading = false
}) => {
  const { weeklyTrend } = useAnalytics();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartId = useId();

  const chartData = propData || (weeklyTrend?.points && weeklyTrend.points.length > 0 ? weeklyTrend.points : getEmpty7Days());
  const hasData = chartData.some((p) => p.amount > 0);

  // Peak metric calculation
  const highestPoint = chartData.reduce(
    (prev, curr) => (curr.amount > prev.amount ? curr : prev),
    chartData[0] || { day: '', amount: 0 }
  );

  const peak = propPeakText || (highestPoint && highestPoint.amount > 0
    ? `Peak: ${highestPoint.day.replace(' (Today)', '')} (${formatCompactRupee(highestPoint.amount)})`
    : undefined);

  // SVG Dimension & Coordinate Math
  const svgWidth = 600;
  const svgHeight = 220;
  const padLeft = 60;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 36;

  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const rawMax = Math.max(...chartData.map(p => p.amount), 0);
  // Give 18% headroom so points don't clip at top, default to 1000 if 0
  const maxAmount = rawMax > 0 ? Math.ceil(rawMax * 1.18) : 1000;

  // Grid steps (4 horizontal bands)
  const gridSteps = [1, 0.66, 0.33, 0];
  const gridLines = gridSteps.map((step) => {
    const yVal = padTop + plotHeight * (1 - step);
    const amountVal = Math.round(maxAmount * step);
    return { yVal, amountVal };
  });

  // Calculate coordinates for points
  const points = chartData.map((item, idx) => {
    const totalPoints = chartData.length;
    const x = totalPoints > 1 
      ? padLeft + (idx / (totalPoints - 1)) * plotWidth
      : padLeft + plotWidth / 2;
    const y = padTop + plotHeight - (item.amount / maxAmount) * plotHeight;
    return { ...item, x, y, idx };
  });

  // Construct smooth cubic bezier SVG path
  let pathD = '';
  let areaD = '';

  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      const cp1y = p0.y;
      const cp2x = p0.x + (p1.x - p0.x) / 2;
      const cp2y = p1.y;
      pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }

    const baselineY = padTop + plotHeight;
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    areaD = `${pathD} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  }

  // Active highlighted point
  const activePoint = hoveredIndex !== null && points[hoveredIndex] ? points[hoveredIndex] : null;

  return (
    <div className={`bg-white rounded-xl border border-[#E3E5DE] p-5 sm:p-6 shadow-xs flex flex-col justify-between transition-all ${className}`}>
      
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-[#E3E5DE] mb-3">
        <div className="min-w-0">
          <h3 className="font-extrabold text-[#202923] text-base flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0 border border-[#52745D]/20">
              <TrendingUp className="w-4 h-4" />
            </span>
            <span>{title}</span>
          </h3>
          <p className="text-xs text-[#69736C] font-medium mt-0.5 truncate">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
          {peak && (
            <span className="text-xs font-bold text-[#234B3A] bg-[#E5EEE6] px-2.5 py-1 rounded-md border border-[#52745D]/20">
              {peak}
            </span>
          )}

          {showPeriodToggle && onPeriodChange && (
            <div className="inline-flex items-center bg-[#F7F5EF] p-0.5 rounded-lg border border-[#E3E5DE] text-xs font-semibold">
              <button
                type="button"
                onClick={() => onPeriodChange('7days')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  period === '7days'
                    ? 'bg-[#234B3A] text-white shadow-xs'
                    : 'text-[#69736C] hover:text-[#202923]'
                }`}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => onPeriodChange('30days')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  period === '30days'
                    ? 'bg-[#234B3A] text-white shadow-xs'
                    : 'text-[#69736C] hover:text-[#202923]'
                }`}
              >
                30 Days
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart Area */}
      {isLoading ? (
        <div className="h-48 sm:h-56 flex flex-col items-center justify-center gap-2 text-xs font-medium text-[#69736C] animate-pulse">
          <div className="w-full h-32 bg-[#F7F5EF] rounded-lg"></div>
          <span>Loading verified revenue telemetry...</span>
        </div>
      ) : !hasData ? (
        <div className="h-48 sm:h-56 flex flex-col items-center justify-center text-center p-6 bg-[#F7F5EF]/50 rounded-lg border border-dashed border-[#E3E5DE] my-1">
          <div className="w-10 h-10 rounded-full bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center mb-2">
            <Calendar className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-[#202923]">No Sales Recorded For This Period</p>
          <p className="text-xs text-[#69736C] max-w-sm mt-1">
            Once transactions are recorded via POS or customer checkout, your daily revenue trajectory will automatically visualize here.
          </p>
        </div>
      ) : (
        <div className="relative w-full pt-1">
          {/* Responsive SVG Chart */}
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-48 sm:h-56 select-none overflow-visible"
            role="img"
            aria-label="Daily sales revenue trend line chart"
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              <linearGradient id={`gradient-${chartId}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#234B3A" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#234B3A" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Grid Lines & Y-Axis Labels */}
            {gridLines.map((line, idx) => (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={line.yVal}
                  x2={svgWidth - padRight}
                  y2={line.yVal}
                  stroke="#E3E5DE"
                  strokeWidth="1"
                  strokeDasharray={idx === gridLines.length - 1 ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 10}
                  y={line.yVal + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="Inter, sans-serif"
                  fill="#69736C"
                  fontWeight="600"
                >
                  {formatCompactRupee(line.amountVal)}
                </text>
              </g>
            ))}

            {/* Area Fill */}
            <path d={areaD} fill={`url(#gradient-${chartId})`} />

            {/* Smooth Trend Line */}
            <path
              d={pathD}
              fill="none"
              stroke="#234B3A"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Active Vertical Crosshair */}
            {activePoint && (
              <line
                x1={activePoint.x}
                y1={padTop}
                x2={activePoint.x}
                y2={padTop + plotHeight}
                stroke="#52745D"
                strokeWidth="1.25"
                strokeDasharray="2 2"
              />
            )}

            {/* Interactive Data Points & X-Axis Labels */}
            {points.map((p, idx) => {
              const isHovered = hoveredIndex === idx;
              // Handle label skipping if 30-day view
              const showLabel = points.length <= 10 || idx % Math.ceil(points.length / 7) === 0 || idx === points.length - 1;

              return (
                <g key={idx} className="cursor-pointer">
                  {/* Invisible broad hit-area for touch/mouse */}
                  <rect
                    x={p.x - 18}
                    y={padTop}
                    width={36}
                    height={plotHeight + padBottom}
                    fill="transparent"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onClick={() => setHoveredIndex(idx)}
                  />

                  {/* Circle dot on line */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 6 : p.isToday ? 4.5 : 3.5}
                    fill={p.isToday || isHovered ? '#FFFFFF' : '#FFFFFF'}
                    stroke={p.isToday ? '#287A4B' : '#234B3A'}
                    strokeWidth={isHovered ? 3 : p.isToday ? 2.5 : 2}
                    className="transition-all duration-150"
                  />

                  {/* X-Axis Date / Day label */}
                  {showLabel && (
                    <text
                      x={p.x}
                      y={svgHeight - 12}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="Inter, sans-serif"
                      fontWeight={p.isToday || isHovered ? '700' : '500'}
                      fill={p.isToday ? '#234B3A' : isHovered ? '#202923' : '#69736C'}
                    >
                      {p.day.replace(' (Today)', '')}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Floating Tooltip */}
          {activePoint && (
            <div
              className="absolute pointer-events-none transform -translate-x-1/2 bg-[#202923] text-white rounded-lg px-3 py-2 text-xs shadow-lg z-20 transition-all border border-[#52745D]/40"
              style={{
                left: `${(activePoint.x / svgWidth) * 100}%`,
                top: `${Math.max(4, (activePoint.y / svgHeight) * 100 - 35)}%`,
              }}
            >
              <div className="font-bold text-slate-100 flex items-center justify-between gap-3">
                <span>{activePoint.day}</span>
                {activePoint.date && <span className="text-[10px] text-slate-300 font-normal">{activePoint.date}</span>}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-sm font-extrabold text-[#E5EEE6]">
                  ₹{activePoint.amount.toLocaleString('en-IN')}
                </span>
                {typeof activePoint.itemsCount === 'number' && activePoint.itemsCount > 0 && (
                  <span className="text-[10px] text-slate-300">
                    ({activePoint.itemsCount} items)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Insight / Line Description */}
      <div className="mt-3 pt-3 border-t border-[#E3E5DE] flex items-center justify-between text-xs text-[#69736C]">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-[#52745D]" />
          <span>Real-time aggregation from verified counter & store orders</span>
        </div>
        <div className="hidden xs:flex items-center gap-2 font-medium">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#234B3A]"></span>
          <span>Revenue (₹)</span>
        </div>
      </div>

    </div>
  );
};
