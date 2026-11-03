const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const dataDir = process.env.CODEX_FEISHU_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'CodexFeishuBridge');
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});
  fs.renameSync(temp,file);
}
function canonical(p) { return fs.realpathSync.native(path.resolve(p)); }
function samePath(a,b) { const normalize=p=>process.platform==='win32'?p.toLowerCase():p;return normalize(canonical(a))===normalize(canonical(b)); }
function secretTransform(value, decrypt=false) {
  if(process.platform!=='win32') throw Error('此版本使用 Windows DPAPI 保存凭据，需要 Windows。');
  const script="Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::"+(decrypt?'Unprotect':'Protect')+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))";
  return new Promise((resolve,reject)=>{
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();p.on('error',reject);
    p.on('close',code=>code?reject(Error('Windows 凭据加密/解密失败')):resolve(decrypt?Buffer.from(out.trim(),'base64').toString('utf8'):out.trim()));
    p.stdin.end(decrypt?value:Buffer.from(value,'utf8').toString('base64'));
  });
}
class Store {
  constructor(dir=dataDir) {
    this.dir=dir;this.file=path.join(dir,'state.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,bots:[],projects:[],sessions:{},seen:[]};
    if(this.state.version!==1) throw Error('Unsupported state version');
  }
  save(){atomic(this.file,this.state);}
  bot(id){const b=this.state.bots.find(x=>x.id===id);if(!b)throw Error('机器人不存在');return b;}
  publicBot(b){const {secret,...v}=b;return {...v,hasCredentials:!!secret};}
  async saveBot(input){
    const old=input.id?this.bot(input.id):null;
    const b=old?structuredClone(old):{id:crypto.randomUUID(),name:'新机器人',provider:'feishu',enabled:false,allowedProjects:['*'],replyMode:'streaming_card',ownerId:'',groups:[]};
    if(input.name!==undefined) { if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw Error('名称长度需在 1–100 之间');b.name=input.name.trim();}
    if(input.provider!==undefined){if(!['feishu','lark'].includes(input.provider))throw Error('不支持的渠道');b.provider=input.provider;}
    if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')throw Error('enabled 必须是布尔值');b.enabled=input.enabled;}
    if(input.appId!==undefined){if(input.appId&&!/^cli_[a-zA-Z0-9_-]+$/.test(input.appId))throw Error('App ID 格式错误');b.appId=input.appId;}
    if(input.ownerId!==undefined){if(input.ownerId&&!/^ou_[\w-]+$/.test(input.ownerId))throw Error('用户 Open ID 格式错误');b.ownerId=input.ownerId;}
    if(input.allowedProjects!==undefined){if(!Array.isArray(input.allowedProjects)||input.allowedProjects.some(x=>x!=='*'&&!this.state.projects.some(p=>p.id===x)))throw Error('项目范围无效');b.allowedProjects=[...new Set(input.allowedProjects)];}
    if(input.secret){if(typeof input.secret!=='string'||input.secret.length>4096)throw Error('App Secret 无效');b.secret=await secretTransform(input.secret);}
    if(!old)this.state.bots.push(b);else this.state.bots[this.state.bots.findIndex(x=>x.id===b.id)]=b;this.save();return this.publicBot(b);
  }
  addProject(name,p){
    if(typeof p!=='string'||!path.isAbsolute(p))throw Error('请输入项目的绝对路径');
    const real=canonical(p);if(!fs.statSync(real).isDirectory())throw Error('项目路径不是文件夹');
    const old=this.state.projects.find(x=>samePath(x.path,real));if(old)return old;
    const project={id:crypto.randomUUID().slice(0,8),name:String(name||path.basename(real)).slice(0,100),path:real};this.state.projects.push(project);this.save();return project;
  }
  projects(bot){return this.state.projects.filter(p=>bot.allowedProjects.includes('*')||bot.allowedProjects.includes(p.id));}
  project(bot,id){const p=this.projects(bot).find(x=>x.id===id);if(!p)throw Error('此机器人无权访问该项目');canonical(p.path);return p;}
  remember(id){if(this.state.seen.some(x=>x.id===id))return false;const now=Date.now();this.state.seen=this.state.seen.filter(x=>now-x.time<86400000).slice(-4999);this.state.seen.push({id,time:now});this.save();return true;}
}
module.exports={Store,dataDir,atomic,canonical,samePath,secretTransform};
