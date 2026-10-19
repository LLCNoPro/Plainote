import { EditorView, WidgetType } from '@codemirror/view';

// Keep Mermaid out of the initial editor bundle. All diagram chunks are local.
let library: Promise<typeof import('mermaid')> | undefined;
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

function renderDiagram(source: string, dark: boolean): Promise<string> {
  const key = JSON.stringify([source, dark]);
  const cached = cache.get(key);
  if (cached) return cached;
  // initialize mutates global configuration, so serialize it with rendering.
  const pending = queue.then(async () => {
    const { default: mermaid } = await (library ??= import('mermaid').catch(error => { library = undefined; throw error; }));
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic',
      suppressErrorRendering: true, fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
      themeVariables: {
        darkMode: dark, background: dark ? '#1c231f' : '#f2efe9',
        primaryColor: dark ? '#34473b' : '#e3ece4', primaryTextColor: dark ? '#e2e8df' : '#2d3732',
        primaryBorderColor: dark ? '#a0c6b3' : '#356b59', lineColor: dark ? '#adb8ac' : '#59655c',
        secondaryColor: dark ? '#2a322d' : '#fffdf9', tertiaryColor: dark ? '#303a32' : '#e9e8df',
      },
    });
    const { svg } = await mermaid.render(`plainote-mermaid-${++sequence}`, source);
    // Mermaid emits width="100%", which makes SVG images grow to the full
    // manuscript width. Give them explicit natural dimensions instead.
    // Mermaid labels can contain HTML void elements such as <br>. Parse the
    // sanitized output as an inert HTML fragment first, then serialize it as
    // well-formed XML for the SVG image decoder. Never mount the fragment.
    const fragment = document.createElement('template');
    fragment.innerHTML = svg;
    const root = fragment.content.querySelector('svg');
    if (!root) throw new Error('Mermaid 未生成有效的 SVG 图表。');
    const bounds = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (bounds?.length === 4 && bounds[2] > 0 && bounds[3] > 0) {
      root.setAttribute('width', String(bounds[2]));
      root.setAttribute('height', String(bounds[3]));
    }
    return new XMLSerializer().serializeToString(root);
  });
  queue = pending.catch(() => {});
  cache.set(key, pending);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  return pending;
}

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
        const svg = await renderDiagram(this.source, document.documentElement.dataset.theme === 'dark');
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
