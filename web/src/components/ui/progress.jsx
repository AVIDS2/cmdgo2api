import { cn } from '../../lib/utils';

export function Progress({ value = 0, className, indicatorClassName }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cn('h-full rounded-full bg-teal-500 transition-all duration-500', indicatorClassName)}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}
