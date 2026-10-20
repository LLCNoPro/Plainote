const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
let app;
const output=path.resolve('.impeccable/review/outline');
async function eventually(fn){let last;for(let i=0;i<100;i++){try{return await fn();}catch(e){last=e;}await new Promise(r=>setTimeout(r,75));}throw last;}
(async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'plainote-outline-'));
  const vault=path.join(base,'vault'),data=path.join(base,'profile');
  await fs.mkdir(vault);await fs.mkdir(data);await fs.mkdir(output,{recursive:true});
  const source=Array.from({length:100},(_,i)=>`## 第 ${i+1} 节\n\n${'这是正文。'.repeat(200)}\n\n`).join('');
  const file=path.join(vault,'长文档.md');await fs.writeFile(file,source);
  await fs.writeFile(path.join(vault,'短文档.md'),'# 短文档\n\n普通正文');
  const env={...process.env,PLAINOTE_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require('electron'),args:['.',`--vault=${vault}`],cwd:path.resolve('.'),env});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[], workers=[];page.on('pageerror',e=>errors.push(e.message));page.on('worker',worker=>workers.push(worker.url()));
  await page.getByRole('button',{name:'长文档',exact:true}).first().click();
  const outline=page.getByRole('navigation',{name:'当前笔记大纲'});
  await eventually(async()=>assert.equal(await outline.getByRole('button').count(),100));
  assert.ok(workers.length>0,'全文大纲应在后台 Worker 提取');
  // All headings must exist before scrolling the document's editor.
  assert.ok(await page.locator('.cm-scroller').evaluate(e=>e.scrollTop)<10);
  await outline.getByRole('button',{name:'第 100 节',exact:true}).click();
  await eventually(async()=>assert.equal(await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;return v.state.doc.lineAt(v.state.selection.main.head).number;}),397));
  await eventually(async()=>assert.ok(await page.locator('.cm-scroller').evaluate(e=>e.scrollTop)>0));
  await page.screenshot({path:path.join(output,'last-heading.png')});
  await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowDown':'Control+End');
  await page.keyboard.insertText('\n### 新增末尾章节\n');
  await eventually(async()=>assert.equal(await outline.getByRole('button').count(),101));
  await eventually(async()=>assert.ok((await fs.readFile(file,'utf8')).endsWith('### 新增末尾章节\n')));
  await page.getByRole('button',{name:'短文档',exact:true}).first().click();
  await eventually(async()=>assert.equal(await outline.getByRole('button').count(),1));
  await page.getByRole('button',{name:'长文档',exact:true}).first().click();
  await eventually(async()=>assert.equal(await outline.getByRole('button').count(),101));
  await page.getByRole('button',{name:'阅读模式',exact:true}).click();
  assert.equal(await outline.getByRole('button').count(),101);
  await outline.getByRole('button',{name:'新增末尾章节',exact:true}).click();
  // Run a larger parse while the renderer's event loop keeps ticking.
  const background=await page.evaluate(url=>new Promise((resolve,reject)=>{
    const worker=new Worker(url,{type:'module'});let ticks=0;
    const interval=setInterval(()=>ticks++,5);
    const timeout=setTimeout(()=>{clearInterval(interval);worker.terminate();reject(new Error('后台解析超时'));},30000);
    worker.onerror=()=>{clearTimeout(timeout);clearInterval(interval);worker.terminate();reject(new Error('后台解析失败'));};
    worker.onmessage=event=>{clearTimeout(timeout);clearInterval(interval);worker.terminate();resolve({ticks,count:event.data.headings?.length,last:event.data.headings?.at(-1)?.text,error:event.data.error});};
    worker.postMessage('# 开始\n\n'+'较长的正文段落。\n\n'.repeat(300000)+'## 后台末尾标题\n');
  }),workers[0]);
  assert.equal(background.count,2);assert.equal(background.last,'后台末尾标题');assert.equal(background.error,undefined);
  assert.ok(background.ticks>0,'后台解析期间主界面事件循环应持续运行');
  assert.deepEqual(errors,[]);
  const report={status:'passed',checks:['首屏未滚动时100个标题完整显示','点击末尾标题准确跳转','编辑长文档后大纲更新和保存','长短笔记切换','阅读模式大纲完整','后台解析期间界面持续响应'],pageErrors:errors,background};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await app.close();app=null;
})().catch(async error=>{console.error(error);if(app){try{await(await app.firstWindow()).screenshot({path:path.join(output,'failure.png')});}catch{}app.process().kill('SIGKILL');}process.exit(1);});
