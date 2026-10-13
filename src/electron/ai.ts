import { readFile, writeFile } from 'node:fs/promises';
import type { AiChatMessage, AiConfig, AiContext, AiNoteContext, AiSearchHit } from '../shared/ai.ts';
import { VaultError } from './vault.ts';

export const DEFAULT_AI_CONFIG: AiConfig = { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: '', model: 'deepseek-chat' };

// 读取 preferences.json 里的 ai 字段，缺失时返回默认配置。
export async function readAiConfig(preferencesPath: string): Promise<AiConfig> {
  try {
    const parsed = JSON.parse(await readFile(preferencesPath, 'utf8'));
    const ai = parsed?.ai;
    if (ai && typeof ai === 'object') return { ...DEFAULT_AI_CONFIG, ...ai };
  } catch { /* 首次运行或配置缺失。 */ }
  return { ...DEFAULT_AI_CONFIG };
}

// 保存 ai 配置到 preferences.json，保留文件里已有的其它字段。
export async function saveAiConfig(preferencesPath: string, config: AiConfig): Promise<void> {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(preferencesPath, 'utf8')); } catch { /* 无现有配置。 */ }
  const ai: AiConfig = {
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    model: typeof config.model === 'string' && config.model.trim() ? config.model.trim() : DEFAULT_AI_CONFIG.model,
  };
  await writeFile(preferencesPath, JSON.stringify({ ...existing, ai }), 'utf8');
}

// 对查询分词：中文按二元组分词以提升召回，英文按空格/标点切分。
function tokenize(query: string): string[] {
  const phrases = query.toLowerCase().split(/[\s,，。;；、/\\:：!！?？()（）\[\]'"“”]+/).filter(Boolean);
  const terms: string[] = [];
  for (const phrase of phrases) {
    if (/[一-鿿]/.test(phrase)) {
      if (phrase.length <= 2) terms.push(phrase);
      else for (let i = 0; i < phrase.length - 1; i++) terms.push(phrase.slice(i, i + 2));
    } else terms.push(phrase);
  }
  return [...new Set(terms)];
}

// 关键词全文打分：query 与每篇笔记做重叠匹配，返回 Top-N 命中。
export function searchNotes(query: string, notes: AiNoteContext[], limit = 5): AiSearchHit[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const hits: AiSearchHit[] = [];
  for (const note of notes) {
    const lowerName = note.name.toLowerCase(), lowerContent = note.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let idx = 0;
      while ((idx = lowerContent.indexOf(term, idx)) !== -1) { score += term.length; idx += term.length; }
      if (lowerName.includes(term)) score += 40;
    }
    if (score <= 0) continue;
    const first = terms.reduce((min, term) => { const i = lowerContent.indexOf(term); return i === -1 ? min : Math.min(min, i); }, Infinity);
    const start = Number.isFinite(first) ? Math.max(0, first - 30) : 0;
    hits.push({ path: note.path, name: note.name, snippet: note.content.slice(start, start + 100), score, content: note.content });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildSystem(context: AiContext): string {
  const parts = ['你是「素记」本地 Markdown 笔记库的 AI 助手。把整个笔记库当作一个项目看待，综合检索到的相关笔记回答。回答使用中文，内容使用 Markdown 格式。'];
  if (context.currentNote) parts.push(`【当前笔记：${context.currentNote.name}】\n${context.currentNote.content}`);
  if (context.selection) parts.push(`【用户选中的文本】\n${context.selection}`);
  if (context.retrieved?.length) parts.push('【从笔记库检索到的相关笔记】\n' + context.retrieved.map(n => `### ${n.name}\n${n.content}`).join('\n\n'));
  parts.push('回答指引：默认综合【相关笔记】与【当前笔记】回答；仅当用户明确要求「基于当前笔记」时，才只参考【当前笔记】。');
  return parts.join('\n\n');
}

// 调用 DeepSeek（Anthropic 兼容接口）并流式回调增量文本。用 signal 支持中断。
export async function streamChat(config: AiConfig, messages: AiChatMessage[], context: AiContext, onDelta: (text: string) => void, signal: AbortSignal): Promise<void> {
  if (!config.apiKey) throw new VaultError('AI_NOT_CONFIGURED', '请先在设置中配置 AI API Key。');
  const body = {
    model: config.model || DEFAULT_AI_CONFIG.model,
    max_tokens: 4096,
    stream: true,
    system: buildSystem(context),
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new VaultError('AI_ERROR', `AI 请求失败（HTTP ${response.status}）：${text.slice(0, 200) || '无响应体'}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      let event: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try { event = JSON.parse(data); } catch { continue; }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) onDelta(event.delta.text);
      else if (event.type === 'error') throw new VaultError('AI_ERROR', 'AI 请求失败：' + (event.error?.message || '未知错误'));
    }
  }
}
