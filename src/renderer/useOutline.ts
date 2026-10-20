import { useEffect, useState } from 'react';
import type { OutlineHeading } from './outline.ts';

interface OutlineResult { key: string; source: string; headings: OutlineHeading[]; error: string }
export function useOutline(key: string | null, source: string) {
  const [result, setResult] = useState<OutlineResult | null>(null);
  useEffect(() => {
    if (key === null) return;
    let active = true, worker: Worker | undefined;
    const finish = (headings: OutlineHeading[], error = '') => {
      if (active) setResult({ key, source, headings, error });
      worker?.terminate();
    };
    // Coalesce rapid typing and cancel obsolete work instead of queuing full
    // parses. Even the largest supported note never parses on the UI thread.
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('./outline.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ headings?: OutlineHeading[]; error?: string }>) => finish(event.data.headings || [], event.data.error);
        worker.onerror = () => finish([], '大纲生成失败，请重新打开笔记。');
        worker.postMessage(source);
      } catch { finish([], '大纲生成失败，请重新打开笔记。'); }
    }, 150);
    return () => { active = false; window.clearTimeout(timer); worker?.terminate(); };
  }, [key, source]);
  const current = key !== null && result?.key === key;
  const ready = current && result.source === source;
  return { headings: current ? result.headings : [], loading: key !== null && !ready, error: ready ? result.error : '' };
}
