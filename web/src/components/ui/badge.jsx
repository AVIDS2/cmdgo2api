import { cn } from '../../lib/utils';

const variants = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  brand: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

export function Badge({ className, variant = 'neutral', ...props }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', variants[variant], className)}
      {...props}
    />
  );
}
