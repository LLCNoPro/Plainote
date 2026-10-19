import { EditorView, WidgetType } from '@codemirror/view';

import { renderMermaidSvg } from './mermaid-render.ts';

export class MermaidWidget extends WidgetType {
  private dispose?: () => void;
  constructor(readonly source: string, readonly from: number, readonly edit: (view: EditorView, from: number) => void, readonly readOnly: boolean) { super(); }
  eq(other: MermaidWidget) { return this.source === other.source && this.from === other.from && this.readOnly === other.readOnly; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'lp-mermaid-preview';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', view.state.readOnly ? 'group' : 'button');
    wrap.setAttribute('aria-label', view.state.readOnly ? 'Mermaid 图表' : 'Mermaid 图表，点击或按回车编辑源码');
    const content = document.createElement('div');
    content.className = 'lp-mermaid-content';
    wrap.append(content);
    let disposed = false, generation = 0;
    const render = async () => {
      const current = ++generation;
      content.textContent = '图表加载中…';
      wrap.setAttribute('aria-busy', 'true');
      try {
        const svg = await renderMermaidSvg(this.source, document.documentElement.dataset.theme === 'dark');
        if (disposed || current !== generation) return;
        // Use an image to isolate SVG styles/IDs and disable active SVG content.
        const img = document.createElement('img');
        img.alt = 'Mermaid 图表';
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        if (disposed || current !== generation) return;
        content.replaceChildren(img);
      } catch (error) {
        if (disposed || current !== generation) return;
        const message = document.createElement('p');
        message.className = 'lp-mermaid-error';
        message.textContent = 'Mermaid 图表无法渲染，请检查源码。';
        const detail = document.createElement('pre');
        detail.textContent = error instanceof Error ? error.message : String(error);
        const source = document.createElement('pre');
        source.textContent = this.source;
        content.replaceChildren(message, detail, source);
      } finally {
        if (!disposed && current === generation) { wrap.removeAttribute('aria-busy'); view.requestMeasure(); }
      }
    };
    const observer = new MutationObserver(() => { void render(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.dispose = () => { disposed = true; observer.disconnect(); };
    const edit = () => { if (!view.state.readOnly) this.edit(view, this.from); };
    wrap.addEventListener('mousedown', event => { if (event.button === 0 && !view.state.readOnly) event.preventDefault(); });
    // Replace the widget after mouseup, so the remaining pointer events cannot
    // reposition the newly focused editor using the old diagram's coordinates.
    wrap.addEventListener('click', event => { if (event.button === 0 && !view.state.readOnly) { event.preventDefault(); edit(); } });
    wrap.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !view.state.readOnly) { event.preventDefault(); edit(); } });
    void render();
    return wrap;
  }
  destroy() { this.dispose?.(); }
  ignoreEvent() { return true; }
}
