const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {Store,dataDir,atomic}=require('./store.cjs');
const {CodexClient}=require('./codex.cjs');
const {Bridge}=require('./bridge.cjs');
const PORT=Number(process.env.CODEX_FEISHU_PORT||23947);
const runtimePath=path.join(dataDir,'runtime.json');
const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function runtime(){try{return JSON.parse(fs.readFileSync(runtimePath,'utf8'));}catch{return null;}}
async function apiCall(info,action,args={}){
  const r=await fetch(`http://127.0.0.1:${info.port}/api`,{method:'POST',headers:{authorization:`Bearer ${info.token}`,'content-type':'application/json'},body:JSON.stringify({action,args}),signal:AbortSignal.timeout(action==='diagnose'?45000:30000)});
  const body=await r.json();if(!r.ok||body.error)throw Error(body.error||`本地服务错误 ${r.status}`);return body;
}
async function ensureDaemon(){
  let info=runtime();if(info)try{await apiCall(info,'status');return info;}catch{}
  fs.mkdirSync(dataDir,{recursive:true});const fd=fs.openSync(path.join(dataDir,'service.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'dist/main.cjs'),'serve'],{detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:process.env});child.unref();fs.closeSync(fd);
  for(let i=0;i<50;i++){await delay(200);info=runtime();if(info)try{await apiCall(info,'status');return info;}catch{}}
  throw Error('本地飞书服务未能启动。请查看 '+path.join(dataDir,'service.log'));
}
async function serve(){
  const store=new Store(),codex=new CodexClient(),bridge=new Bridge(store,codex);
  const token=crypto.randomBytes(32).toString('hex');
  async function dispatch(action,args={}){
    if(action==='status')return bridge.view();
    if(action==='diagnose'){let health;try{health=await codex.health();}catch(e){health={connected:false,error:e.message};}return {codex:health,...bridge.view()};}
    if(action==='create_bot')return store.saveBot({name:args.name||'新机器人',provider:args.provider||'feishu'});
    if(action==='save_bot'){
      const before=store.bot(args.id);if(args.enabled===false||args.ownerId!==undefined||args.secret||args.appId!==undefined||args.allowedProjects!==undefined)await bridge.cancelChat(args.id);
      const reconnect=['enabled','appId','secret','provider'].some(k=>args[k]!==undefined&&args[k]!==before[k]);const result=await store.saveBot(args);if(reconnect)await bridge.refresh(args.id);return result;
    }
    if(action==='delete_bot'){
      store.bot(args.id);await bridge.cancelChat(args.id);bridge.transports.get(args.id)?.close();bridge.transports.delete(args.id);bridge.registration.flows.delete(args.id);
      store.state.bots=store.state.bots.filter(b=>b.id!==args.id);for(const [key,s]of Object.entries(store.state.sessions))if(s.botId===args.id)delete store.state.sessions[key];store.save();return {ok:true};
    }
    if(action==='unlink'){
      const b=store.bot(args.id);await bridge.cancelChat(args.id);bridge.transports.get(args.id)?.close();bridge.transports.delete(args.id);bridge.registration.flows.delete(args.id);bridge.bindCodes.delete(args.id);
      b.enabled=false;b.ownerId='';b.groups=[];delete b.secret;delete b.appId;for(const [key,s]of Object.entries(store.state.sessions))if(s.botId===args.id)delete store.state.sessions[key];store.save();return {ok:true};
    }
    if(action==='reconnect'){await bridge.refresh(args.id);return {ok:true};}
    if(action==='group_remove'){const b=store.bot(args.id);if(typeof args.chatId!=='string')throw Error('群聊 ID 无效');await bridge.cancelChat(args.id,args.chatId);b.groups=b.groups.filter(x=>x!==args.chatId);store.save();return {ok:true};}
    if(action==='add_project')return store.addProject(args.name,args.path);
    if(action==='begin_registration')return bridge.registration.begin(args.id);
    if(action==='poll_registration')return bridge.registration.poll(args.id);
    if(action==='bind_code')return bridge.bindCode(args.id);
    if(action==='stop_service'){setTimeout(()=>shutdown(),100);return {ok:true};}
    throw Error('未知操作');
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(req.headers.host!==`127.0.0.1:${PORT}`){res.writeHead(403);res.end();return;}
    if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");res.end(fs.readFileSync(path.join(root,'dist/dashboard.html')));return;}
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method!=='POST'||req.url!=='/api'){res.writeHead(404);res.end('{}');return;}
    if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${PORT}`){res.writeHead(403);res.end('{"error":"Origin rejected"}');return;}
    const given=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
    if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected)){res.writeHead(401);res.end('{"error":"请从本机启动器或 Codex 插件打开管理页"}');return;}
    let size=0,body='';req.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy();return;}body+=chunk;});
    req.on('end',async()=>{try{const parsed=JSON.parse(body);if(typeof parsed.action!=='string'||!parsed.args||typeof parsed.args!=='object'||Array.isArray(parsed.args))throw Error('无效请求');const result=await dispatch(parsed.action,parsed.args);res.end(JSON.stringify(result));}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
  });
  server.on('error',e=>{if(e.code==='EADDRINUSE')process.exit(0);console.error('Service:',e.message);process.exit(1);});
  server.listen(PORT,'127.0.0.1',()=>{atomic(runtimePath,{port:PORT,token,pid:process.pid,version:'0.1.1'});bridge.start();console.log('Codex Feishu service listening on 127.0.0.1:'+PORT);});
  async function shutdown(){await bridge.stop();server.close();const r=runtime();if(r?.pid===process.pid)fs.rmSync(runtimePath,{force:true});process.exit(0);}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
function openBrowser(url){const script='Start-Process -FilePath $env:CODEX_FEISHU_OPEN_URL';return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore',env:{...process.env,CODEX_FEISHU_OPEN_URL:url}});p.on('error',reject);p.on('exit',code=>code?reject(Error('无法打开默认浏览器')):resolve());});}
module.exports={serve,ensureDaemon,apiCall,runtime,openBrowser,root};
