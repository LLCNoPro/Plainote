// Keep Mermaid out of the initial editor bundle. All diagram chunks are local.
let library: Promise<typeof import('mermaid')> | undefined;
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

export function renderMermaidSvg(source: string, dark: boolean): Promise<string> {
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

