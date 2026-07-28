interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'danger' | 'warning' | 'info' | 'default';
}

export default function Badge({ children, variant = 'default' }: BadgeProps) {
  const variantClasses = {
    default: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
    success: 'bg-green-600/20 text-green-400',
    danger: 'bg-red-600/20 text-red-400',
    warning: 'bg-amber-600/20 text-amber-400',
    info: 'bg-blue-600/20 text-blue-400',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${variantClasses[variant]}`}>
      {children}
    </span>
  );
}
