import { VaultService, VaultError } from './vault.ts';
import { findReferences, resolveReference, rewriteNote, type MoveSpec, type VaultIndex } from '../shared/references.ts';
import type { MaintenanceOutcome, ReferenceReport, ResolvedImage } from '../shared/types.ts';

function buildIndex(files: string[]): VaultIndex {
  const set = new Set(files);
  return {
    has: rel => set.has(rel),
    match: rel => files.filter(f => f === rel || f.startsWith(rel + '.')).sort(),
    matchName: name => files.filter(f => { const base = f.split('/').at(-1)!; return base === name || base.startsWith(name + '.'); }).sort(),
  };
}

// 移动/重命名并同步维护全库引用。source 为原相对路径，to 为目标相对路径（含文件/目录名）。
export async function relocateWithReferences(vault: VaultService, source: string, to: string): Promise<MaintenanceOutcome> {
  if (to === source) throw new VaultError('INVALID_PATH', '目标与原位置相同。');
  if (to.startsWith(source + '/')) throw new VaultError('INVALID_PATH', '不能把目录移动到自身或其子目录。');
  const before = await vault.scanAll();
  const isDirectory = !before.includes(source);
  const moves: MoveSpec[] = isDirectory
    ? before.filter(f => f.startsWith(source + '/')).map(f => ({ from: f, to: to + f.slice(source.length) }))
    : [{ from: source, to }];
  const moveMap = new Map(moves.map(m => [m.from, m.to]));
  const index = buildIndex(before);
  const notePaths = before.filter(f => /\.md$/i.test(f));
  type Plan = { from: string; to: string; revision: string; content: string; newContent: string; unchanged: ReturnType<typeof rewriteNote>['unchanged'] };
  const plans: Plan[] = [];
  for (const path of notePaths) {
    const snapshot = await vault.read(path);
    const moved = moveMap.has(path);
    const result = rewriteNote(snapshot.content, path, moved ? moveMap.get(path)! : null, moves, index);
    plans.push({ from: path, to: moved ? moveMap.get(path)! : path, revision: snapshot.revision, content: snapshot.content, newContent: result.content, unchanged: result.unchanged });
  }
  await vault.rename(source, to);
  let rewritten = 0;
  const unchanged: ReferenceReport[] = [];
  const failed: MaintenanceOutcome['failed'] = [];
  for (const plan of plans) {
    for (const u of plan.unchanged) unchanged.push({ file: plan.from, text: plan.content.slice(u.ref.start, u.ref.end), reason: u.reason });
    if (plan.newContent === plan.content) continue;
    try {
      const current = await vault.read(plan.to);
      if (current.revision !== plan.revision) { failed.push({ file: plan.to, message: '保存期间检测到外部修改，引用未更新。' }); continue; }
      await vault.save(plan.to, plan.newContent, plan.revision);
      rewritten++;
    } catch (error) {
      failed.push({ file: plan.to, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { from: source, to, rewritten, unchanged, failed };
}

export async function resolveImages(vault: VaultService, notePath: string, content: string): Promise<ResolvedImage[]> {
  const index = buildIndex(await vault.scanAll());
  const refs = findReferences(content);
  const result: ResolvedImage[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'image' && ref.kind !== 'embed') continue;
    const kind = ref.kind;
    const res = resolveReference(ref, notePath, index);
    if (res.status === 'external') {
      result.push({ kind, target: ref.target, status: 'external', url: /^(https?:|data:)/.test(ref.target) ? ref.target : undefined });
    } else if (res.status === 'ok') {
      const previewable = /\.(png|jpe?g|gif|webp|svg|bmp|ico|pdf|mp4|webm|ogv|mov|m4v|mp3|wav|ogg|m4a|flac)$/i.test(res.path);
      if (kind === 'embed' && !previewable) result.push({ kind, target: ref.target, status: 'not-image' });
      else result.push({ kind, target: ref.target, status: 'ok', url: 'plainote-file://v/' + encodeURIComponent(res.path) });
    } else {
      result.push({ kind, target: ref.target, status: res.status });
    }
  }
  return result;
}

// 解析本地链接目标为绝对路径（外部 URL 或无法解析返回 null）。
export async function resolveLinkTarget(vault: VaultService, notePath: string, target: string): Promise<string | null> {
  const index = buildIndex(await vault.scanAll());
  const res = resolveReference({ kind: 'link', target, start: 0, end: 0, pathStart: 0, pathEnd: 0 }, notePath, index);
  if (res.status !== 'ok') return null;
  return vault.resolveResource(res.path);
}

// 解析链接目标，区分笔记/附件/外部/缺失。
export async function resolveTarget(vault: VaultService, notePath: string, target: string): Promise<{ status: 'note' | 'attachment' | 'external' | 'missing'; path?: string }> {
  if (/^(https?:|mailto:|data:)/.test(target)) return { status: 'external' };
  const index = buildIndex(await vault.scanAll());
  const res = resolveReference({ kind: 'link', target, start: 0, end: 0, pathStart: 0, pathEnd: 0 }, notePath, index);
  if (res.status !== 'ok') return { status: 'missing' };
  if (/\.md$/i.test(res.path)) return { status: 'note', path: res.path };
  return { status: 'attachment', path: res.path };
}
