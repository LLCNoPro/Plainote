import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
export function createMermaidExporter() {
  let renderer: BrowserWindow | null = null;
  const dispose = () => { if (renderer && !renderer.isDestroyed()) renderer.destroy(); renderer = null; };
  async function render(source: string): Promise<{ png: Uint8Array; width: number; height: number }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (!renderer) {
            renderer = new BrowserWindow({ show: false, width: 800, height: 600, backgroundColor: '#ffffff', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: 'mermaid-export-' + randomUUID() } });
            renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            renderer.webContents.on('will-navigate', event => event.preventDefault());
            renderer.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
              // The development server is the only optional HTTP origin.
              const allowed = process.env.PLAINOTE_DEV_URL && new URL(details.url).origin === new URL(process.env.PLAINOTE_DEV_URL).origin;
              callback({ cancel: !allowed });
            });
            if (process.env.PLAINOTE_DEV_URL) await renderer.loadURL(new URL('/mermaid-export.html', process.env.PLAINOTE_DEV_URL).href);
            else await renderer.loadFile(path.join(directory, '../../dist-renderer/mermaid-export.html'));
          }
          const target = renderer;
          const dimensions: { width: number; height: number } = await target.webContents.executeJavaScript(`window.plainoteMermaidExport(${JSON.stringify(source)})`);
          const { width, height } = dimensions;
          if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('图表尺寸无效');
          const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(32_000_000 / (width * height)));
          const pixels = { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
          target.webContents.setZoomFactor(scale);
          target.setContentSize(pixels.width, pixels.height);
          await target.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          // capturePage supports SVG foreignObject labels, unlike a canvas
          // conversion which Chromium marks as tainted for such SVG images.
          const screenshot = await target.webContents.capturePage({ x: 0, y: 0, ...pixels }, { stayHidden: true, stayAwake: true });
          if (screenshot.isEmpty()) throw new Error('图表截图为空');
          return { png: screenshot.resize({ ...pixels, quality: 'best' }).toPNG(), width, height };
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('图表渲染超过 30 秒，请简化图表后重试。')), 30000); }),
      ]);
    } catch (error) {
      dispose();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return { render, dispose };
}
