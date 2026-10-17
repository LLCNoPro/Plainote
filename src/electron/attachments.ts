import { readFile, writeFile } from 'node:fs/promises';
import type { AttachmentConfig } from '../shared/types.ts';

export const DEFAULT_ATTACHMENT_CONFIG: AttachmentConfig = { mode: 'vault', dir: 'attachments' };

// 读取按笔记库（canonical root）键控的附件配置；缺失时返回默认。
export async function readAttachmentConfig(storePath: string, root: string): Promise<AttachmentConfig> {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    const entry = parsed?.vaults?.[root];
    if (entry && typeof entry === 'object') {
      const mode = entry.mode === 'note' ? 'note' : 'vault';
      const dir = typeof entry.dir === 'string' && entry.dir.trim() ? normalizeDir(entry.dir) : DEFAULT_ATTACHMENT_CONFIG.dir;
      return { mode, dir };
    }
  } catch { /* 首次运行或配置缺失。 */ }
  return { ...DEFAULT_ATTACHMENT_CONFIG };
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
}

// 保存附件配置到存储文件，保留其它已有字段。
export async function saveAttachmentConfig(storePath: string, root: string, config: AttachmentConfig): Promise<void> {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(storePath, 'utf8')); } catch { /* 无现有配置。 */ }
  const vaults = (existing.vaults && typeof existing.vaults === 'object' ? existing.vaults : {}) as Record<string, unknown>;
  const dir = normalizeDir(typeof config.dir === 'string' ? config.dir : '') || DEFAULT_ATTACHMENT_CONFIG.dir;
  vaults[root] = { mode: config.mode === 'note' ? 'note' : 'vault', dir };
  await writeFile(storePath, JSON.stringify({ ...existing, vaults }), 'utf8');
}

// 附件目录的库内相对路径（不含结尾斜杠；库根返回 ''）。
export function attachmentRelativeDir(config: AttachmentConfig, notePath: string): string {
  const dir = config.dir || DEFAULT_ATTACHMENT_CONFIG.dir;
  if (config.mode === 'note') {
    const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
    return noteDir ? noteDir + '/' + dir : dir;
  }
  return dir;
}
