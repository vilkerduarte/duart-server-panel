import { useState, useEffect } from 'react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';

interface ContainerCardProps {
  container: any;
  onAction: (id: string, action: string) => void;
}

export default function ContainerCard({ container, onAction }: ContainerCardProps) {
  const id = container.ID || container.id || '';
  const name = container.Names || container.name || id.slice(0, 12);
  const image = container.Image || container.image || '';
  const state = container.State || container.state || 'unknown';
  const status = container.Status || container.status || '';
  const ports = container.Ports || '';

  const getStateBadge = (s: string) => {
    if (s === 'running') return <Badge variant="success">Running</Badge>;
    if (s === 'exited') return <Badge variant="danger">Exited</Badge>;
    if (s === 'paused') return <Badge variant="warning">Paused</Badge>;
    return <Badge>{s}</Badge>;
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-[var(--text-primary)]">{name}</h3>
            {getStateBadge(state)}
          </div>
          <div className="text-xs text-[var(--text-muted)] space-x-3">
            <span>Image: {image}</span>
            {ports && <span>Ports: {ports}</span>}
            <span>{status}</span>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onAction(id, 'start')} className="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">Start</button>
          <button onClick={() => onAction(id, 'stop')} className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30">Stop</button>
          <button onClick={() => onAction(id, 'restart')} className="px-2 py-1 text-xs rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">Restart</button>
        </div>
      </div>
    </Card>
  );
}
