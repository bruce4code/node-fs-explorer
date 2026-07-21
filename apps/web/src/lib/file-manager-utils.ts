import type { FileEntry } from "@file-manager/contracts";

export type SortKey = "name" | "type" | "size" | "modifiedTime";
export type SortDirection = "asc" | "desc";

export function sortEntries(entries: FileEntry[], query: string, sortKey: SortKey, sortDirection: SortDirection) {
  return [...entries]
    .filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const aValue = sortKey === "size" ? a.size || 0 : String(a[sortKey] || "");
      const bValue = sortKey === "size" ? b.size || 0 : String(b[sortKey] || "");
      const comparison = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), "zh-CN", { numeric: true });
      if (comparison !== 0) return sortDirection === "asc" ? comparison : -comparison;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
}

export function shouldUseChunkedUpload(fileSize: number) {
  return fileSize > 20 * 1024 * 1024;
}

export function createSelectionState() {
  return { detailsTab: "info" as const, info: null, preview: null, hash: null };
}
