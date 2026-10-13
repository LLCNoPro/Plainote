import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { searchNotes, readAiConfig, saveAiConfig, streamChat } from '../src/electron/ai.ts';

test('检索按关键词打分并返回相关笔记', () => {
  const notes = [
    { path: 'a.md', name: '周会', content: '本周讨论了产品方向。' },
    { path: 'b.md', name: '读书', content: '读了《设计心理学》。' },
    { path: 'c.md', name: '周报', content: '本周产品周报汇总。' },
  ];
  const hits = searchNotes('产品 周会', notes);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].path, 'a.md');
  assert.ok(hits.every(h => h.score > 0));
  assert.ok(hits.every(h => typeof h.content === 'string' && h.content.length > 0));
});

test('AI 配置读写往返并保留其它字段', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'plainote-ai-'));
  const file = path.join(dir, 'preferences.json');
  await saveAiConfig(file, { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-test', model: 'deepseek-chat' });
  assert.deepEqual(await readAiConfig(file), { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-test', model: 'deepseek-chat' });
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.ai.apiKey, 'sk-test');
});

test('流式解析 content_block_delta 增量', async () => {
  const chunks = [
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"，世界"}}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ];
  const encoder = new TextEncoder();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, body: new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } }), text: async () => '' })) as unknown as typeof fetch;
  const received: string[] = [];
  try {
    await streamChat({ baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk', model: 'deepseek-chat' }, [{ role: 'user', content: 'hi' }], {}, text => received.push(text), new AbortController().signal);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(received, ['你好', '，世界']);
});

test('未配置 API Key 抛出 AI_NOT_CONFIGURED', async () => {
  await assert.rejects(streamChat({ baseUrl: '', apiKey: '', model: '' }, [], {}, () => {}, new AbortController().signal), { code: 'AI_NOT_CONFIGURED' });
});
