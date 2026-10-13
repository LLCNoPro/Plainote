import { useEffect, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import type { AiChatMessage, AiContext, AiNoteContext, AiSearchHit } from '../shared/ai.ts';
import type { PlainoteBridge } from '../shared/types.ts';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface Message { role: 'user' | 'assistant'; content: string; streaming?: boolean; }

export function AiPanel({ bridge, note, getSelection, onInsert, onConfigMissing }: {
  bridge: PlainoteBridge;
  note: { path: string; name: string; content: string } | null;
  getSelection: () => string;
  onInsert: (text: string) => void;
  onConfigMissing: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [retrieved, setRetrieved] = useState<AiNoteContext[]>([]);
  const [hits, setHits] = useState<AiSearchHit[]>([]);
  const [error, setError] = useState('');
  const sessionRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offToken = bridge.onAiToken((sessionId, text) => {
      if (sessionId !== sessionRef.current) return;
      setMessages(prev => {
        const next = [...prev]; const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.streaming) next[next.length - 1] = { ...last, content: last.content + text };
        else next.push({ role: 'assistant', content: text, streaming: true });
        return next;
      });
    });
    const offDone = bridge.onAiDone((sessionId) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last?.role === 'assistant') next[next.length - 1] = { ...last, streaming: false }; return next; });
    });
    const offError = bridge.onAiError((sessionId, message) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last?.role === 'assistant' && last.streaming) next[next.length - 1] = { ...last, streaming: false }; return next; });
      setError(message);
    });
    return () => { offToken(); offDone(); offError(); };
  }, [bridge]);

  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [messages]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sessionRef.current) return;
    const history: AiChatMessage[] = messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content });
    const context: AiContext = { currentNote: note ?? undefined, selection: getSelection() || undefined, retrieved: retrieved.length ? retrieved : undefined };
    setMessages(prev => [...prev, { role: 'user', content }]);
    setInput(''); setError(''); setHits([]);
    const result = await bridge.aiChat(history, context);
    if (!result.ok) {
      if (result.error.code === 'AI_NOT_CONFIGURED') onConfigMissing();
      else setMessages(prev => [...prev, { role: 'assistant', content: result.error.message }]);
      return;
    }
    sessionRef.current = result.value;
  };

  const search = async () => {
    const query = input.trim();
    if (!query) return;
    setError('');
    const result = await bridge.aiSearch(query);
    if (result.ok) setHits(result.value);
    else setError(result.error.message);
  };

  const addHit = (hit: AiSearchHit) => {
    if (retrieved.some(r => r.path === hit.path)) return;
    setRetrieved(prev => [...prev, { path: hit.path, name: hit.name, content: hit.content }]);
  };

  return <div className="ai-panel">
    <div className="ai-messages" ref={listRef}>
      {messages.length === 0 && <p className="empty-label">向 AI 提问，或使用快捷指令。当前笔记与选中文本会自动带入上下文。</p>}
      {messages.map((m, i) => <div key={i} className={'ai-msg ' + m.role + (m.streaming ? ' streaming' : '')}>{m.role === 'assistant' ? <div className="ai-msg-text ai-md" dangerouslySetInnerHTML={{ __html: md.render(m.content) }} /> : <div className="ai-msg-text">{m.content}</div>}{m.role === 'assistant' && !m.streaming && m.content && <button className="ai-insert" onClick={() => onInsert(m.content)}>插入到笔记</button>}</div>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {retrieved.length > 0 && <div className="ai-context-tags">{retrieved.map(n => <span key={n.path} className="ai-tag">{n.name}<button aria-label={'移除上下文 ' + n.name} onClick={() => setRetrieved(retrieved.filter(r => r.path !== n.path))}>×</button></span>)}</div>}
    {hits.length > 0 && <div className="ai-hits">{hits.map(h => <button key={h.path} className="ai-hit" onClick={() => addHit(h)}><strong>{h.name}</strong><small>{h.snippet}</small></button>)}</div>}
    <div className="ai-quick"><button onClick={() => send('请总结当前笔记的要点。')}>总结</button><button onClick={() => send('请续写当前笔记，保持原有风格。')}>续写</button><button onClick={() => send('请润色当前选中的文本，使其表达更清晰流畅。')}>润色</button><button onClick={() => send('请把当前选中的文本翻译成英文。')}>翻译</button></div>
    <div className="ai-input-row"><input className="ai-input" placeholder="输入问题，Enter 发送" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><button className="ai-search" title="检索全库" onClick={() => void search()}>检索</button><button className="ai-send" disabled={!input.trim() || !!sessionRef.current} onClick={() => void send()}>发送</button></div>
  </div>;
}
