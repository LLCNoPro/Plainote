import { useEffect, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { Icon } from './icons.tsx';
import type { PlainoteBridge } from '../shared/types.ts';

declare global { interface Window { plainote?: PlainoteBridge } }

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const PDF = /\.pdf$/i;
const VIDEO = /\.(mp4|webm|ogv|mov|m4v)$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a|flac)$/i;
const TEXT = /\.(txt|log|csv|json|js|mjs|ts|tsx|css|html|xml|yaml|yml|sh|py|rb|go|rs|java|c|cpp|h|hpp|toml|ini|conf|env|gitignore)$/i;

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'text' | 'other';
function kindOf(name: string): Kind {
  if (IMAGE.test(name)) return 'image';
  if (PDF.test(name)) return 'pdf';
  if (VIDEO.test(name)) return 'video';
  if (AUDIO.test(name)) return 'audio';
  if (/\.md$/i.test(name)) return 'markdown';
  if (TEXT.test(name)) return 'text';
  return 'other';
}

export function AttachmentPreview({ path, onClose }: { path: string; onClose: () => void }) {
  const name = path.split('/').at(-1)!;
  const url = 'plainote-file://v/' + encodeURIComponent(path);
  const kind = kindOf(name);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setText(null); setFailed(false);
    if (kind === 'text' || kind === 'markdown') {
      let cancelled = false;
      window.plainote?.readText(path).then(result => {
        if (cancelled) return;
        if (!result.ok) { setFailed(true); return; }
        setText(result.value);
      }).catch(() => { if (!cancelled) setFailed(true); });
      return () => { cancelled = true; };
    }
  }, [path, kind]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const body = () => {
    if (kind === 'image') return <img className="ap-image" src={url} alt={name} />;
    if (kind === 'pdf') return <iframe className="ap-frame" src={url} title={name} />;
    if (kind === 'video') return <video className="ap-media" src={url} controls />;
    if (kind === 'audio') return <audio className="ap-audio" src={url} controls />;
    if (kind === 'markdown' && text != null) return <div className="ap-md ai-md" dangerouslySetInnerHTML={{ __html: md.render(text) }} />;
    if (kind === 'text' && text != null) return <pre className="ap-text">{text}</pre>;
    if (kind === 'text' || kind === 'markdown') return <p className="ap-empty">{failed ? '无法读取文件内容。' : '加载中…'}</p>;
    return <p className="ap-empty">此文件类型暂不支持预览，可用右上角按钮用系统应用打开。</p>;
  };
  return <>
    <div className="preview-toolbar"><Icon name={IMAGE.test(name) ? 'image' : 'file'} /><span className="preview-name" title={path}>{name}</span><button className="icon-button" title="用系统应用打开" aria-label="用系统应用打开" onClick={() => void window.plainote?.openPath(path)}><Icon name="export" /></button><button className="icon-button" title="关闭" aria-label="关闭预览" onClick={onClose}><Icon name="close" /></button></div>
    <div className="ap-body">{body()}</div>
  </>;
}
