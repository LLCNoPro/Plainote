export interface NoteFile { path: string; name: string; modified: number; size: number }
export interface NoteSnapshot { path: string; content: string; revision: string; modified: number }
export interface RecoverySnapshot { path: string; content: string; baseRevision: string; savedAt: number }
export interface VaultInfo { root: string; name: string; files: NoteFile[]; directories: string[] }
export type ErrorCode = 'CONFLICT' | 'INVALID_PATH' | 'NOT_FOUND' | 'EXISTS' | 'IO' | 'NO_VAULT' | 'TOO_LARGE';
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string } };
export interface PlainoteBridge {
  platform: string;
  chooseVault(): Promise<Result<VaultInfo | null>>;
  currentVault(): Promise<Result<VaultInfo | null>>;
  directories(): Promise<Result<string[]>>;
  createDirectory(path: string): Promise<Result<void>>;
  rename(path: string, newPath: string): Promise<Result<void>>;
  trash(path: string, revision: string): Promise<Result<void>>;
  scan(): Promise<Result<NoteFile[]>>;
  read(path: string): Promise<Result<NoteSnapshot>>;
  save(path: string, content: string, revision: string): Promise<Result<NoteSnapshot>>;
  create(path: string, content: string): Promise<Result<NoteSnapshot>>;
  stageRecovery(path: string, content: string, revision: string): Promise<Result<void>>;
  getRecovery(path: string): Promise<Result<RecoverySnapshot | null>>;
  recoveries(): Promise<Result<RecoverySnapshot[]>>;
  clearRecovery(path: string): Promise<Result<void>>;
  onCloseRequested(callback: (requestId: number) => void): () => void;
  onCloseCanceled(callback: (requestId: number) => void): () => void;
  finishClose(requestId: number, ready: boolean): void;
  onVaultRequested(callback: () => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  closeWindow(): void;
}
