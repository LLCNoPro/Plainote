import type { AiChatMessage, AiConfig, AiContext, AiSearchHit } from './ai.ts';
export interface NoteFile { path: string; name: string; modified: number; size: number }
export interface NoteSnapshot { path: string; content: string; revision: string; modified: number }
export interface RecoverySnapshot { path: string; content: string; baseRevision: string; savedAt: number }
export interface VaultInfo { root: string; name: string; files: NoteFile[]; directories: string[] }
export interface AttachmentConfig { mode: 'vault' | 'note'; dir: string }
export interface ResolvedImage { kind: 'image' | 'embed'; target: string; status: 'ok' | 'external' | 'missing' | 'ambiguous' | 'not-image'; url?: string }
export interface DirectoryCount { notes: number; attachments: number; files: number }
export interface ReferenceReport { file: string; text: string; reason: string }
export interface MaintenanceOutcome { from: string; to: string; rewritten: number; unchanged: ReferenceReport[]; failed: { file: string; message: string }[] }
export type ErrorCode = 'CONFLICT' | 'INVALID_PATH' | 'NOT_FOUND' | 'EXISTS' | 'IO' | 'NO_VAULT' | 'TOO_LARGE' | 'PANDOC_NOT_FOUND' | 'AI_NOT_CONFIGURED' | 'AI_ERROR';
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string } };
export interface PlainoteBridge {
  platform: string;
  chooseVault(): Promise<Result<VaultInfo | null>>;
  currentVault(): Promise<Result<VaultInfo | null>>;
  directories(): Promise<Result<string[]>>;
  createDirectory(path: string): Promise<Result<void>>;
  rename(path: string, newPath: string): Promise<Result<MaintenanceOutcome>>;
  exportDocx(content: string, sourcePath: string, pandocPath: string): Promise<Result<string | null>>;
  aiGetConfig(): Promise<Result<AiConfig>>;
  aiSetConfig(config: AiConfig): Promise<Result<void>>;
  aiSearch(query: string): Promise<Result<AiSearchHit[]>>;
  aiChat(messages: AiChatMessage[], context: AiContext): Promise<Result<string>>;
  aiIndex(): Promise<Result<string>>;
  aiCancel(sessionId: string): Promise<Result<void>>;
  onAiToken(callback: (sessionId: string, text: string) => void): () => void;
  onAiStatus(callback: (sessionId: string, message: string) => void): () => void;
  onAiDone(callback: (sessionId: string) => void): () => void;
  onAiError(callback: (sessionId: string, message: string) => void): () => void;
  trash(path: string, revision: string): Promise<Result<void>>;
  scan(): Promise<Result<NoteFile[]>>;
  read(path: string): Promise<Result<NoteSnapshot>>;
  scanEntries(): Promise<Result<NoteFile[]>>;
  openPath(path: string): Promise<Result<void>>;
  readText(path: string): Promise<Result<string>>;
  save(path: string, content: string, revision: string): Promise<Result<NoteSnapshot>>;
  create(path: string, content: string): Promise<Result<NoteSnapshot>>;
  stageRecovery(path: string, content: string, revision: string): Promise<Result<void>>;
  getRecovery(path: string): Promise<Result<RecoverySnapshot | null>>;
  recoveries(): Promise<Result<RecoverySnapshot[]>>;
  clearRecovery(path: string): Promise<Result<void>>;
  attachmentGetConfig(): Promise<Result<AttachmentConfig>>;
  attachmentSetConfig(config: AttachmentConfig): Promise<Result<void>>;
  importAttachment(filename: string, bytes: Uint8Array, notePath: string): Promise<Result<{ path: string }>>;
  openAttachment(target: string, notePath: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
  resolveTarget(target: string, notePath: string): Promise<Result<{ status: 'note' | 'attachment' | 'external' | 'missing'; path?: string }>>;
  resolveImages(notePath: string, content: string): Promise<Result<ResolvedImage[]>>;
  countDirectory(path: string): Promise<Result<DirectoryCount>>;
  move(path: string, targetDir: string): Promise<Result<MaintenanceOutcome>>;
  trashDirectory(path: string): Promise<Result<void>>;
  onCloseRequested(callback: (requestId: number) => void): () => void;
  onCloseCanceled(callback: (requestId: number) => void): () => void;
  finishClose(requestId: number, ready: boolean): void;
  onVaultRequested(callback: () => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  closeWindow(): void;
}
