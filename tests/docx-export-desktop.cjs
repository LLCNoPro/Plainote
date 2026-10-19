const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
let app;
const pandoc = process.env.PLAINOTE_TEST_PANDOC || 'pandoc';
const output = path.resolve('.impeccable/review/mermaid-docx');
async function eventually(fn) { let last; for(let i=0;i<100;i++){try{return await fn();}catch(e){last=e;}await new Promise(r=>setTimeout(r,75));}throw last; }
(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'plainote-docx-'));
  const vault = path.join(base,'vault'), data = path.join(base,'profile'), noteDir = path.join(vault,'资料');
  await fs.mkdir(noteDir,{recursive:true}); await fs.mkdir(data); await fs.mkdir(output,{recursive:true});
  const circuitBreaker = await fs.readFile('tests/fixtures/mermaid-circuit-breaker.md','utf8');
  const source = '# 导出验证\n\n正文保留：中文、链接与普通代码。\n\n```js\nconst keepSource = 1;\n```\n\n## 流程图\n\n```mermaid\nflowchart LR\nA[开始] --> B[完成]\n```\n\n## 状态图\n\n' + circuitBreaker + '\n\n## 引用与列表\n\n> ```mermaid\n> flowchart LR\n> X[引用] --> Y[图表]\n> ```\n\n- 列表里的图表\n\n  ```mermaid\n  sequenceDiagram\n    Alice->>Bob: 你好\n  ```\n\n## 原有图片\n\n![](原图.png)\n';
  const wideDiagram = '```mermaid\nflowchart LR\n' + Array.from({length:12},(_,i)=>`N${i}[节点${i}] --> N${i+1}[节点${i+1}]`).join('\n') + '\n```';
  const wideSource = '# 嵌套宽图\n\n> 引用中的宽图\n>\n' + wideDiagram.split('\n').map(line=>'> '+line).join('\n') + '\n\n- 列表中的宽图\n\n' + wideDiagram.split('\n').map(line=>'  '+line).join('\n');
  const noteFile=path.join(noteDir,'导出验证.md'); await fs.writeFile(noteFile,source);
  // A 1px existing PNG exercises resource resolution relative to the note.
  await fs.writeFile(path.join(noteDir,'原图.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
  const env={...process.env,PLAINOTE_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require('electron'),args:['.',`--vault=${vault}`],cwd:path.resolve('.'),env});
  const page=await app.firstWindow();page.setDefaultTimeout(20000);
  const errors=[],external=[];
  const track=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});};
  track(page);app.on('window',track);
  await page.locator('.cm-content').waitFor();
  await page.locator('.theme-button').click();
  async function saveTo(destination){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:!file,filePath:file});},destination);}
  async function exportContent(content){return page.evaluate(async ({content,pandoc})=>window.plainote.exportDocx(content,'资料/导出验证.md',pandoc),{content,pandoc});}
  const destination=path.join(output,'export.docx');
  await saveTo(destination);
  const result=await exportContent(source);
  assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.value,destination);
  assert.equal(await fs.readFile(noteFile,'utf8'),source);
  const report=JSON.parse(execFileSync('python3',['-c',`import json,sys,struct
from zipfile import ZipFile
from xml.etree import ElementTree as E
z=ZipFile(sys.argv[1]);ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
r=E.fromstring(z.read('word/document.xml'));media=[n for n in z.namelist() if n.startswith('word/media/')]
images=[]
for n in media:
 b=z.read(n);assert b[:8]==b'\\x89PNG\\r\\n\\x1a\\n';w,h=struct.unpack('>II',b[16:24]);images.append({'name':n,'width':w,'height':h})
print(json.dumps({'images':images,'text':''.join(r.itertext()),'extents':[[int(e.get('cx')),int(e.get('cy'))] for e in r.findall('.//wp:extent',ns)],'blocks':len(r.findall('.//w:drawing',ns))}))`,destination],{encoding:'utf8'}));
  assert.equal(report.images.length,5,JSON.stringify(report));
  assert.equal(report.blocks,5);
  assert.ok(report.images.filter(i=>i.width>1).every(i=>i.width>300));
  assert.ok(report.text.includes('const keepSource = 1;'));
  assert.equal(report.text.includes('stateDiagram-v2'),false);
  assert.equal(report.text.includes('flowchart LR'),false);
  assert.ok(report.extents.every(([w,h])=>w<=5.71*914400&&h<=8.51*914400));
  await eventually(async()=>assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1));
  // Failed renders must preserve an already-existing destination and clean up.
  const before=await fs.readFile(destination);
  const invalid=await exportContent('```mermaid\nflowchart LR\nA[broken\n```');
  assert.equal(invalid.ok,false); assert.match(invalid.error.message,/第 1 个 Mermaid 图表导出失败/);
  assert.deepEqual(await fs.readFile(destination),before);
  await eventually(async()=>assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1));
  await saveTo(path.join(output,'nested-wide.docx'));
  assert.equal((await exportContent(wideSource)).ok,true);
  const nestedExtents=JSON.parse(execFileSync('python3',['-c',"import json,sys;from zipfile import ZipFile;from xml.etree import ElementTree as E;r=E.fromstring(ZipFile(sys.argv[1]).read('word/document.xml'));print(json.dumps([int(e.get('cx')) for e in r.iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}extent')]))",path.join(output,'nested-wide.docx')],{encoding:'utf8'}));
  assert.equal(nestedExtents.length,2);
  assert.ok(nestedExtents.every(width=>width<=5.1*914400));
  await saveTo(null);
  assert.deepEqual(await exportContent(source),{ok:true,value:null});
  await fs.unlink(noteFile); // An open note can still export after its disk file was removed.
  await saveTo(path.join(output,'ordinary.docx'));
  assert.equal((await exportContent('# 普通文档\n\n```js\nconst x = 1;\n```')).ok,true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  assert.equal((await fs.readdir(output)).some(n=>n.startsWith('.plainote-export-')),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const checks=['流程图/状态图/引用/列表转换为PNG','原有相对图片保留','DOCX图片嵌入与页面尺寸','深色界面导出浅色图片','普通代码和笔记原文保留','失败不覆盖已有DOCX','取消与临时文件清理','隐藏窗口销毁','无图表及磁盘原文缺失时导出','嵌套宽图适配页面'];
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks,document:report,pageErrors:errors,externalRequests:external},null,2));
  console.log(JSON.stringify({status:'passed',checks,images:report.images}));
  await app.close();app=null;
})().catch(async error=>{console.error(error);if(app)app.process().kill('SIGKILL');process.exit(1);});
