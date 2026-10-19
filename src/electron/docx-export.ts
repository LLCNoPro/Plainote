import path from 'node:path';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

interface DiagramImage { path: string; width: number; height: number }
export async function replaceMermaidBlocks(document: unknown, render: (source: string, index: number) => Promise<DiagramImage>): Promise<unknown> {
  let index = 0;
  async function visit(value: unknown, depth = 0): Promise<unknown> {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) value[i] = await visit(value[i], depth);
    } else if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      const code = node.c;
      if (node.t === 'CodeBlock' && Array.isArray(code) && Array.isArray(code[0]) && Array.isArray(code[0][1]) && code[0][1].includes('mermaid') && typeof code[1] === 'string') {
        index++;
        try {
          const image = await render(code[1], index);
          if (!(image.width > 0 && image.height > 0 && Number.isFinite(image.width) && Number.isFinite(image.height))) throw new Error('图表尺寸无效');
          // Existing reference.docx has 5.77in of usable width. Bound height as
          // well, so tall state diagrams fit without running off the page.
          const availableWidth = Math.max(0.5, 5.7 - depth * 0.6);
          const ratio = Math.min(1 / 96, availableWidth / image.width, 8.5 / image.height);
          const attributes = [['width', `${(image.width * ratio).toFixed(4)}in`], ['height', `${(image.height * ratio).toFixed(4)}in`]];
          const paragraph = { t: 'Para', c: [{ t: 'Image', c: [['', [], attributes], [], [image.path, '']] }] };
          // Figure is centered and has no first-line indentation in the existing
          // reference template. Body Text's indentation would push wide images
          // beyond the right margin even when their own width fits the page.
          return { t: 'Div', c: [['', [], [['custom-style', 'Figure']]], [paragraph]] };
        } catch (error) {
          throw new Error(`第 ${index} 个 Mermaid 图表导出失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const nestedDepth = depth + (['BlockQuote', 'BulletList', 'OrderedList', 'DefinitionList'].includes(String(node.t)) ? 1 : 0);
      for (const key of Object.keys(node)) node[key] = await visit(node[key], nestedDepth);
    }
    return value;
  }
  return visit(document);
}

export function runPandoc(cmd: string, args: string[], timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stderr = '', timedOut = false;
    // Wait for close before rejecting: temp files must not be removed while
    // Pandoc still holds them open, particularly on Windows.
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, timeoutMs);
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    proc.on('error', error => { clearTimeout(timer); reject(new Error('无法运行 Pandoc：' + error.message)); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Pandoc 转换超时，请缩小文档后重试。'));
      else code === 0 ? resolve() : reject(new Error('Pandoc 转换失败：' + (stderr.trim() || '未知错误')));
    });
  });
}

interface ExportOptions {
  cmd: string; content: string; destination: string; reference: string | null; resourcePaths: string[];
  render: (source: string) => Promise<{ png: Uint8Array; width: number; height: number }>;
}
export async function exportDocxDocument(options: ExportOptions): Promise<void> {
  // Keep the completed file on the destination filesystem for atomic rename.
  const temporary = await mkdtemp(path.join(path.dirname(options.destination), '.plainote-export-'));
  try {
    const input = path.join(temporary, 'note.md'), ast = path.join(temporary, 'note.json'), output = path.join(temporary, 'result.docx');
    await writeFile(input, options.content, 'utf8');
    await runPandoc(options.cmd, [input, '--from=markdown', '--to=json', '-o', ast]);
    const document = JSON.parse(await readFile(ast, 'utf8'));
    await replaceMermaidBlocks(document, async (source, index) => {
      const image = await options.render(source);
      const filename = path.join(temporary, `mermaid-${index}.png`);
      await writeFile(filename, image.png);
      return { path: filename, width: image.width, height: image.height };
    });
    await writeFile(ast, JSON.stringify(document), 'utf8');
    const args = [ast, '--from=json', '--to=docx', `--resource-path=${options.resourcePaths.join(path.delimiter)}`, '-o', output];
    if (options.reference) args.push('--reference-doc', options.reference);
    await runPandoc(options.cmd, args);
    await rename(output, options.destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
