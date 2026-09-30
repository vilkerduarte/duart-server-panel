interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'danger' | 'warning' | 'info' | 'default';
}

export default function Badge({ children, variant = 'default' }: BadgeProps) {
  const variantClasses = {
    default: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
    success: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30',
    danger: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
    warning: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
    info: 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${variantClasses[variant]}`}>
      {children}
    </span>
  );
}
