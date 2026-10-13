import { useEffect, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import type { AiChatMessage, AiContext } from '../shared/ai.ts';
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
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const sessionRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offToken = bridge.onAiToken((sessionId, text) => {
      if (sessionId !== sessionRef.current) return;
      setStatus('');
      setMessages(prev => {
        const next = [...prev]; const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.streaming) next[next.length - 1] = { ...last, content: last.content + text };
        else next.push({ role: 'assistant', content: text, streaming: true });
        return next;
      });
    });
    const offStatus = bridge.onAiStatus((sessionId, message) => {
      if (sessionId !== sessionRef.current) return;
      setStatus(message);
    });
    const offDone = bridge.onAiDone((sessionId) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setStatus('');
      setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last?.role === 'assistant') next[next.length - 1] = { ...last, streaming: false }; return next; });
    });
    const offError = bridge.onAiError((sessionId, message) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setStatus('');
      setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last?.role === 'assistant' && last.streaming) next[next.length - 1] = { ...last, streaming: false }; return next; });
      setError(message);
    });
    return () => { offToken(); offStatus(); offDone(); offError(); };
  }, [bridge]);

  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [messages, status]);

  const chat = async (history: AiChatMessage[], context: AiContext) => {
    const result = await bridge.aiChat(history, context);
    if (!result.ok) {
      if (result.error.code === 'AI_NOT_CONFIGURED') onConfigMissing();
      else setMessages(prev => [...prev, { role: 'assistant', content: result.error.message }]);
      return;
    }
    sessionRef.current = result.value;
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sessionRef.current) return;
    if (content.toLowerCase() === '/restore') { void index(); return; }
    const history: AiChatMessage[] = messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content });
    const context: AiContext = { currentNote: note ?? undefined, selection: getSelection() || undefined };
    setMessages(prev => [...prev, { role: 'user', content }]);
    setInput(''); setError(''); setStatus('');
    await chat(history, context);
  };

  const index = async () => {
    if (sessionRef.current) return;
    setMessages(prev => [...prev, { role: 'user', content: '/restore 整理笔记库索引' }]);
    setInput(''); setError('');
    const result = await bridge.aiIndex();
    if (!result.ok) {
      if (result.error.code === 'AI_NOT_CONFIGURED') onConfigMissing();
      else setMessages(prev => [...prev, { role: 'assistant', content: result.error.message }]);
      return;
    }
    sessionRef.current = result.value;
  };

  return <div className="ai-panel">
    <div className="ai-messages" ref={listRef}>
      {messages.length === 0 && <p className="empty-label">向 AI 提问，它会把整个笔记库当作项目来检索回答，当前笔记与选中文本会自动带入。首次使用可点「整理索引」生成 AGENT.md 概览。</p>}
      {messages.map((m, i) => <div key={i} className={'ai-msg ' + m.role + (m.streaming ? ' streaming' : '')}>{m.role === 'assistant' ? <div className="ai-msg-text ai-md" dangerouslySetInnerHTML={{ __html: md.render(m.content) }} /> : <div className="ai-msg-text">{m.content}</div>}{m.role === 'assistant' && !m.streaming && m.content && <button className="ai-insert" onClick={() => onInsert(m.content)}>插入到笔记</button>}</div>)}
      {status && <div className="ai-status" role="status">{status}</div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ai-quick"><button onClick={() => void send('请总结当前笔记的要点。')}>总结</button><button onClick={() => void send('请续写当前笔记，保持原有风格。')}>续写</button><button onClick={() => void send('请润色当前选中的文本，使其表达更清晰流畅。')}>润色</button><button onClick={() => void send('请把当前选中的文本翻译成英文。')}>翻译</button><button onClick={() => void index()} title="整理整个笔记库生成 AGENT.md 概览">整理索引</button></div>
    <div className="ai-input-row"><textarea className="ai-input" rows={3} placeholder="输入问题，Enter 发送，Shift+Enter 换行；/restore 整理索引" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><button className="ai-send" disabled={!input.trim() || !!sessionRef.current} onClick={() => void send()}>发送</button></div>
  </div>;
}
