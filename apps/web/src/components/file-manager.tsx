"use client";

import type { FileEntry, FileHash, FileInfo, FilePreview, OperationLog, UploadInitResult, UploadProgress } from "@file-manager/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Progress from "@radix-ui/react-progress";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Activity, ArrowDownAZ, ChevronDown, ChevronRight, Download, File, FileCode2, FileImage, FileText, Folder, FolderOpen, FolderPlus, Hash, Info, LayoutPanelLeft, LoaderCircle, LogOut, Menu, MoreHorizontal, Pencil, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, CSSProperties, DragEvent, FormEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, displayDate, formatBytes, joinPath } from "@/lib/client-api";
import { createSelectionState, shouldUseChunkedUpload, sortEntries, type SortDirection, type SortKey } from "@/lib/file-manager-utils";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/components/locale-provider";

type Modal = { type: "mkdir" | "rename" | "delete"; entry?: FileEntry } | null;
type UploadItem = { id: string; name: string; progress: number; state: "uploading" | "done" | "error"; error?: string };
type WorkspaceView = "files" | "logs";
type DetailsTab = "info" | "preview";
type ResizeSide = "sidebar" | "details";

const SIDEBAR_WIDTH = { initial: 218, min: 180, max: 360 };
const DETAILS_WIDTH = { initial: 310, min: 250, max: 500 };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function IconFor({ entry }: { entry: FileEntry }) {
  if (entry.type === "directory") return <Folder size={18} className="folder-icon" />;
  const ext = entry.name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) return <FileImage size={18} />;
  if (["js", "ts", "tsx", "jsx", "css", "html", "json"].includes(ext || "")) return <FileCode2 size={18} />;
  if (["md", "txt", "yml", "yaml"].includes(ext || "")) return <FileText size={18} />;
  return <File size={18} />;
}

export function FileManager() {
  const { locale, t } = useLocale();
  const sortLabels: Record<SortKey, string> = { name: t("name"), type: t("type"), size: t("size"), modifiedTime: t("modified") };
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
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("info");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH.initial);
  const [detailsWidth, setDetailsWidth] = useState(DETAILS_WIDTH.initial);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const resize = useRef<{ side: ResizeSide; startX: number; startWidth: number } | null>(null);

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

  const shownEntries = useMemo(() => sortEntries(entries, query, sortKey, sortDirection), [entries, query, sortKey, sortDirection]);

  const crumbs = path === "." ? [] : path.split("/").filter(Boolean);
  const selectedPath = selected ? joinPath(path, selected.name) : "";

  async function selectEntry(entry: FileEntry) {
    const selectionState = createSelectionState();
    setSelected(entry); setInfo(selectionState.info); setPreview(selectionState.preview); setHash(selectionState.hash); setDetailsOpen(true); setDetailsTab(selectionState.detailsTab);
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
        if (shouldUseChunkedUpload(file.size)) await uploadLarge(file, update); else await uploadSmall(file);
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

  function startResize(event: PointerEvent<HTMLDivElement>, side: ResizeSide) {
    resize.current = { side, startX: event.clientX, startWidth: side === "sidebar" ? sidebarWidth : detailsWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizePanels(event: PointerEvent<HTMLDivElement>) {
    if (!resize.current) return;
    const delta = event.clientX - resize.current.startX;
    if (resize.current.side === "sidebar") {
      setSidebarWidth(clamp(resize.current.startWidth + delta, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max));
    } else {
      setDetailsWidth(clamp(resize.current.startWidth - delta, DETAILS_WIDTH.min, DETAILS_WIDTH.max));
    }
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>, side: ResizeSide) {
    const bounds = side === "sidebar" ? SIDEBAR_WIDTH : DETAILS_WIDTH;
    const setWidth = side === "sidebar" ? setSidebarWidth : setDetailsWidth;
    if (event.key === "Home") { event.preventDefault(); setWidth(bounds.min); return; }
    if (event.key === "End") { event.preventDefault(); setWidth(bounds.max); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    const delta = event.key === "ArrowRight" ? step : -step;
    setWidth((width) => clamp(width + (side === "sidebar" ? delta : -delta), bounds.min, bounds.max));
  }

  const sidebar = <>
    <div className="brand"><div className="brand-mark small"><span /><span /><span /></div><div><strong>Node FS</strong><small>Explorer</small></div></div>
    <nav className="side-nav" aria-label={t("fileSpace")}>
      <button className={workspaceView === "files" ? "active" : ""} onClick={() => { void loadDirectory("."); setMobileNav(false); }}><FolderOpen size={17} />{t("fileSpace")}</button>
      <button className={workspaceView === "logs" ? "active" : ""} onClick={() => { void loadLogs(); setMobileNav(false); }}><Activity size={17} />{t("activityLog")} {logs.length > 0 ? `(${logs.length})` : ""}</button>
    </nav>
    <div className="side-section"><span>{t("location")}</span><button onClick={() => void loadDirectory(".")}><Folder size={16} />{t("projectRoot")}</button><button onClick={() => void loadDirectory("uploads")}><Upload size={16} />{t("uploads")}</button></div>
    <div className="sidebar-footer"><button onClick={logout}><LogOut size={16} />{t("logout")}</button></div>
  </>;

  return (
    <Toast.Provider swipeDirection="right">
      <Tooltip.Provider delayDuration={300}>
        <main className="workspace" style={{ "--sidebar-width": `${sidebarWidth}px`, "--details-width": `${detailsWidth}px` } as CSSProperties} onDragOver={(e) => e.preventDefault()} onDrop={drop}>
          <aside className="sidebar desktop-only">{sidebar}</aside>
          <div className="resize-handle resize-handle-sidebar" role="separator" aria-orientation="vertical" aria-label={t("fileSpace")} aria-valuemin={SIDEBAR_WIDTH.min} aria-valuemax={SIDEBAR_WIDTH.max} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={(event) => startResize(event, "sidebar")} onPointerMove={resizePanels} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={(event) => resizeWithKeyboard(event, "sidebar")} />
          <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="mobile-drawer"><Dialog.Title className="sr-only">导航</Dialog.Title>{sidebar}</Dialog.Content></Dialog.Portal></Dialog.Root>
          <section className="browser-panel">
            <header className="topbar">
              <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label={t("openNavigation")}><Menu size={19} /></button>
              <div className="path-rail">
                <button onClick={() => void loadDirectory(".")}><FolderOpen size={16} /><span>root</span></button>
                {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={14} /><button onClick={() => void loadDirectory(crumbs.slice(0, index + 1).join("/"))}>{crumb}</button></span>)}
              </div>
              <Tooltip.Root><Tooltip.Trigger asChild><button className="icon-button" onClick={() => void loadDirectory()} aria-label={t("refresh")}><RefreshCw size={17} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip">{t("refresh")}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
              <LanguageSwitcher />
              <button className="icon-button details-toggle" onClick={() => setDetailsOpen((v) => !v)} aria-label={t("toggleDetails")}><LayoutPanelLeft size={18} /></button>
              <Tooltip.Root><Tooltip.Trigger asChild><button className="icon-button" onClick={() => void logout()} aria-label={t("logout")}><LogOut size={17} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip">{t("logout")}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
            </header>
            {workspaceView === "files" ? <><div className="commandbar">
              <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("filter")} /><kbd>⌘ K</kbd></div>
              <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="secondary-button"><ArrowDownAZ size={16} /><span>{t("sort")}: {sortLabels[sortKey]} ({sortDirection === "asc" ? t("asc") : t("desc")})</span><ChevronDown size={14} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end">{(["name", "type", "size", "modifiedTime"] as SortKey[]).map((key) => <DropdownMenu.Item key={key} onSelect={() => { if (key === sortKey) setSortDirection((direction) => direction === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDirection(key === "modifiedTime" ? "desc" : "asc"); } }}>{sortLabels[key]}{key === sortKey ? ` (${sortDirection === "asc" ? t("asc") : t("desc")})` : ""}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
              <button className="secondary-button compact-action" onClick={() => setModal({ type: "mkdir" })}><FolderPlus size={16} /><span>{t("newFolder")}</span></button>
              <button className="primary-button compact-action" onClick={() => fileInput.current?.click()}><Upload size={16} /><span>{t("upload")}</span></button>
              <input ref={fileInput} type="file" multiple hidden onChange={choose} />
            </div>
            <div className="file-area">
              <div className="table-head"><span>{t("name")}</span><span>{t("size")}</span><span>{t("modified")}</span><span /></div>
              {loading ? <div className="state"><LoaderCircle className="spin" />{t("loadingDirectory")}</div> : error ? <div className="state error-state"><strong>{t("directoryFailed")}</strong><span>{error}</span><button onClick={() => void loadDirectory()}>{t("retry")}</button></div> : shownEntries.length === 0 ? <div className="state"><FolderOpen size={32} /><strong>{t("emptyFolder")}</strong><span>{t("dropFiles")}</span></div> : <div className="file-list">{shownEntries.map((entry) => <div key={entry.name} className={`file-row ${selected?.name === entry.name ? "selected" : ""}`} onClick={() => void selectEntry(entry)} onDoubleClick={() => { if (entry.type === "directory") void loadDirectory(joinPath(path, entry.name)); }} tabIndex={0} onKeyDown={(event) => { if (event.key !== "Enter") return; if (entry.type === "directory") void loadDirectory(joinPath(path, entry.name)); else void selectEntry(entry); }}><span className="file-name"><IconFor entry={entry} /><span><strong>{entry.name}</strong><small>{entry.type === "directory" ? t("folder") : entry.name.split(".").pop()?.toUpperCase() || t("file")}</small></span></span><span>{entry.type === "directory" ? "-" : formatBytes(entry.size)}</span><span>{displayDate(entry.modifiedTime)}</span><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="row-action" onClick={(e) => e.stopPropagation()} aria-label={t("fileAction", { name: entry.name })}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end"><DropdownMenu.Item onSelect={() => void selectEntry(entry)}><Info size={15} />{t("viewDetails")}</DropdownMenu.Item>{entry.type === "file" && <DropdownMenu.Item onSelect={() => window.location.href = `/api/backend/files/download?path=${encodeURIComponent(joinPath(path, entry.name))}`}><Download size={15} />{t("download")}</DropdownMenu.Item>}<DropdownMenu.Item onSelect={() => setModal({ type: "rename", entry })}><Pencil size={15} />{t("rename")}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item className="danger" onSelect={() => setModal({ type: "delete", entry })}><Trash2 size={15} />{t("delete")}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>)}</div>}
            </div>
            <footer className="statusbar"><span>{t("items", { count: shownEntries.length })}</span><span>{t("projectRoot")}</span></footer></> : <><div className="logs-toolbar"><div><Activity size={18} /><span><strong>{t("activityTitle")}</strong><small>{t("recentActivity")}</small></span></div><button className="icon-button" onClick={() => void loadLogs()} aria-label={t("refreshActivity")}><RefreshCw size={17} /></button></div><div className="file-area log-area">{loading ? <div className="state"><LoaderCircle className="spin" />{t("loadingActivity")}</div> : error ? <div className="state error-state"><strong>{t("activityFailed")}</strong><span>{error}</span><button onClick={() => void loadLogs()}>{t("retry")}</button></div> : logs.length === 0 ? <div className="state"><Activity size={32} /><strong>{t("emptyActivity")}</strong><span>{t("activityAppears")}</span></div> : <div className="log-list">{[...logs].reverse().map((log, index) => <article className="log-row" key={`${log.timestamp}-${log.operation}-${log.path}-${index}`}><span className="log-icon"><Activity size={16} /></span><div><strong>{log.operation}</strong><code>{log.path || "."}</code></div><time dateTime={log.timestamp}>{displayDate(log.timestamp)}</time></article>)}</div>}</div><footer className="statusbar"><span>{t("records", { count: logs.length })}</span><span>{t("memoryOnly")}</span></footer></>}
          </section>
          <div className="resize-handle resize-handle-details" role="separator" aria-orientation="vertical" aria-label={t("details")} aria-valuemin={DETAILS_WIDTH.min} aria-valuemax={DETAILS_WIDTH.max} aria-valuenow={detailsWidth} tabIndex={0} onPointerDown={(event) => startResize(event, "details")} onPointerMove={resizePanels} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={(event) => resizeWithKeyboard(event, "details")} />
          {detailsOpen && <aside className="details-panel"><div className="details-title"><div><span className="large-file-icon">{selected ? <IconFor entry={selected} /> : <Info size={21} />}</span><div><strong>{selected?.name || t("details")}</strong><small>{selected ? selectedPath : t("selectItem")}</small></div></div><button className="icon-button" onClick={() => setDetailsOpen(false)} aria-label={t("closeDetails")}><X size={17} /></button></div>{selected ? <Tabs.Root value={detailsTab} onValueChange={(value) => { const nextTab = value as DetailsTab; setDetailsTab(nextTab); if (nextTab === "preview") void loadPreview(); }}><Tabs.List className="tabs"><Tabs.Trigger value="info">{t("info")}</Tabs.Trigger>{selected.type === "file" && <Tabs.Trigger value="preview">{t("preview")}</Tabs.Trigger>}</Tabs.List><Tabs.Content value="info" className="tab-content">{info ? <dl className="metadata"><div><dt>{t("type")}</dt><dd>{info.type === "directory" ? t("folder") : t("file")}</dd></div><div><dt>{t("size")}</dt><dd>{formatBytes(info.size)}</dd></div><div><dt>{t("permissions")}</dt><dd className="mono">{info.permissions}</dd></div><div><dt>{t("modified")}</dt><dd>{new Date(info.modifiedTime).toLocaleString(locale)}</dd></div><div><dt>{t("fullPath")}</dt><dd className="mono path-value">{info.fullPath}</dd></div></dl> : <div className="state mini"><LoaderCircle className="spin" /></div>}{selected.type === "file" && <><button className="secondary-button full" onClick={loadHash}><Hash size={15} />{t("hash")}</button>{hash && <div className="hash-box"><span>SHA-256</span><code>{hash.hash}</code></div>}<a className="primary-button full" href={`/api/backend/files/download?path=${encodeURIComponent(selectedPath)}`}><Download size={16} />{t("download")}</a></>}</Tabs.Content>{selected.type === "file" && <Tabs.Content value="preview" className="preview-pane">{!preview ? <div className="state mini"><LoaderCircle className="spin" /></div> : preview.type === "image" ? <img /* eslint-disable-line @next/next/no-img-element -- data URL is returned by the API */ src={preview.content} alt={selected.name} /> : <pre>{preview.content}</pre>}</Tabs.Content>}</Tabs.Root> : <div className="empty-detail"><File size={36} /><p>{t("selectItem")}</p></div>}</aside>}
          {uploads.length > 0 && <div className="upload-tray"><div className="tray-title"><strong>{t("uploadQueue")}</strong><button onClick={() => setUploads((items) => items.filter((item) => item.state === "uploading"))}><X size={15} /></button></div>{uploads.slice(-4).map((item) => <div className="upload-item" key={item.id}><div><span>{item.name}</span><small>{item.state === "error" ? item.error : item.state === "done" ? t("uploadComplete") : `${item.progress}%`}</small></div><Progress.Root className="progress" value={item.progress}><Progress.Indicator style={{ transform: `translateX(-${100 - item.progress}%)` }} /></Progress.Root></div>)}</div>}
          <Dialog.Root open={!!modal} onOpenChange={(open) => !open && setModal(null)}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><Dialog.Title>{modal?.type === "mkdir" ? t("createFolder") : modal?.type === "rename" ? t("renameItem") : t("deleteItem")}</Dialog.Title><Dialog.Description>{modal?.type === "delete" ? t("deleteWarning", { name: modal.entry?.name || "" }) : modal?.type === "rename" ? t("renamePrompt") : t("createPrompt")}</Dialog.Description><form onSubmit={handleModal}>{modal?.type !== "delete" && <input name="name" defaultValue={modal?.entry?.name || ""} autoFocus required />}<div className="dialog-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close><button className={modal?.type === "delete" ? "danger-button" : "primary-button"}>{modal?.type === "delete" ? t("confirmDelete") : t("save")}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
          <Toast.Root className="toast" open={!!toast} onOpenChange={(open) => !open && setToast("")} duration={4000}><Toast.Title>{toast}</Toast.Title></Toast.Root><Toast.Viewport className="toast-viewport" />
        </main>
      </Tooltip.Provider>
    </Toast.Provider>
  );
}
