const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
let app;
const cwd = path.resolve('.');
const output = path.join(cwd, '.impeccable/review/move');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn) { let last; for (let i = 0; i < 80; i++) { try { return await fn(); } catch (e) { last = e; } await pause(75); } throw last; }
(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'plainote-move-'));
  const vault = path.join(base, '移动验证'), data = path.join(base, 'profile');
  await fs.mkdir(vault); await fs.mkdir(data); await fs.mkdir(output, { recursive: true });
  await fs.mkdir(path.join(vault, 'a')); await fs.mkdir(path.join(vault, 'b')); await fs.mkdir(path.join(vault, '待删'));
  await fs.writeFile(path.join(vault, 'a', '笔记.md'), '# 笔记\n');
  await fs.writeFile(path.join(vault, '旧名.md'), '# 旧名\n');
  await fs.writeFile(path.join(vault, '引用.md'), '见 [[旧名]]\n\n[笔记](a/笔记.md)\n');
  await fs.writeFile(path.join(vault, '待删', 'x.md'), '# x\n');
  await fs.writeFile(path.join(vault, '待删', '图.png'), 'img');
  const env = { ...process.env, PLAINOTE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: ['.', `--vault=${vault}`], cwd, env });
  const page = await app.firstWindow(); page.setDefaultTimeout(7000); const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 重命名笔记更新其它笔记中的双链引用
  await page.locator('.file-entry').filter({ has: page.locator('.file-row[title="旧名.md"]') }).hover();
  await page.getByRole('button', { name: '重命名笔记 旧名.md' }).click();
  await page.getByLabel('笔记名称', { exact: true }).fill('新名');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await eventually(async () => assert.ok((await fs.readFile(path.join(vault, '引用.md'), 'utf8')).includes('[[新名]]')));

  // 跨目录移动文件并更新指向它的普通链接
  await page.evaluate(() => { for (const d of document.querySelectorAll('.files-pane details')) d.setAttribute('open', ''); });
  await page.locator('.file-entry').filter({ has: page.locator('.file-row[title="a/笔记.md"]') }).hover();
  await page.getByRole('button', { name: '移动笔记 a/笔记.md' }).click();
  await page.locator('.move-dirs').getByRole('button', { name: 'b', exact: true }).click();
  await page.getByRole('button', { name: '移动到此处' }).click();
  await eventually(async () => assert.equal(await fs.access(path.join(vault, 'b', '笔记.md')).then(() => true, () => false), true));
  await eventually(async () => assert.ok((await fs.readFile(path.join(vault, '引用.md'), 'utf8')).includes('[笔记](b/笔记.md)')));

  // 删除目录：确认计数、走系统回收站、目录消失
  await page.locator('summary[title="待删"]').hover();
  await page.getByRole('button', { name: '删除目录 待删' }).click();
  await page.locator('.dialog-copy').filter({ hasText: '1 篇笔记、1 个附件' }).waitFor();
  await page.screenshot({ path: path.join(output, 'delete-directory.png') });
  await app.evaluate(({ shell }) => { globalThis.trashedDir = null; globalThis.originalTrashItem = shell.trashItem; shell.trashItem = async p => { globalThis.trashedDir = p; await globalThis.originalTrashItem(p); }; });
  await page.getByRole('button', { name: '移到回收站' }).click();
  await eventually(async () => assert.ok((await app.evaluate(() => globalThis.trashedDir))));
  await eventually(async () => assert.equal(await fs.access(path.join(vault, '待删')).then(() => true, () => false), false));

  await page.screenshot({ path: path.join(output, 'moved.png') });
  assert.deepEqual(errors, []);
  const report = { status: 'passed', checks: ['重命名更新双链引用', '跨目录移动更新普通链接', '删除目录确认计数', '删除目录走系统回收站'], pageErrors: errors };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await app.close(); app = null;
})().catch(async e => { console.error(e); if (app) { try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {} app.process().kill('SIGKILL'); } process.exit(1); });
