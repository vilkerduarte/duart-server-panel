import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';
import { HiOutlineFolder, HiOutlineDocument, HiOutlineTrash, HiOutlineArrowUpTray } from 'react-icons/hi2';

interface FileItem {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedAt: string;
}

interface FileListData {
  currentPath: string;
  parentPath: string | null;
  items: FileItem[];
}

export default function FilesPage() {
  const [data, setData] = useState<FileListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('/');
  const [error, setError] = useState<string | null>(null);

  function fetchFiles(path: string) {
    setLoading(true);
    setError(null);
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setData(json.data);
          setCurrentPath(json.data.currentPath);
        } else {
          setError(json.error);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchFiles('/'); }, []);

  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIcon(type: string) {
    if (type === 'directory') return <HiOutlineFolder className="w-5 h-5 text-amber-400" />;
    return <HiOutlineDocument className="w-5 h-5 text-blue-400" />;
  }

  const pathParts = currentPath === '/' ? [''] : currentPath.split('/').filter(Boolean);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Gerenciador de Arquivos</h1>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm flex-wrap">
          {pathParts.map((part, i) => {
            const pathSoFar = i === 0 ? '/' : '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
                <button
                  onClick={() => fetchFiles(pathSoFar)}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {part || '/'}
                </button>
              </span>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : error ? (
          <Card><p className="text-red-500">{error}</p></Card>
        ) : data ? (
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="p-3">Nome</th>
                    <th className="p-3">Tamanho</th>
                    <th className="p-3">Permissões</th>
                    <th className="p-3">Modificado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.parentPath !== null && (
                    <tr
                      className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      onClick={() => fetchFiles(data.parentPath!)}
                    >
                      <td className="p-3 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <HiOutlineFolder className="w-5 h-5 text-[var(--text-muted)]" />
                        ..
                      </td>
                      <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                      <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                      <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                    </tr>
                  )}
                  {data.items.map((item, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      onClick={() => item.type === 'directory' && fetchFiles(`${currentPath}/${item.name}`.replace('//', '/'))}
                    >
                      <td className="p-3 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        {getFileIcon(item.type)}
                        {item.name}
                      </td>
                      <td className="p-3 text-sm text-[var(--text-muted)]">
                        {item.type === 'directory' ? '-' : formatSize(item.size)}
                      </td>
                      <td className="p-3 text-sm text-[var(--text-muted)] font-mono">{item.permissions}</td>
                      <td className="p-3 text-sm text-[var(--text-muted)]">{new Date(item.modifiedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </AppLayout>
  );
}
