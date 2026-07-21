import { describe, expect, it } from "vitest";
import { createSelectionState, shouldUseChunkedUpload, sortEntries } from "@/lib/file-manager-utils";

const entries = [
  { name: "small.txt", type: "file" as const, size: 10, modifiedTime: "2026-07-01T00:00:00.000Z" },
  { name: "large.txt", type: "file" as const, size: 100, modifiedTime: "2026-07-03T00:00:00.000Z" },
  { name: "assets", type: "directory" as const, modifiedTime: "2026-07-02T00:00:00.000Z" },
];

describe("file manager helpers", () => {
  it("sorts by a selected field and direction", () => {
    expect(sortEntries(entries, "", "size", "asc").map((entry) => entry.name)).toEqual(["assets", "small.txt", "large.txt"]);
    expect(sortEntries(entries, "", "size", "desc").map((entry) => entry.name)).toEqual(["large.txt", "small.txt", "assets"]);
    expect(sortEntries(entries, "large", "name", "asc").map((entry) => entry.name)).toEqual(["large.txt"]);
  });

  it("uses chunked upload only above 20 MB", () => {
    expect(shouldUseChunkedUpload(20 * 1024 * 1024)).toBe(false);
    expect(shouldUseChunkedUpload(20 * 1024 * 1024 + 1)).toBe(true);
  });

  it("resets preview state when a different file is selected", () => {
    expect(createSelectionState()).toEqual({ detailsTab: "info", info: null, preview: null, hash: null });
  });
});
