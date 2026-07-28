import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import FileBrowser from '@/components/files/FileBrowser';
import Spinner from '@/components/ui/Spinner';

interface FileListData { currentPath: string; parentPath: string | null; items: any[]; }

export default function FilesPage() {
  const [data, setData] = useState<FileListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState('/');

  function fetchFiles(p: string) {
    setLoading(true);
    setPath(p);
    fetch(`/api/files/list?path=${encodeURIComponent(p)}`)
      .then(r => r.json()).then(j => { if (j.success) setData(j.data); })
      .catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { fetchFiles('/'); }, []);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Gerenciador de Arquivos</h1>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : data ? (
          <FileBrowser currentPath={data.currentPath} parentPath={data.parentPath} items={data.items}
            onNavigate={fetchFiles} onRefresh={() => fetchFiles(path)} />
        ) : null}
      </div>
    </AppLayout>
  );
}
