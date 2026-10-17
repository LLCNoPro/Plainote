const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
let app;
const cwd = path.resolve('.');
const output = path.join(cwd, '.impeccable/review/attachments');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn) { let last; for (let i = 0; i < 80; i++) { try { return await fn(); } catch (e) { last = e; } await pause(75); } throw last; }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'plainote-att-'));
  const vault = path.join(base, '附件验证'), data = path.join(base, 'profile');
  await fs.mkdir(vault); await fs.mkdir(data); await fs.mkdir(output, { recursive: true });
  await fs.mkdir(path.join(vault, 'attachments'), { recursive: true });
  await fs.writeFile(path.join(vault, 'attachments', '图.png'), Buffer.from(PNG, 'base64'));
  await fs.writeFile(path.join(vault, '附 件.txt'), 'hello attachment');
  const source = '# 图片\n\n![说明](attachments/图.png)\n\n![[attachments/图.png]]\n\n![缺失](attachments/缺失.png)\n\n[打开附件](附%20件.txt)\n';
  await fs.writeFile(path.join(vault, '图片.md'), source);
  const env = { ...process.env, PLAINOTE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: ['.', `--vault=${vault}`], cwd, env });
  const page = await app.firstWindow(); page.setDefaultTimeout(7000); const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 两种图片语法均以受控协议渲染
  await page.locator('.lp-image-preview img').first().waitFor();
  await eventually(async () => assert.equal(await page.locator('.lp-image-preview img').count(), 2));
  const srcs = await page.locator('.lp-image-preview img').evaluateAll(nodes => nodes.map(n => n.getAttribute('src')));
  assert.ok(srcs.every(s => s.startsWith('plainote-file://v/')), '图片应通过受控协议加载');

  // 缺失图片占位
  await page.locator('.lp-image-missing-box').filter({ hasText: '不存在' }).waitFor();

  // 点击放大与 Esc 关闭
  await page.locator('.lp-image-preview img').first().click();
  await page.locator('.lp-lightbox').waitFor();
  await page.screenshot({ path: path.join(output, 'lightbox.png') });
  await page.keyboard.press('Escape');
  await eventually(async () => assert.equal(await page.locator('.lp-lightbox').count(), 0));

  // 点击本地附件链接在应用内预览（新标签页），预览中可再转系统应用打开
  await app.evaluate(({ shell }) => { globalThis.openedPath = null; shell.openPath = async p => { globalThis.openedPath = p; return ''; }; });
  await page.locator('.lp-link').click();
  await page.locator('.preview-toolbar').waitFor();
  await page.getByRole('button', { name: '用系统应用打开' }).click();
  await eventually(async () => assert.ok((await app.evaluate(() => globalThis.openedPath)), '预览中调用系统打开应触发 openPath'));
  const opened = await app.evaluate(() => globalThis.openedPath);
  assert.equal(path.basename(opened), '附 件.txt');
  await page.getByRole('button', { name: '关闭预览' }).click();

  // 拖入图片导入：写入附件目录并在笔记插入引用
  await page.locator('.cm-content').click();
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const file = new File([bytes], '粘贴 2024.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const el = document.querySelector('.cm-content');
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 40, clientY: rect.top + 40 }));
  });
  await eventually(async () => assert.equal(await fs.access(path.join(vault, 'attachments', '粘贴 2024.png')).then(() => true, () => false), true));
  await eventually(async () => assert.ok((await fs.readFile(path.join(vault, '图片.md'), 'utf8')).includes('粘贴%202024.png')));
  assert.ok((await fs.readFile(path.join(vault, '图片.md'), 'utf8')).includes('![粘贴 2024.png](attachments/粘贴%202024.png)'));

  // 附件位置设置持久化
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '当前笔记旁', exact: true }).click();
  await page.getByLabel('附件目录').fill('assets');
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await eventually(async () => {
    const cfg = JSON.parse(await fs.readFile(path.join(data, 'attachment-config.json'), 'utf8'));
    const entry = Object.values(cfg.vaults)[0];
    assert.equal(entry.mode, 'note');
    assert.equal(entry.dir, 'assets');
  });

  await page.screenshot({ path: path.join(output, 'images.png') });
  assert.deepEqual(errors, []);
  const report = { status: 'passed', checks: ['两种图片语法预览', '受控协议加载', '缺失图片占位', '点击放大与 Esc 关闭', '点击附件应用内预览并转系统打开', '拖入导入写入附件并插入引用', '附件位置配置持久化'], pageErrors: errors };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await app.close(); app = null;
})().catch(async e => { console.error(e); if (app) { try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {} app.process().kill('SIGKILL'); } process.exit(1); });
