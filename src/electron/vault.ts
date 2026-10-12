import { constants } from 'node:fs';
import { open, lstat, readdir, realpath, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ErrorCode, NoteFile, NoteSnapshot, RecoverySnapshot } from '../shared/types.ts';

const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
export class VaultError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.code = code; }
}
export class VaultService {
  readonly root: string;
  private recoveryDir: string;
  private queues = new Map<string, Promise<unknown>>();
  private constructor(root: string, recovery: string) { this.root = root; this.recoveryDir = path.join(recovery, hash(root)); }
  static async open(root: string, recovery: string): Promise<VaultService> {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new VaultError('INVALID_PATH', '请选择一个笔记文件夹。');
    return new VaultService(canonical, recovery);
  }
  private validateRelative(relative: string): string[] {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new VaultError('INVALID_PATH', '笔记路径必须位于当前笔记库中。');
    const parts = relative.split('/');
    if (parts.some(p => !p || p.startsWith('.')) || !/\.md$/i.test(parts.at(-1)!)) throw new VaultError('INVALID_PATH', '请选择笔记库中的 Markdown 文件。');
    return parts;
  }
  private async notePath(relative: string, allowMissing = false): Promise<string> {
    const parts = this.validateRelative(relative);
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()) || (i === parts.length - 1 && !stat.isFile())) throw new VaultError('INVALID_PATH', '不能通过符号链接或非笔记路径读写文件。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing && i === parts.length - 1) return current;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', '笔记或所在目录已经不存在。');
        throw error;
      }
    }
    return current;
  }
  async scan(): Promise<NoteFile[]> {
    const result: NoteFile[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          try {
            const stat = await lstat(path.join(directory, entry.name));
            if (stat.isFile() && !stat.isSymbolicLink()) result.push({ path: relative, name: entry.name.replace(/\.md$/i, ''), modified: stat.mtimeMs, size: stat.size });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
    };
    await walk(this.root, '');
    return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  }
  async read(relative: string): Promise<NoteSnapshot> {
    const filename = await this.notePath(relative);
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new VaultError('INVALID_PATH', '该路径不是普通笔记文件。');
      if (stat.size > 20 * 1024 * 1024) throw new VaultError('TOO_LARGE', '这篇笔记超过 20 MB，请先用外部编辑器查看。');
      const bytes = await handle.readFile();
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      return { path: relative, content, revision: hash(bytes), modified: stat.mtimeMs };
    } finally { await handle.close(); }
  }
  private queued<T>(relative: string, operation: () => Promise<T>): Promise<T> {
    const current = (this.queues.get(relative) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(relative, current);
    const cleanup = () => { if (this.queues.get(relative) === current) this.queues.delete(relative); };
    current.then(cleanup, cleanup);
    return current;
  }
  private recoveryPath(relative: string): string { return path.join(this.recoveryDir, hash(relative) + '.json'); }
  private async writeRecovery(relative: string, content: string, revision: string): Promise<void> {
    await mkdir(this.recoveryDir, { recursive: true });
    const target = this.recoveryPath(relative), temporary = target + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ path: relative, content, baseRevision: revision, savedAt: Date.now() })); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  async stageRecovery(relative: string, content: string, revision: string): Promise<void> {
    this.validateRelative(relative);
    return this.queued(relative, () => this.writeRecovery(relative, content, revision));
  }
  async getRecovery(relative: string): Promise<RecoverySnapshot | null> {
    this.validateRelative(relative);
    try { return JSON.parse(await readFile(this.recoveryPath(relative), 'utf8')) as RecoverySnapshot; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async listRecovery(): Promise<RecoverySnapshot[]> {
    let filenames: string[];
    try { filenames = await readdir(this.recoveryDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const snapshots: RecoverySnapshot[] = [];
    for (const filename of filenames) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
      try {
        const snapshot = JSON.parse(await readFile(path.join(this.recoveryDir, filename), 'utf8')) as RecoverySnapshot;
        this.validateRelative(snapshot.path);
        if (typeof snapshot.content === 'string' && typeof snapshot.baseRevision === 'string' && filename === hash(snapshot.path) + '.json') snapshots.push(snapshot);
      } catch { /* Retain unrecognized records rather than delete them. */ }
    }
    return snapshots.sort((a, b) => b.savedAt - a.savedAt);
  }
  async clearRecovery(relative: string): Promise<void> {
    this.validateRelative(relative);
    return this.queued(relative, () => rm(this.recoveryPath(relative), { force: true }));
  }
  async save(relative: string, content: string, revision: string): Promise<NoteSnapshot> {
    this.validateRelative(relative);
    return this.queued(relative, async () => {
      await this.writeRecovery(relative, content, revision);
      const filename = await this.notePath(relative, true);
      if ((await this.read(relative)).revision !== revision) throw new VaultError('CONFLICT', '笔记已被其他应用修改，你的内容仍保留，请比较两个版本。');
      const stat = await lstat(filename);
      const temporary = path.join(path.dirname(filename), '.' + path.basename(filename) + '.' + randomUUID() + '.tmp');
      try {
        const handle = await open(temporary, 'wx', stat.mode & 0o777);
        try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await this.notePath(relative);
        if ((await this.read(relative)).revision !== revision) throw new VaultError('CONFLICT', '保存期间检测到外部修改，请比较并保留需要的内容。');
        await rename(temporary, filename);
        await rm(this.recoveryPath(relative), { force: true }).catch(() => {});
        return { path: relative, content, revision: hash(content), modified: Date.now() };
      } finally { await rm(temporary, { force: true }); }
    });
  }
  async create(relative: string, content: string): Promise<NoteSnapshot> {
    const filename = await this.notePath(relative, true);
    return this.queued(relative, async () => {
      let handle;
      try { handle = await open(filename, 'wx', 0o644); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError('EXISTS', '同名笔记已经存在，请换一个名称。'); throw error; }
      try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      return this.read(relative);
    });
  }
}
