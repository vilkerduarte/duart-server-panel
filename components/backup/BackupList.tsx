import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { HiOutlineDownload, HiOutlineTrash } from 'react-icons/hi';

interface BackupListProps {
  backups: any[];
  onDelete: (id: string) => void;
}

export default function BackupList({ backups, onDelete }: BackupListProps) {
  const formatSize = (b: number) => {
    if (!b) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return parseFloat((b / Math.pow(1024, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (backups.length === 0) {
    return <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum backup encontrado</p></Card>;
  }

  return (
    <div className="space-y-2">
      {backups.map((b, i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{b.name}</p>
              <p className="text-xs text-[var(--text-muted)]">{formatSize(b.size)} — {new Date(b.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost"><HiOutlineDownload className="w-4 h-4" /></Button>
              <Button size="sm" variant="danger" onClick={() => onDelete(b.id)}><HiOutlineTrash className="w-4 h-4" /></Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
