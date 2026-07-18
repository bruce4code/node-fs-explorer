export type ApiSuccess<T> = { success: true; data: T };
export type ApiError = { success: false; error: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type FileKind = "file" | "directory";

export interface FileEntry {
  name: string;
  type: FileKind;
  size?: number;
  modifiedTime?: string;
}

export interface FileInfo {
  name: string;
  fullPath: string;
  type: FileKind;
  size: number;
  createdTime: string;
  modifiedTime: string;
  accessTime: string;
  permissions: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface FilePreview {
  type: "text" | "image";
  content: string;
  extension: string;
  previewLines?: number;
  totalLines?: number;
}

export interface OperationLog {
  timestamp: string;
  operation: string;
  path: string;
  [key: string]: unknown;
}

export interface FileHash {
  algorithm: string;
  hash: string;
  size: number;
  path: string;
}

export interface AuthUser { username: string; role: string }
export interface LoginResult {
  token: string;
  expiresIn: number;
  tokenType: "Bearer";
  user: AuthUser;
}

export interface UploadInitResult {
  instant?: boolean;
  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
  uploadedChunks?: number[];
  path?: string;
  fileName?: string;
  size?: number;
}

export interface UploadProgress {
  chunkIndex: number;
  uploaded: number;
  totalChunks: number;
  uploadedChunks: number[];
}
