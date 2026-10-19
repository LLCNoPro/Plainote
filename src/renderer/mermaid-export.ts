import { renderMermaidSvg } from './mermaid-render.ts';

declare global {
  interface Window { plainoteMermaidExport: (source: string) => Promise<{ width: number; height: number }> }
}
window.plainoteMermaidExport = async source => {
  await document.fonts.ready;
  const svg = await renderMermaidSvg(source, false);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('图表尺寸无效');
  image.width = image.naturalWidth;
  image.height = image.naturalHeight;
  document.body.replaceChildren(image);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { width: image.naturalWidth, height: image.naturalHeight };
};
