import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import { HiOutlinePlus, HiOutlineFolderPlus } from 'react-icons/hi2';

interface FileBrowserProps {
  currentPath: string;
  parentPath: string | null;
  items: any[];
  onNavigate: (path: string) => void;
  onRefresh: () => void;
}

export default function FileBrowser({ currentPath, parentPath, items, onNavigate, onRefresh }: FileBrowserProps) {
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const pathParts = currentPath === '/' ? [''] : currentPath.split('/').filter(Boolean);

  const handleNewFolder = async () => {
    if (!newFolderName) return;
    const newPath = currentPath === '/' ? `/${newFolderName}` : `${currentPath}/${newFolderName}`;
    await fetch('/api/files/mkdir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath: newPath }),
    });
    setNewFolderName('');
    setShowNewFolder(false);
    onRefresh();
  };

  const getIcon = (type: string) => {
    if (type === 'directory') return '📁';
    if (type === 'symlink') return '🔗';
    const ext = type?.split('.').pop()?.toLowerCase();
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php'].includes(ext || '')) return '📜';
    if (['json', 'xml', 'yaml', 'yml'].includes(ext || '')) return '📋';
    if (['jpg', 'png', 'gif', 'svg', 'webp'].includes(ext || '')) return '🖼️';
    if (['zip', 'tar', 'gz', 'rar'].includes(ext || '')) return '📦';
    return '📄';
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button size="sm" variant="ghost" onClick={onRefresh}>🔄 Atualizar</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(!showNewFolder)}>
          <HiOutlineFolderPlus className="w-4 h-4" /> Nova Pasta
        </Button>
      </div>

      {showNewFolder && (
        <div className="flex items-center gap-2 mb-3">
          <Input placeholder="Nome da pasta..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} className="w-48" />
          <Button size="sm" onClick={handleNewFolder}>Criar</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(false)}>Cancelar</Button>
        </div>
      )}

      <div className="flex items-center gap-1 text-sm mb-3 flex-wrap">
        {pathParts.map((part, i) => {
          const pathSoFar = i === 0 ? '/' : '/' + pathParts.slice(0, i + 1).join('/');
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
              <button onClick={() => onNavigate(pathSoFar)} className="text-blue-400 hover:text-blue-300">{part || '/'}</button>
            </span>
          );
        })}
      </div>

      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                <th className="p-3">Nome</th><th className="p-3">Tamanho</th><th className="p-3">Permissões</th><th className="p-3">Modificado</th>
              </tr>
            </thead>
            <tbody>
              {parentPath !== null && (
                <tr className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => onNavigate(parentPath!)}>
                  <td className="p-3 flex items-center gap-2 text-sm">📁 ..</td>
                  <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                  <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                  <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                </tr>
              )}
              {items.map((item, i) => (
                <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => item.type === 'directory' && onNavigate(`${currentPath === '/' ? '' : currentPath}/${item.name}`)}>
                  <td className="p-3 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    {getIcon(item.type)}{item.name}
                  </td>
                  <td className="p-3 text-sm text-[var(--text-muted)]">{item.type === 'directory' ? '-' : formatSize(item.size)}</td>
                  <td className="p-3 text-sm text-[var(--text-muted)] font-mono">{item.permissions}</td>
                  <td className="p-3 text-sm text-[var(--text-muted)]">{new Date(item.modifiedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
