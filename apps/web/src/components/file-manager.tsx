"use client";

import type { FileEntry, FileHash, FileInfo, FilePreview, OperationLog, UploadInitResult, UploadProgress } from "@file-manager/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Progress from "@radix-ui/react-progress";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Activity, ArrowDownAZ, ChevronDown, ChevronRight, Download, File, FileCode2, FileImage, FileText, Folder, FolderOpen, FolderPlus, Hash, Info, LayoutPanelLeft, LoaderCircle, LogOut, Menu, MoreHorizontal, Pencil, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, displayDate, formatBytes, joinPath } from "@/lib/client-api";

type SortKey = "name" | "type" | "size" | "modifiedTime";
type Modal = { type: "mkdir" | "rename" | "delete"; entry?: FileEntry } | null;
type UploadItem = { id: string; name: string; progress: number; state: "uploading" | "done" | "error"; error?: string };
type WorkspaceView = "files" | "logs";
type DetailsTab = "info" | "preview";

function IconFor({ entry }: { entry: FileEntry }) {
  if (entry.type === "directory") return <Folder size={18} className="folder-icon" />;
  const ext = entry.name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) return <FileImage size={18} />;
  if (["js", "ts", "tsx", "jsx", "css", "html", "json"].includes(ext || "")) return <FileCode2 size={18} />;
  if (["md", "txt", "yml", "yaml"].includes(ext || "")) return <FileText size={18} />;
  return <File size={18} />;
}

export function FileManager() {
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [hash, setHash] = useState<FileHash | null>(null);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("files");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("info");
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(async (nextPath = path) => {
    setWorkspaceView("files");
    setLoading(true); setError("");
    try {
      const data = await api<FileEntry[]>(`/files?path=${encodeURIComponent(nextPath)}`);
      setEntries(data); setPath(nextPath); setSelected(null); setInfo(null); setPreview(null); setHash(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "目录加载失败"); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => { void loadDirectory("."); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shownEntries = useMemo(() => [...entries]
    .filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      if (sortKey === "size") return (a.size || 0) - (b.size || 0);
      return String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""), "zh-CN", { numeric: true });
    }), [entries, query, sortKey]);

  const crumbs = path === "." ? [] : path.split("/").filter(Boolean);
  const selectedPath = selected ? joinPath(path, selected.name) : "";

  async function selectEntry(entry: FileEntry) {
    setSelected(entry); setInfo(null); setPreview(null); setHash(null); setDetailsOpen(true); setDetailsTab("info");
    try { setInfo(await api<FileInfo>(`/files/info?path=${encodeURIComponent(joinPath(path, entry.name))}`)); }
    catch (reason) { setToast(reason instanceof Error ? reason.message : "详情加载失败"); }
  }

  async function loadPreview() {
    if (!selected || selected.type !== "file") return;
    try { setPreview(await api<FilePreview>(`/files/preview?path=${encodeURIComponent(selectedPath)}&lines=80`)); }
    catch (reason) { setToast(reason instanceof Error ? reason.message : "无法预览文件"); }
  }

  async function loadHash() {
    if (!selected || selected.type !== "file") return;
    try { setHash(await api<FileHash>(`/files/hash?path=${encodeURIComponent(selectedPath)}&algorithm=sha256`)); }
    catch (reason) { setToast(reason instanceof Error ? reason.message : "哈希计算失败"); }
  }

  async function loadLogs() {
    setWorkspaceView("logs"); setLoading(true); setError("");
    try { setLogs(await api<OperationLog[]>("/files/logs?max=50")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "日志加载失败"); }
    finally { setLoading(false); }
  }

  async function handleModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);
    try {
      if (modal.type === "mkdir") {
        await api("/files/mkdir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: joinPath(path, String(data.get("name"))) }) });
        setToast("文件夹已创建");
      } else if (modal.type === "rename" && modal.entry) {
        await api("/files/move", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ src: joinPath(path, modal.entry.name), dst: joinPath(path, String(data.get("name"))) }) });
        setToast("名称已更新");
      } else if (modal.type === "delete" && modal.entry) {
        await api(`/files?path=${encodeURIComponent(joinPath(path, modal.entry.name))}`, { method: "DELETE" });
        setToast("项目已删除");
      }
      setModal(null); await loadDirectory();
    } catch (reason) { setToast(reason instanceof Error ? reason.message : "操作失败"); }
  }

  async function uploadSmall(file: globalThis.File) {
    const form = new FormData(); form.append("path", path); form.append("file", file);
    await api("/files/upload", { method: "POST", body: form });
  }

  async function uploadLarge(file: globalThis.File, update: (value: number) => void) {
    const chunkSize = 2 * 1024 * 1024;
    const init = await api<UploadInitResult>("/files/upload/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, chunkSize, targetDir: path }) });
    if (init.instant || !init.uploadId || !init.totalChunks) return;
    for (let index = 0; index < init.totalChunks; index++) {
      const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
      await api<UploadProgress>(`/files/upload/chunk?uploadId=${init.uploadId}&chunkIndex=${index}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: chunk });
      update(Math.round(((index + 1) / init.totalChunks) * 95));
    }
    await api("/files/upload/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: init.uploadId }) });
  }

  async function addFiles(files: FileList | globalThis.File[]) {
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      setUploads((items) => [...items, { id, name: file.name, progress: 4, state: "uploading" }]);
      const update = (progress: number) => setUploads((items) => items.map((item) => item.id === id ? { ...item, progress } : item));
      try {
        if (file.size > 20 * 1024 * 1024) await uploadLarge(file, update); else await uploadSmall(file);
        setUploads((items) => items.map((item) => item.id === id ? { ...item, progress: 100, state: "done" } : item));
      } catch (reason) {
        setUploads((items) => items.map((item) => item.id === id ? { ...item, state: "error", error: reason instanceof Error ? reason.message : "上传失败" } : item));
      }
    }
    await loadDirectory();
  }

  function drop(event: DragEvent) { event.preventDefault(); if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files); }
  function choose(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }

  async function logout() { await fetch("/api/session/logout", { method: "POST" }); window.location.href = "/login"; }

  const sidebar = <>
    <div className="brand"><div className="brand-mark small"><span /><span /><span /></div><div><strong>Node FS</strong><small>Explorer</small></div></div>
    <nav className="side-nav" aria-label="主导航">
      <button className={workspaceView === "files" ? "active" : ""} onClick={() => { void loadDirectory("."); setMobileNav(false); }}><FolderOpen size={17} />文件空间</button>
      <button className={workspaceView === "logs" ? "active" : ""} onClick={() => { void loadLogs(); setMobileNav(false); }}><Activity size={17} />操作记录 {logs.length > 0 ? `(${logs.length})` : ""}</button>
    </nav>
    <div className="side-section"><span>位置</span><button onClick={() => void loadDirectory(".")}><Folder size={16} />项目根目录</button><button onClick={() => void loadDirectory("uploads")}><Upload size={16} />上传目录</button></div>
    <div className="sidebar-footer"><button onClick={logout}><LogOut size={16} />退出登录</button></div>
  </>;

  return (
    <Toast.Provider swipeDirection="right">
      <Tooltip.Provider delayDuration={300}>
        <main className="workspace" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
          <aside className="sidebar desktop-only">{sidebar}</aside>
          <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="mobile-drawer"><Dialog.Title className="sr-only">导航</Dialog.Title>{sidebar}</Dialog.Content></Dialog.Portal></Dialog.Root>
          <section className="browser-panel">
            <header className="topbar">
              <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={19} /></button>
              <div className="path-rail">
                <button onClick={() => void loadDirectory(".")}><FolderOpen size={16} /><span>root</span></button>
                {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={14} /><button onClick={() => void loadDirectory(crumbs.slice(0, index + 1).join("/"))}>{crumb}</button></span>)}
              </div>
              <Tooltip.Root><Tooltip.Trigger asChild><button className="icon-button" onClick={() => void loadDirectory()} aria-label="刷新"><RefreshCw size={17} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip">刷新目录</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
              <button className="icon-button details-toggle" onClick={() => setDetailsOpen((v) => !v)} aria-label="切换详情面板"><LayoutPanelLeft size={18} /></button>
            </header>
            {workspaceView === "files" ? <><div className="commandbar">
              <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="筛选当前目录" /><kbd>⌘ K</kbd></div>
              <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="secondary-button"><ArrowDownAZ size={16} />排序<ChevronDown size={14} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end">{(["name", "type", "size", "modifiedTime"] as SortKey[]).map((key) => <DropdownMenu.Item key={key} onSelect={() => setSortKey(key)}>{({name:"名称",type:"类型",size:"大小",modifiedTime:"修改时间"})[key]}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
              <button className="secondary-button compact-action" onClick={() => setModal({ type: "mkdir" })}><FolderPlus size={16} /><span>新建文件夹</span></button>
              <button className="primary-button compact-action" onClick={() => fileInput.current?.click()}><Upload size={16} /><span>上传</span></button>
              <input ref={fileInput} type="file" multiple hidden onChange={choose} />
            </div>
            <div className="file-area">
              <div className="table-head"><span>名称</span><span>大小</span><span>修改时间</span><span /></div>
              {loading ? <div className="state"><LoaderCircle className="spin" />正在读取目录</div> : error ? <div className="state error-state"><strong>目录加载失败</strong><span>{error}</span><button onClick={() => void loadDirectory()}>重试</button></div> : shownEntries.length === 0 ? <div className="state"><FolderOpen size={32} /><strong>这里还没有文件</strong><span>拖放文件到此处，或创建一个文件夹。</span></div> : <div className="file-list">{shownEntries.map((entry) => <div key={entry.name} className={`file-row ${selected?.name === entry.name ? "selected" : ""}`} onClick={() => void selectEntry(entry)} onDoubleClick={() => { if (entry.type === "directory") void loadDirectory(joinPath(path, entry.name)); }} tabIndex={0} onKeyDown={(event) => { if (event.key !== "Enter") return; if (entry.type === "directory") void loadDirectory(joinPath(path, entry.name)); else void selectEntry(entry); }}><span className="file-name"><IconFor entry={entry} /><span><strong>{entry.name}</strong><small>{entry.type === "directory" ? "文件夹" : entry.name.split(".").pop()?.toUpperCase() || "文件"}</small></span></span><span>{entry.type === "directory" ? "-" : formatBytes(entry.size)}</span><span>{displayDate(entry.modifiedTime)}</span><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="row-action" onClick={(e) => e.stopPropagation()} aria-label={`${entry.name}操作`}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end"><DropdownMenu.Item onSelect={() => void selectEntry(entry)}><Info size={15} />查看详情</DropdownMenu.Item>{entry.type === "file" && <DropdownMenu.Item onSelect={() => window.location.href = `/api/backend/files/download?path=${encodeURIComponent(joinPath(path, entry.name))}`}><Download size={15} />下载</DropdownMenu.Item>}<DropdownMenu.Item onSelect={() => setModal({ type: "rename", entry })}><Pencil size={15} />重命名</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item className="danger" onSelect={() => setModal({ type: "delete", entry })}><Trash2 size={15} />删除</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>)}</div>}
            </div>
            <footer className="statusbar"><span>{shownEntries.length} 个项目</span><span>文件根目录受服务端路径策略保护</span></footer></> : <><div className="logs-toolbar"><div><Activity size={18} /><span><strong>操作记录</strong><small>最近 50 条文件系统操作</small></span></div><button className="icon-button" onClick={() => void loadLogs()} aria-label="刷新操作记录"><RefreshCw size={17} /></button></div><div className="file-area log-area">{loading ? <div className="state"><LoaderCircle className="spin" />正在读取操作记录</div> : error ? <div className="state error-state"><strong>操作记录加载失败</strong><span>{error}</span><button onClick={() => void loadLogs()}>重试</button></div> : logs.length === 0 ? <div className="state"><Activity size={32} /><strong>暂时没有操作记录</strong><span>文件操作会显示在这里。</span></div> : <div className="log-list">{[...logs].reverse().map((log, index) => <article className="log-row" key={`${log.timestamp}-${log.operation}-${log.path}-${index}`}><span className="log-icon"><Activity size={16} /></span><div><strong>{log.operation}</strong><code>{log.path || "."}</code></div><time dateTime={log.timestamp}>{displayDate(log.timestamp)}</time></article>)}</div>}</div><footer className="statusbar"><span>{logs.length} 条记录</span><span>记录仅保存在当前服务进程内</span></footer></>}
          </section>
          {detailsOpen && <aside className="details-panel"><div className="details-title"><div><span className="large-file-icon">{selected ? <IconFor entry={selected} /> : <Info size={21} />}</span><div><strong>{selected?.name || "项目详情"}</strong><small>{selected ? selectedPath : "选择一个项目查看信息"}</small></div></div><button className="icon-button" onClick={() => setDetailsOpen(false)} aria-label="关闭详情"><X size={17} /></button></div>{selected ? <Tabs.Root value={detailsTab} onValueChange={(value) => { const nextTab = value as DetailsTab; setDetailsTab(nextTab); if (nextTab === "preview") void loadPreview(); }}><Tabs.List className="tabs"><Tabs.Trigger value="info">信息</Tabs.Trigger>{selected.type === "file" && <Tabs.Trigger value="preview">预览</Tabs.Trigger>}</Tabs.List><Tabs.Content value="info" className="tab-content">{info ? <dl className="metadata"><div><dt>类型</dt><dd>{info.type === "directory" ? "文件夹" : "文件"}</dd></div><div><dt>大小</dt><dd>{formatBytes(info.size)}</dd></div><div><dt>权限</dt><dd className="mono">{info.permissions}</dd></div><div><dt>修改时间</dt><dd>{new Date(info.modifiedTime).toLocaleString("zh-CN")}</dd></div><div><dt>完整路径</dt><dd className="mono path-value">{info.fullPath}</dd></div></dl> : <div className="state mini"><LoaderCircle className="spin" /></div>}{selected.type === "file" && <><button className="secondary-button full" onClick={loadHash}><Hash size={15} />计算 SHA-256</button>{hash && <div className="hash-box"><span>SHA-256</span><code>{hash.hash}</code></div>}<a className="primary-button full" href={`/api/backend/files/download?path=${encodeURIComponent(selectedPath)}`}><Download size={16} />下载文件</a></>}</Tabs.Content>{selected.type === "file" && <Tabs.Content value="preview" className="preview-pane">{!preview ? <div className="state mini"><LoaderCircle className="spin" /></div> : preview.type === "image" ? <img /* eslint-disable-line @next/next/no-img-element -- data URL is returned by the API */ src={preview.content} alt={selected.name} /> : <pre>{preview.content}</pre>}</Tabs.Content>}</Tabs.Root> : <div className="empty-detail"><File size={36} /><p>单击文件查看详情，双击文件夹进入目录。</p></div>}</aside>}
          {uploads.length > 0 && <div className="upload-tray"><div className="tray-title"><strong>上传队列</strong><button onClick={() => setUploads((items) => items.filter((item) => item.state === "uploading"))}><X size={15} /></button></div>{uploads.slice(-4).map((item) => <div className="upload-item" key={item.id}><div><span>{item.name}</span><small>{item.state === "error" ? item.error : item.state === "done" ? "上传完成" : `${item.progress}%`}</small></div><Progress.Root className="progress" value={item.progress}><Progress.Indicator style={{ transform: `translateX(-${100 - item.progress}%)` }} /></Progress.Root></div>)}</div>}
          <Dialog.Root open={!!modal} onOpenChange={(open) => !open && setModal(null)}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><Dialog.Title>{modal?.type === "mkdir" ? "新建文件夹" : modal?.type === "rename" ? "重命名" : "删除项目"}</Dialog.Title><Dialog.Description>{modal?.type === "delete" ? `“${modal.entry?.name}”将被永久删除，此操作无法撤销。` : modal?.type === "rename" ? "输入新的文件或文件夹名称。" : "文件夹将创建在当前目录。"}</Dialog.Description><form onSubmit={handleModal}>{modal?.type !== "delete" && <input name="name" defaultValue={modal?.entry?.name || ""} autoFocus required />}<div className="dialog-actions"><Dialog.Close asChild><button type="button" className="secondary-button">取消</button></Dialog.Close><button className={modal?.type === "delete" ? "danger-button" : "primary-button"}>{modal?.type === "delete" ? "确认删除" : "保存"}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
          <Toast.Root className="toast" open={!!toast} onOpenChange={(open) => !open && setToast("")} duration={4000}><Toast.Title>{toast}</Toast.Title></Toast.Root><Toast.Viewport className="toast-viewport" />
        </main>
      </Tooltip.Provider>
    </Toast.Provider>
  );
}
