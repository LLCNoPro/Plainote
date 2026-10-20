import { extractHeadings } from './outline.ts';

self.onmessage = (event: MessageEvent<string>) => {
  try { self.postMessage({ headings: extractHeadings(event.data) }); }
  catch { self.postMessage({ error: '大纲生成失败，请重新打开笔记。' }); }
};
