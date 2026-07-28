import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';

interface ProcessDetailProps {
  process: any;
  open: boolean;
  onClose: () => void;
  onKill: (pid: number, signal: string) => void;
}

export default function ProcessDetail({ process, open, onClose, onKill }: ProcessDetailProps) {
  if (!process) return null;

  return (
    <Modal open={open} onClose={onClose} title={`PID ${process.pid} — ${process.command?.split(' ')[0]}`} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-[var(--text-muted)]">PID:</span> <span className="text-[var(--text-primary)]">{process.pid}</span></div>
          <div><span className="text-[var(--text-muted)]">Usuário:</span> <span className="text-[var(--text-primary)]">{process.user}</span></div>
          <div><span className="text-[var(--text-muted)]">CPU:</span> <span className="text-[var(--text-primary)]">{process.cpu.toFixed(1)}%</span></div>
          <div><span className="text-[var(--text-muted)]">Memória:</span> <span className="text-[var(--text-primary)]">{process.mem.toFixed(1)}%</span></div>
          <div><span className="text-[var(--text-muted)]">Estado:</span> <span className="text-[var(--text-primary)]">{process.state}</span></div>
          <div><span className="text-[var(--text-muted)]">Tempo:</span> <span className="text-[var(--text-primary)]">{process.time}</span></div>
        </div>
        <div>
          <span className="text-sm text-[var(--text-muted)]">Comando:</span>
          <code className="block text-sm bg-[var(--bg-secondary)] p-2 rounded mt-1 font-mono text-[var(--text-primary)]">{process.command}</code>
        </div>
        <div className="flex gap-2 pt-3 border-t border-[var(--border-color)]">
          <Button variant="danger" onClick={() => { onKill(process.pid, 'SIGTERM'); onClose(); }}>SIGTERM</Button>
          <Button variant="danger" onClick={() => { onKill(process.pid, 'SIGKILL'); onClose(); }}>SIGKILL</Button>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
