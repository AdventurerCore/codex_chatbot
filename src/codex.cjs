const {spawn}=require('node:child_process');
const readline=require('node:readline');
const {EventEmitter}=require('node:events');
const {childEnvironment,codexExecutable}=require('./platform.cjs');
const {version}=require('../package.json');
class CodexClient extends EventEmitter {
  constructor(){super();this.next=1;this.pending=new Map();this.ready=null;this.proc=null;}
  async connect(){
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      const env=childEnvironment();
      const p=spawn(codexExecutable(env),['app-server','--stdio'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});this.proc=p;
      p.stderr.on('data',()=>{});
      p.on('error',e=>this.fail(e));p.on('exit',()=>this.fail(Error('Codex App Server 已退出')));
      readline.createInterface({input:p.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
        if(m.method&&m.id!==undefined)this.emit('request',m);
        else if(m.id!==undefined){const q=this.pending.get(m.id);if(!q)return;clearTimeout(q.timer);this.pending.delete(m.id);m.error?q.reject(Error(m.error.message)):q.resolve(m.result);}
        else if(m.method)this.emit('notification',m);
      });
      await this.raw('initialize',{clientInfo:{name:'codex_feishu_bridge',title:'Codex 飞书机器人',version},capabilities:{experimentalApi:true}});
      this.write({method:'initialized',params:{}});return true;
    })().catch(e=>{this.ready=null;throw e;});return this.ready;
  }
  write(m){if(!this.proc?.stdin.writable)throw Error('Codex 未连接');this.proc.stdin.write(JSON.stringify(m)+'\n');}
  raw(method,params={}){const id=this.next++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Codex ${method} 超时`));},30000);this.pending.set(id,{resolve,reject,timer});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  async request(method,params={}){await this.connect();return this.raw(method,params);}
  respond(id,result){this.write({id,result});}
  reject(id,message='此插件不支持该请求'){this.write({id,error:{code:-32601,message}});}
  fail(e){for(const q of this.pending.values()){clearTimeout(q.timer);q.reject(e);}this.pending.clear();this.ready=null;this.emit('disconnected',e);}
  close(){this.proc?.stdin.end();this.proc?.kill();this.proc=null;this.ready=null;}
  async health(){const r=await this.request('account/read',{refreshToken:false});return {connected:true,loggedIn:!!r.account,accountType:r.account?.type||null,requiresOpenaiAuth:r.requiresOpenaiAuth};}
}
module.exports={CodexClient};
