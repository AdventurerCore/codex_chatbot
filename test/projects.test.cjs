const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {listProjectCatalog}=require('../src/projects.cjs');
const {Store}=require('../src/store.cjs');

function directories(){
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'feishu-projects-')));
  const paths={a:path.join(dir,'Alpha'),b:path.join(dir,'项目 Beta'),c:path.join(dir,'Manual')};
  for(const folder of Object.values(paths))fs.mkdirSync(folder);
  return {dir,...paths,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function catalogClient(projects){return {request:async method=>{assert.equal(method,'project/list');return {data:projects,nextCursor:null};}};}
async function fixture(){
  const folders=directories(),store=new Store(path.join(folders.dir,'data'));
  const manual=store.addProject('Manual',folders.c),bot=await store.saveBot({name:'Test bot'});
  const client=catalogClient([{name:'Alpha',roots:[{path:folders.a}]},{name:'Beta',roots:[{path:folders.b}]}]);
  const catalog=await listProjectCatalog(client,store.state.projects);
  return {...folders,store,manual,bot,catalog};
}

test('Codex project discovery follows pagination, merges aliases and preserves configured names',async()=>{
  const f=directories();
  try{
    const alias=path.join(f.dir,'Alias');
    fs.symlinkSync(f.a,alias,process.platform==='win32'?'junction':'dir');
    const calls=[],configured=[{id:'kept',name:'Custom project name',path:f.a}];
    const client={request:async(method,params)=>{
      calls.push({method,params});
      return params.cursor?{data:[{name:'Multiple roots',roots:[{path:f.b},{path:f.c}]}],nextCursor:null}:{data:[{name:'Native Alpha',roots:[{path:alias}]}],nextCursor:'page-two'};
    }};
    const result=await listProjectCatalog(client,configured);
    assert.equal(result.warning,null);assert.equal(result.projects.length,3);
    assert.deepEqual(calls.map(call=>call.params.cursor),[null,'page-two']);
    assert.ok(calls.every(call=>call.method==='project/list'&&call.params.limit===100));
    const alpha=result.projects.find(project=>project.path===fs.realpathSync.native(f.a));
    assert.equal(alpha.projectId,'kept');assert.equal(alpha.name,'Custom project name');assert.equal(alpha.fromCodex,true);
    assert.deepEqual(configured,[{id:'kept',name:'Custom project name',path:f.a}]);
  }finally{f.cleanup();}
});

test('unavailable projects remain visible while invalid paths are omitted',async()=>{
  const f=directories();
  try{
    const missing=path.join(f.dir,'Unmounted');
    const client=catalogClient([{name:'Unavailable',roots:[{path:missing}]},{name:'Invalid',roots:[null,{path:'relative/path'},{path:'https://example.com'},{path:'bad\0path'}]}]);
    const result=await listProjectCatalog(client);
    assert.equal(result.warning,null);assert.equal(result.projects.length,1);
    assert.equal(result.projects[0].available,false);assert.equal(result.projects[0].path,missing);
  }finally{f.cleanup();}
});

test('catalog failures retain manually configured projects and expose a recoverable warning',async()=>{
  const f=directories();
  try{
    const result=await listProjectCatalog({request:async()=>{throw Error('Unsupported method');}},[{id:'manual',name:'Manual',path:f.c}]);
    assert.equal(result.projects.length,1);assert.equal(result.projects[0].projectId,'manual');assert.match(result.warning,/刷新/);
  }finally{f.cleanup();}
});

test('a repeated pagination cursor cannot loop forever or expose a partial catalog as complete',async()=>{
  let calls=0;
  const result=await listProjectCatalog({request:async()=>{calls++;return {data:[],nextCursor:'repeated'};}});
  assert.equal(calls,2);assert.match(result.warning,/无法读取/);
});

test('listing native candidates never adds them to the current bot access scope',async()=>{
  const f=await fixture();
  try{
    assert.equal(f.catalog.projects.length,3);
    assert.equal(f.store.state.projects.length,1);
    assert.deepEqual(f.store.projects(f.store.bot(f.bot.id)).map(project=>project.id),[f.manual.id]);
    assert.equal(JSON.parse(fs.readFileSync(f.store.file,'utf8')).projects.length,1);
  }finally{f.cleanup();}
});

test('saving multiple selected candidates persists only the selected bot scope across restart',async()=>{
  const f=await fixture();
  try{
    const selected=f.catalog.projects.filter(project=>!project.projectId);
    const result=f.store.saveProjectScope(f.bot.id,[selected[0].id,selected[1].id,selected[0].id],f.catalog.projects);
    assert.equal(result.allowedProjects.length,2);assert.equal(result.secret,undefined);
    const reloaded=new Store(f.store.dir),bot=reloaded.bot(f.bot.id);
    assert.equal(reloaded.state.projects.length,3);
    assert.deepEqual(new Set(reloaded.projects(bot).map(project=>project.path)),new Set([f.a,f.b]));
    assert.ok(!bot.allowedProjects.includes(f.manual.id));
    const catalog=await listProjectCatalog(catalogClient([{name:'Alpha',roots:[{path:f.a}]}]),reloaded.state.projects);
    assert.equal(catalog.projects.find(project=>project.path===f.a).id,selected.find(project=>project.path===f.a).id);
  }finally{f.cleanup();}
});

test('unknown selection ids cannot partially add directories or change permissions',async()=>{
  const f=await fixture();
  try{
    const before=fs.readFileSync(f.store.file,'utf8'),snapshot=structuredClone(f.store.state);
    const selected=f.catalog.projects.find(project=>!project.projectId);
    assert.throws(()=>f.store.saveProjectScope(f.bot.id,[selected.id,'unknown-project'],f.catalog.projects),/刷新/);
    assert.equal(fs.readFileSync(f.store.file,'utf8'),before);assert.deepEqual(f.store.state,snapshot);
  }finally{f.cleanup();}
});

test('a directory disappearing after discovery leaves all stored scope data unchanged',async()=>{
  const f=await fixture();
  try{
    const selected=f.catalog.projects.filter(project=>!project.projectId),before=fs.readFileSync(f.store.file,'utf8'),snapshot=structuredClone(f.store.state);
    fs.rmSync(f.b,{recursive:true});
    assert.throws(()=>f.store.saveProjectScope(f.bot.id,selected.map(project=>project.id),f.catalog.projects));
    assert.equal(fs.readFileSync(f.store.file,'utf8'),before);assert.deepEqual(f.store.state,snapshot);
  }finally{f.cleanup();}
});

test('unavailable new roots cannot be authorized and an explicit empty selection revokes access',async()=>{
  const f=await fixture();
  try{
    const catalog=await listProjectCatalog(catalogClient([{name:'Missing',roots:[{path:path.join(f.dir,'missing')}]}]),f.store.state.projects);
    const missing=catalog.projects.find(project=>!project.available);
    assert.throws(()=>f.store.saveProjectScope(f.bot.id,[missing.id],catalog.projects),/不可用/);
    f.store.saveProjectScope(f.bot.id,[],catalog.projects);
    assert.deepEqual(f.store.projects(f.store.bot(f.bot.id)),[]);
    assert.equal(f.store.state.projects.length,1);
  }finally{f.cleanup();}
});

test('a failed scope write does not change the in-memory permission state',async()=>{
  const f=await fixture();
  try{
    const snapshot=structuredClone(f.store.state),selected=f.catalog.projects.filter(project=>!project.projectId);
    f.store.file=path.join(f.dir,'not-a-file');fs.mkdirSync(f.store.file);
    assert.throws(()=>f.store.saveProjectScope(f.bot.id,selected.map(project=>project.id),f.catalog.projects));
    assert.deepEqual(f.store.state,snapshot);
  }finally{f.cleanup();}
});

test('revoking the current project clears its chat binding while keeping authorized and unrelated sessions',async()=>{
  const f=await fixture();
  try{
    const alpha=f.catalog.projects.find(project=>project.path===f.a);
    f.store.saveProjectScope(f.bot.id,[alpha.id],f.catalog.projects);
    const alphaId=f.store.projects(f.store.bot(f.bot.id))[0].id;
    f.store.state.sessions={revoked:{botId:f.bot.id,projectId:f.manual.id,threadId:'old-thread',effectiveModel:'old-model'},kept:{botId:f.bot.id,projectId:alphaId,threadId:'kept-thread'},other:{botId:'another-bot',projectId:f.manual.id,threadId:'other-thread'}};
    f.store.saveProjectScope(f.bot.id,[alpha.id],f.catalog.projects);
    assert.equal(f.store.state.sessions.revoked.projectId,null);assert.equal(f.store.state.sessions.revoked.threadId,null);
    assert.equal(f.store.state.sessions.kept.threadId,'kept-thread');assert.equal(f.store.state.sessions.other.threadId,'other-thread');
  }finally{f.cleanup();}
});

test('importing selected roots for one bot preserves every other bot existing access',async()=>{
  const f=await fixture();
  try{
    const other=await f.store.saveBot({name:'Other bot'});
    assert.deepEqual(f.store.projects(f.store.bot(other.id)).map(project=>project.id),[f.manual.id]);
    const selected=f.catalog.projects.filter(project=>!project.projectId);
    f.store.saveProjectScope(f.bot.id,selected.map(project=>project.id),f.catalog.projects);
    assert.deepEqual(f.store.projects(f.store.bot(other.id)).map(project=>project.id),[f.manual.id]);
    assert.equal(f.store.projects(f.store.bot(f.bot.id)).length,2);
  }finally{f.cleanup();}
});
