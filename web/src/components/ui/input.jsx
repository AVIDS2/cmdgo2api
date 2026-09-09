import { cn } from '../../lib/utils';

export function Input({ className, ...props }) {
  return (
    <input
      className={cn('flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60', className)}
      {...props}
    />
  );
}
