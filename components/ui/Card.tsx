import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  /** Realce da borda: 'amber' destaca o cartão com brilho âmbar. */
  glow?: 'blue' | 'amber';
}

export default function Card({ children, className = '', padding = true, glow = 'blue' }: CardProps) {
  return (
    <div
      className={`glass-card glow-border ${glow === 'amber' ? 'glow-border--amber glass-card--amber' : ''} rounded-2xl ${padding ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
