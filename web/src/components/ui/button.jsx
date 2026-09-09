import { cn } from '../../lib/utils';

const variants = {
  default: 'bg-ink text-white shadow-sm hover:bg-ink/90',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-border hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-ink',
  outline: 'bg-transparent text-ink ring-1 ring-inset ring-border hover:bg-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({ className, variant = 'default', size = 'default', ...props }) {
  const sizes = {
    default: 'h-10 px-4',
    sm: 'h-9 px-3 text-sm',
    lg: 'h-11 px-5',
    icon: 'h-10 w-10',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
