import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] transition-theme ${padding ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
