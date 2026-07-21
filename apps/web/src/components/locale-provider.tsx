"use client";

import { ReactNode, createContext, useContext, useEffect, useSyncExternalStore } from "react";

export type Locale = "en" | "zh-CN";

export const messages: Record<Locale, Record<string, string>> = {
  en: {
    "language": "Language", "english": "English", "chinese": "Chinese",
    "fileSpace": "Files", "activityLog": "Activity", "location": "Locations", "projectRoot": "Project root", "uploads": "Uploads", "logout": "Sign out",
    "refresh": "Refresh", "toggleDetails": "Toggle details", "filter": "Filter current folder", "sort": "Sort", "asc": "Ascending", "desc": "Descending", "newFolder": "New folder", "upload": "Upload",
    "name": "Name", "size": "Size", "modified": "Modified", "folder": "Folder", "file": "File", "items": "{count} items", "records": "{count} records",
    "loadingDirectory": "Loading directory", "directoryFailed": "Unable to load directory", "retry": "Retry", "emptyFolder": "This folder is empty", "dropFiles": "Drop files here or create a folder.",
    "activityTitle": "Activity", "recentActivity": "Last 50 file operations", "refreshActivity": "Refresh activity", "loadingActivity": "Loading activity", "activityFailed": "Unable to load activity", "emptyActivity": "No activity yet", "activityAppears": "File operations will appear here.", "memoryOnly": "Activity is stored in the current server process.",
    "details": "Details", "selectItem": "Select an item to view details", "closeDetails": "Close details", "info": "Info", "preview": "Preview", "type": "Type", "permissions": "Permissions", "fullPath": "Full path", "hash": "Calculate SHA-256", "download": "Download",
    "viewDetails": "View details", "rename": "Rename", "delete": "Delete", "fileAction": "Actions for {name}", "openNavigation": "Open navigation",
    "createFolder": "New folder", "renameItem": "Rename", "deleteItem": "Delete item", "deleteWarning": "“{name}” will be permanently deleted. This cannot be undone.", "renamePrompt": "Enter a new file or folder name.", "createPrompt": "The folder will be created in the current directory.", "cancel": "Cancel", "save": "Save", "confirmDelete": "Delete",
    "uploadQueue": "Upload queue", "uploading": "Uploading", "uploadComplete": "Upload complete", "loginTitle": "Sign in to file workspace", "loginHint": "Use an account configured in the file service.", "username": "Username", "password": "Password", "demoAccount": "Use demo account", "signIn": "Sign in", "verifying": "Verifying...",
  },
  "zh-CN": {
    "language": "语言", "english": "英文", "chinese": "中文",
    "fileSpace": "文件空间", "activityLog": "操作记录", "location": "位置", "projectRoot": "项目根目录", "uploads": "上传目录", "logout": "退出登录",
    "refresh": "刷新", "toggleDetails": "切换详情面板", "filter": "筛选当前目录", "sort": "排序", "asc": "升序", "desc": "降序", "newFolder": "新建文件夹", "upload": "上传",
    "name": "名称", "size": "大小", "modified": "修改时间", "folder": "文件夹", "file": "文件", "items": "{count} 个项目", "records": "{count} 条记录",
    "loadingDirectory": "正在读取目录", "directoryFailed": "目录加载失败", "retry": "重试", "emptyFolder": "这里还没有文件", "dropFiles": "拖放文件到此处，或创建一个文件夹。",
    "activityTitle": "操作记录", "recentActivity": "最近 50 条文件系统操作", "refreshActivity": "刷新操作记录", "loadingActivity": "正在读取操作记录", "activityFailed": "操作记录加载失败", "emptyActivity": "暂时没有操作记录", "activityAppears": "文件操作会显示在这里。", "memoryOnly": "记录仅保存在当前服务进程内",
    "details": "项目详情", "selectItem": "选择一个项目查看信息", "closeDetails": "关闭详情", "info": "信息", "preview": "预览", "type": "类型", "permissions": "权限", "fullPath": "完整路径", "hash": "计算 SHA-256", "download": "下载文件",
    "viewDetails": "查看详情", "rename": "重命名", "delete": "删除", "fileAction": "{name}操作", "openNavigation": "打开导航",
    "createFolder": "新建文件夹", "renameItem": "重命名", "deleteItem": "删除项目", "deleteWarning": "“{name}”将被永久删除，此操作无法撤销。", "renamePrompt": "输入新的文件或文件夹名称。", "createPrompt": "文件夹将创建在当前目录。", "cancel": "取消", "save": "保存", "confirmDelete": "确认删除",
    "uploadQueue": "上传队列", "uploading": "上传中", "uploadComplete": "上传完成", "loginTitle": "登录文件工作台", "loginHint": "使用文件服务中配置的账户继续。", "username": "用户名", "password": "密码", "demoAccount": "使用演示账号", "signIn": "进入工作台", "verifying": "正在验证...",
  },
};

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string, values?: Record<string, string | number>) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);

function readLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("node-fs-locale");
  return stored === "zh-CN" ? "zh-CN" : "en";
}

function subscribeToLocale(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), messages[locale][key] || key);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribeToLocale, readLocale, () => "en");
  const setLocale = (nextLocale: Locale) => {
    window.localStorage.setItem("node-fs-locale", nextLocale);
    window.dispatchEvent(new StorageEvent("storage", { key: "node-fs-locale" }));
  };
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
