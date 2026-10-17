import { constants } from 'node:fs';
import { open, lstat, readdir, realpath, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ErrorCode, NoteFile, NoteSnapshot, RecoverySnapshot } from '../shared/types.ts';
import { INDEX_FILE } from '../shared/ai.ts';

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
  private validateRelative(relative: string, markdownOnly = true): string[] {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new VaultError('INVALID_PATH', '笔记路径必须位于当前笔记库中。');
    const parts = relative.split('/');
    if (parts.some(p => !p || p.startsWith('.') || (!markdownOnly && (/[<>:"|?*]/.test(p) || /[. ]$/.test(p)))) || (markdownOnly && !/\.md$/i.test(parts.at(-1)!))) throw new VaultError('INVALID_PATH', '请选择笔记库中的 Markdown 文件。');
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
          if (relative.toLowerCase() === INDEX_FILE.toLowerCase()) continue;
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
  async scanEntries(): Promise<NoteFile[]> {
    const result: NoteFile[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
        else if (entry.isFile()) {
          const isNote = /\.md$/i.test(entry.name);
          if (isNote && relative.toLowerCase() === INDEX_FILE.toLowerCase()) continue;
          try {
            const stat = await lstat(path.join(directory, entry.name));
            if (stat.isFile() && !stat.isSymbolicLink()) result.push({ path: relative, name: isNote ? entry.name.replace(/\.md$/i, '') : entry.name, modified: stat.mtimeMs, size: stat.size });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
    };
    await walk(this.root, '');
    return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  }
  async scanAll(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
        else if (entry.isFile()) {
          try {
            const stat = await lstat(path.join(directory, entry.name));
            if (stat.isFile() && !stat.isSymbolicLink()) result.push(relative);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
    };
    await walk(this.root, '');
    return result.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  async resolveResource(relative: string): Promise<string> {
    const parts = this.validateRelative(relative, false);
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = await lstat(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', '附件已经不存在。'); throw error; }
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()) || (i === parts.length - 1 && !stat.isFile())) throw new VaultError('INVALID_PATH', '该路径不是笔记库中的普通文件。');
    }
    return current;
  }
  async directoryPath(relative: string): Promise<string> {
    if (!relative) return this.root;
    const parts = this.validateRelative(relative, false);
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = await lstat(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', '目录已经不存在。'); throw error; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VaultError('INVALID_PATH', '该路径不是笔记库中的目录。');
    }
    return current;
  }
  async isDirectory(relative: string): Promise<boolean> {
    const parts = this.validateRelative(relative, false);
    let current = this.root;
    for (const part of parts) current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new VaultError('INVALID_PATH', '不能对符号链接操作。');
    return stat.isDirectory();
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
  async createDirectory(relative: string): Promise<void> {
    const parts = this.validateRelative(relative, false);
    return this.queued('directory:' + relative, async () => {
      let current = this.root;
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        let created = false;
        try { await mkdir(current); created = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VaultError('INVALID_PATH', '目录路径不能经过符号链接或文件。');
        if (!created && index === parts.length - 1) throw new VaultError('EXISTS', '同名目录已经存在，请换一个名称。');
      }
    });
  }
  async directories(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const relative = prefix + entry.name;
        result.push(relative); await walk(path.join(directory, entry.name), relative + '/');
      }
    };
    await walk(this.root, '');
    return result.sort((a,b) => a.localeCompare(b, 'zh-CN'));
  }
  async trash(relative: string, revision: string, moveToTrash: (filename: string) => Promise<void>): Promise<void> {
    this.validateRelative(relative);
    return this.queued(relative, async () => {
      const snapshot = await this.read(relative);
      if (snapshot.revision !== revision) throw new VaultError('CONFLICT', '笔记已被其他应用修改，请重新查看内容后再删除。');
      const filename = await this.notePath(relative);
      const recovery = await this.getRecovery(relative);
      await moveToTrash(filename);
      if (recovery?.content === snapshot.content) await rm(this.recoveryPath(relative), { force: true }).catch(() => {});
    });
  }
  private async resolveEntry(relative: string, mustExist: boolean): Promise<string> {
    const parts = this.validateRelative(relative, false);
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (i < parts.length - 1) throw new VaultError('NOT_FOUND', '所在目录不存在。');
          if (mustExist) throw new VaultError('NOT_FOUND', '要重命名的项目不存在。');
          return current;
        }
        throw error;
      }
      if (stat.isSymbolicLink()) throw new VaultError('INVALID_PATH', '不能通过符号链接重命名。');
      if (i < parts.length - 1 && !stat.isDirectory()) throw new VaultError('INVALID_PATH', '路径中间不是目录。');
      if (i === parts.length - 1) {
        if (mustExist) { if (!stat.isFile() && !stat.isDirectory()) throw new VaultError('INVALID_PATH', '该路径不是笔记或目录。'); }
        else throw new VaultError('EXISTS', '同名项目已经存在，请换一个名称。');
      }
    }
    return current;
  }
  private async remapRecoveries(relative: string, newRelative: string): Promise<void> {
    const prefix = relative + '/';
    for (const recovery of await this.listRecovery()) {
      if (recovery.path !== relative && !recovery.path.startsWith(prefix)) continue;
      const next = newRelative + recovery.path.slice(relative.length);
      await this.writeRecovery(next, recovery.content, recovery.baseRevision);
      await rm(this.recoveryPath(recovery.path), { force: true }).catch(() => {});
    }
  }
  async rename(relative: string, newRelative: string): Promise<void> {
    if (newRelative === relative) throw new VaultError('INVALID_PATH', '目标与原位置相同。');
    if (newRelative.startsWith(relative + '/')) throw new VaultError('INVALID_PATH', '不能把目录移动到自身或其子目录。');
    return this.queued('rename:' + relative, async () => {
      const from = await this.resolveEntry(relative, true);
      const to = await this.resolveEntry(newRelative, false);
      await rename(from, to);
      await this.remapRecoveries(relative, newRelative);
    });
  }
  async countDirectory(relative: string): Promise<{ notes: number; attachments: number; files: number }> {
    const files = await this.scanAll();
    const prefix = relative + '/';
    const under = files.filter(f => f.startsWith(prefix));
    const notes = under.filter(f => /\.md$/i.test(f)).length;
    return { notes, attachments: under.length - notes, files: under.length };
  }
  async trashDirectory(relative: string, moveToTrash: (filename: string) => Promise<void>): Promise<void> {
    this.validateRelative(relative, false);
    return this.queued('directory:' + relative, async () => {
      const filename = await this.directoryPath(relative);
      await moveToTrash(filename);
      for (const recovery of await this.listRecovery()) {
        if (recovery.path === relative || recovery.path.startsWith(relative + '/')) await this.clearRecovery(recovery.path).catch(() => {});
      }
    });
  }
  private async uniqueWrite(directory: string, filename: string, bytes: Buffer): Promise<string> {
    const ext = path.extname(filename);
    const stem = path.basename(filename, ext);
    for (let n = 0; ; n++) {
      const candidate = n === 0 ? filename : `${stem} ${n}${ext}`;
      try {
        const handle = await open(path.join(directory, candidate), 'wx', 0o644);
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); }
        return candidate;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    }
  }
  async writeAttachment(relDir: string, filename: string, bytes: Buffer): Promise<string> {
    const safe = filename.replace(/[\\/:*?"<>|\0]/g, '').replace(/^\.+/, '').trim() || 'image';
    const parts = relDir ? this.validateRelative(relDir, false) : [];
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try { await mkdir(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VaultError('INVALID_PATH', '附件目录无效。');
    }
    return this.uniqueWrite(current, safe, bytes);
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
