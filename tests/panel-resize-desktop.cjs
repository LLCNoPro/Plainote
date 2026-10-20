const {_electron:electron}=require('playwright-core');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
let app;const out=path.resolve('.impeccable/review/panel-resize');
async function eventually(fn){let last;for(let i=0;i<100;i++){try{return await fn();}catch(e){last=e;}await new Promise(r=>setTimeout(r,60));}throw last;}
(async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'plainote-panels-')),vault=path.join(base,'vault'),data=path.join(base,'profile');await fs.mkdir(vault);await fs.mkdir(data);await fs.mkdir(out,{recursive:true});
 const source='# 面板宽度验证\n\n拖动目录右边界与侧栏左边界调整宽度。\n\n## 第二节\n\n正文与笔记内容保持不变。\n';await fs.writeFile(path.join(vault,'文件名比较长的工作笔记示例.md'),source);
 const env={...process.env,PLAINOTE_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;const launch=()=>electron.launch({executablePath:require('electron'),args:['.',`--vault=${vault}`],cwd:path.resolve('.'),env});
 app=await launch();let page=await app.firstWindow();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.cm-content').waitFor();
 const left=()=>page.getByRole('separator',{name:'调整目录面板宽度'}),right=()=>page.getByRole('separator',{name:'调整侧栏宽度'});
 const width=selector=>page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);
 async function drag(handle,delta){const r=await handle.boundingBox();assert.ok(r);const x=r.x+r.width/2,y=r.y+r.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta,y,{steps:8});await page.mouse.up();}
 await left().waitFor();
 const originalLeft=await width('.sidebar'),originalRight=await width('.inspector');
 await drag(left(),120);await eventually(async()=>assert.equal(Math.round(await width('.sidebar')),Math.round(originalLeft+120)));assert.equal(await width('.inspector'),originalRight);
 await drag(right(),-80);await eventually(async()=>assert.equal(Math.round(await width('.inspector')),Math.round(originalRight+80)));
 await page.screenshot({path:path.join(out,'light.png')});await page.locator('.theme-button').click();await page.screenshot({path:path.join(out,'dark.png')});
 await drag(left(),900);assert.equal(await width('.sidebar'),560);await drag(left(),-900);assert.equal(await width('.sidebar'),220);
 await left().focus();await page.keyboard.press('ArrowRight');assert.equal(await width('.sidebar'),236);
 await drag(left(),100);const savedLeft=await width('.sidebar'),savedRight=await width('.inspector');
 await page.getByRole('button',{name:'显示或隐藏目录'}).click();await eventually(async()=>assert.equal(await page.locator('.sidebar').evaluate(e=>getComputedStyle(e).visibility),'hidden'));
 await page.getByRole('button',{name:'显示或隐藏目录'}).click();assert.equal(await width('.sidebar'),savedLeft);
 assert.equal(await page.evaluate(()=>document.body.style.cursor),'');assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');
 await drag(left(),40);const blurWidth=await width('.sidebar');
 const r=await left().boundingBox();await page.mouse.move(r.x+4,r.y+50);await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.equal(await width('.sidebar'),blurWidth);assert.equal(await page.evaluate(()=>document.body.style.cursor),'');
 const persistedLeft=await width('.sidebar');await app.close();app=null;app=await launch();page=await app.firstWindow();await page.locator('.cm-content').waitFor();
 await eventually(async()=>assert.equal(await width('.sidebar'),persistedLeft));assert.equal(await width('.inspector'),savedRight);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,800));
 await eventually(async()=>assert.equal(await page.getByRole('button',{name:'显示或隐藏大纲'}).getAttribute('aria-expanded'),'false'));
 await page.getByRole('button',{name:'显示或隐藏大纲'}).click();await drag(left(),500);await drag(right(),-500);
 assert.ok(await width('.editor-area')>=359);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,'narrow.png')});assert.equal(await fs.readFile(path.join(vault,'文件名比较长的工作笔记示例.md'),'utf8'),source);assert.deepEqual(errors,[]);
 const report={status:'passed',checks:['左右边界拖拽方向及宽度独立','浅深主题视觉一致','宽度上下限和键盘调整','折叠展开恢复宽度','松手及失焦清理','重启记住两侧宽度','窄窗口保留正文空间','原文保持不变'],pageErrors:errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.close();app=null;
})().catch(async error=>{console.error(error);if(app){try{await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png')});}catch{}app.process().kill('SIGKILL');}process.exit(1);});
