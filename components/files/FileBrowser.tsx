import { useState, useRef, useCallback, DragEvent } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  HiOutlinePlus, HiOutlineFolderPlus, HiOutlineArrowDownTray,
  HiOutlineTrash, HiOutlinePencilSquare, HiOutlineArrowUpTray,
  HiOutlineXMark, HiOutlineCheck, HiOutlineArrowPath,
  HiOutlineFolder, HiOutlineLink, HiOutlineCodeBracket,
  HiOutlineDocumentText, HiOutlinePhoto, HiOutlineArchiveBox,
  HiOutlineBolt, HiOutlineDocument, HiOutlineGlobeAlt,
  HiOutlineFolderOpen,
} from 'react-icons/hi2';

interface FileItem {
  name: string;
  type: 'directory' | 'file' | 'symlink';
  size: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedAt: string;
}

interface FileBrowserProps {
  currentPath: string;
  parentPath: string | null;
  items: FileItem[];
  onNavigate: (path: string) => void;
  onRefresh: () => void;
}

export default function FileBrowser({ currentPath, parentPath, items, onNavigate, onRefresh }: FileBrowserProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const pathParts = currentPath === '/' ? [''] : currentPath.split('/').filter(Boolean);

  // Toggle selection
  const toggleSelect = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedItems);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedItems(next);
  };

  const selectAll = () => {
    const allFiles = items.filter(i => i.type !== 'directory').map(i => i.name);
    setSelectedItems(new Set(allFiles));
  };

  const clearSelection = () => setSelectedItems(new Set());

  // Rename
  const startRename = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingItem(name);
    setRenameValue(name);
  };

  const handleRename = async () => {
    if (!renamingItem || !renameValue || renamingItem === renameValue) {
      setRenamingItem(null);
      return;
    }
    const oldFull = currentPath === '/' ? `/${renamingItem}` : `${currentPath}/${renamingItem}`;
    const newFull = currentPath === '/' ? `/${renameValue}` : `${currentPath}/${renameValue}`;
    await fetch('/api/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: oldFull, newPath: newFull }),
    });
    setRenamingItem(null);
    onRefresh();
  };

  // Delete
  const handleDelete = async () => {
    if (selectedItems.size === 0) return;
    for (const name of selectedItems) {
      const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
      const item = items.find(i => i.name === name);
      await fetch('/api/files/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: fullPath, recursive: item?.type === 'directory' }),
      });
    }
    setSelectedItems(new Set());
    setDeleteConfirm(false);
    onRefresh();
  };

  // Download
  const handleDownload = async (name: string) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    const resp = await fetch(`/api/files/read?path=${encodeURIComponent(fullPath)}`);
    const data = await resp.json();
    if (data.success && data.data?.content) {
      const blob = new Blob([data.data.content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // New folder
  const handleNewFolder = async () => {
    if (!newFolderName) return;
    const newPath = currentPath === '/' ? `/${newFolderName}` : `${currentPath}/${newFolderName}`;
    await fetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath: newPath }),
    });
    setNewFolderName('');
    setShowNewFolder(false);
    onRefresh();
  };

  // Upload files preserving directory structure via webkitRelativePath
  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    const files = Array.from(fileList);
    const total = files.length;
    let completed = 0;

    // Group files by relative path
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('destPath', currentPath);

      // Extract relative path if available (from folder drag)
      const relativePath = (file as any).webkitRelativePath || '';
      if (relativePath) {
        // Remove the file name, keep just the directory structure
        const dirPart = relativePath.split('/').slice(0, -1).join('/');
        formData.append('relativePath', dirPart);
      }

      try {
        await fetch('/api/files/upload', { method: 'POST', body: formData });
      } catch {}

      completed++;
      setUploadProgress(Math.round((completed / total) * 100));
    }

    setUploading(false);
    setUploadProgress(0);
    onRefresh();
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
      uploadFiles(dt.files);
    }
  }, [currentPath]);

  const getIcon = (type: string) => {
    const cls = 'w-4 h-4 text-[var(--text-muted)]';
    if (type === 'directory') return <HiOutlineFolder className={`${cls} text-amber-400`} />;
    if (type === 'symlink') return <HiOutlineLink className={`${cls} text-cyan-400`} />;
    const ext = type?.split('.').pop()?.toLowerCase();
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php'].includes(ext || '')) return <HiOutlineCodeBracket className={`${cls} text-yellow-400`} />;
    if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'].includes(ext || '')) return <HiOutlineDocumentText className={`${cls} text-blue-400`} />;
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext || '')) return <HiOutlinePhoto className={`${cls} text-purple-400`} />;
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext || '')) return <HiOutlineArchiveBox className={`${cls} text-orange-400`} />;
    if (['sh', 'bash', 'zsh'].includes(ext || '')) return <HiOutlineBolt className={`${cls} text-green-400`} />;
    if (['md', 'txt', 'log'].includes(ext || '')) return <HiOutlineDocument className={`${cls} text-gray-400`} />;
    if (['html', 'css', 'scss', 'less'].includes(ext || '')) return <HiOutlineGlobeAlt className={`${cls} text-sky-400`} />;
    return <HiOutlineDocument className={cls} />;
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button size="sm" variant="ghost" onClick={onRefresh}><HiOutlineArrowPath className="w-4 h-4" /> Atualizar</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(!showNewFolder)}>
          <HiOutlineFolderPlus className="w-4 h-4" /> Nova Pasta
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
          <HiOutlineArrowUpTray className="w-4 h-4" /> Upload Arquivos
        </Button>
        <Button size="sm" variant="ghost" onClick={() => folderInputRef.current?.click()}>
          <HiOutlineArrowUpTray className="w-4 h-4" /> Upload Pasta
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => uploadFiles(e.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          /* @ts-expect-error webkitdirectory is not in React types */
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={e => uploadFiles(e.target.files)}
        />

        {selectedItems.size > 0 && (
          <>
            <span className="text-xs text-[var(--text-muted)] mx-1">|</span>
            <span className="text-xs text-blue-400">{selectedItems.size} selecionado(s)</span>
            <Button size="sm" variant="ghost" onClick={() => {
              for (const n of selectedItems) handleDownload(n);
            }}>
              <HiOutlineArrowDownTray className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setDeleteConfirm(true)}>
              <HiOutlineTrash className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <HiOutlineXMark className="w-4 h-4" />
            </Button>
          </>
        )}
        {items.length > 0 && selectedItems.size === 0 && (
          <Button size="sm" variant="ghost" onClick={selectAll} className="text-xs">Selecionar Todos</Button>
        )}
      </div>

      {/* Upload Progress */}
      {uploading && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-1">
            <HiOutlineArrowUpTray className="w-4 h-4 animate-pulse" /> Enviando... {uploadProgress}%
          </div>
          <div className="w-full bg-[var(--bg-secondary)] rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* New Folder Input */}
      {showNewFolder && (
        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="Nome da pasta..."
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            className="w-48"
            onKeyDown={e => e.key === 'Enter' && handleNewFolder()}
          />
          <Button size="sm" onClick={handleNewFolder}>Criar</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(false)}>Cancelar</Button>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm mb-3 flex-wrap">
        {pathParts.map((part, i) => {
          const pathSoFar = i === 0 ? '/' : '/' + pathParts.slice(0, i + 1).join('/');
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
              <button onClick={() => onNavigate(pathSoFar)} className="text-blue-400 hover:text-blue-300">
                {part || '/'}
              </button>
            </span>
          );
        })}
      </div>

      {/* Drop Zone */}
      <div
        ref={dropRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative ${dragOver ? 'ring-2 ring-blue-500 rounded-xl' : ''}`}
      >
        {dragOver && (
          <div className="absolute inset-0 z-10 bg-blue-500/10 rounded-xl flex items-center justify-center border-2 border-dashed border-blue-400">
            <div className="text-center">
              <HiOutlineFolderOpen className="w-12 h-12 mx-auto mb-2 text-blue-400" />
              <p className="text-blue-400 font-semibold">Solte os arquivos aqui</p>
              <p className="text-xs text-[var(--text-muted)]">Pastas inteiras serão preservadas</p>
            </div>
          </div>
        )}

        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                  <th className="p-3 w-10">#</th>
                  <th className="p-3">Nome</th>
                  <th className="p-3">Tamanho</th>
                  <th className="p-3">Permissões</th>
                  <th className="p-3">Modificado</th>
                  <th className="p-3 w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {parentPath !== null && (
                  <tr
                    className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    onClick={() => onNavigate(parentPath!)}
                  >
                    <td className="p-3"></td>
                    <td className="p-3 flex items-center gap-2 text-sm"><HiOutlineFolder className="w-4 h-4 text-amber-400" /> ..</td>
                    <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                    <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                    <td className="p-3 text-sm text-[var(--text-muted)]">-</td>
                    <td className="p-3"></td>
                  </tr>
                )}
                {items.map((item, i) => (
                  <tr
                    key={i}
                    className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${
                      selectedItems.has(item.name) ? 'bg-blue-500/10' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-3" onClick={e => toggleSelect(item.name, e)}>
                      <div className={`w-4 h-4 rounded border cursor-pointer flex items-center justify-center transition-colors ${
                        selectedItems.has(item.name)
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-[var(--border-color)] hover:border-blue-400'
                      }`}>
                        {selectedItems.has(item.name) && <HiOutlineCheck className="w-3 h-3 text-white" />}
                      </div>
                    </td>

                    {/* Name */}
                    <td
                      className="p-3 cursor-pointer"
                      onClick={() => item.type === 'directory' && onNavigate(`${currentPath === '/' ? '' : currentPath}/${item.name}`)}
                    >
                      {renamingItem === item.name ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            className="w-40 text-sm"
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename();
                              if (e.key === 'Escape') setRenamingItem(null);
                            }}
                            autoFocus
                          />
                          <button onClick={handleRename} className="text-green-400"><HiOutlineCheck className="w-4 h-4" /></button>
                          <button onClick={() => setRenamingItem(null)} className="text-red-400"><HiOutlineXMark className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                          {getIcon(item.type)}{item.name}
                        </div>
                      )}
                    </td>

                    {/* Size */}
                    <td className="p-3 text-sm text-[var(--text-muted)]">
                      {item.type === 'directory' ? '-' : formatSize(item.size)}
                    </td>

                    {/* Permissions */}
                    <td className="p-3 text-sm text-[var(--text-muted)] font-mono">{item.permissions}</td>

                    {/* Modified */}
                    <td className="p-3 text-sm text-[var(--text-muted)] whitespace-nowrap">
                      {new Date(item.modifiedAt).toLocaleString()}
                    </td>

                    {/* Actions */}
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        {item.type === 'file' && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDownload(item.name); }}
                            className="p-1 text-[var(--text-muted)] hover:text-blue-400 rounded"
                            title="Download"
                          >
                            <HiOutlineArrowDownTray className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={e => startRename(item.name, e)}
                          className="p-1 text-[var(--text-muted)] hover:text-amber-400 rounded"
                          title="Renomear"
                        >
                          <HiOutlinePencilSquare className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteConfirm}
        title="Deletar Arquivos"
        message={`Tem certeza que deseja deletar ${selectedItems.size} item(ns)? Esta ação é irreversível.`}
        confirmLabel="Deletar"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteConfirm(false)}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
