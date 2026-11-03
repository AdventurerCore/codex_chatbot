const crypto=require('node:crypto');
const {samePath}=require('./store.cjs');
const {FeishuTransport,Registration}=require('./feishu.cjs');
const HELP=`Codex 飞书机器人
/workspace — 选择项目（/workspace 序号）
/new — 新对话
/task — 列出当前项目会话
/resume 会话ID — 继续已有会话
/model [模型ID] — 查看或切换模型
/thoughtlevel low|medium|high|xhigh — 推理强度
/stop — 停止当前任务
/status — 当前状态
/enable · /disable — 绑定 / 解除群聊
/approve 编号 · /deny 编号 — 确认审批
/answer 编号 回答 — 回答 Codex 问题
/help — 显示帮助
直接发送需求即可开始。群聊中需 @机器人。`;
function parseEvent(event){
  const e=event.event||event,m=e.message||{},sender=e.sender?.sender_id?.open_id;
  if(e.sender?.sender_type&&e.sender.sender_type!=='user')return null;
  if(!sender||!m.chat_id||!m.message_id)return null;
  let content;try{content=JSON.parse(m.content||'{}');}catch{return null;}
  let text=content.text||'';
  if(m.message_type==='post'){const post=content.zh_cn||content.en_us||content;text=[post.title,...(post.content||[]).map(row=>row.map(x=>x.text||x.href||'').join(''))].filter(Boolean).join('\n');}
  for(const mention of m.mentions||[])text=text.split(mention.key).join('');
  return {sender,chatId:m.chat_id,messageId:m.message_id,type:m.chat_type,text:text.trim(),mentionIds:(m.mentions||[]).map(x=>x.id?.open_id).filter(Boolean),topic:m.thread_id||m.root_id||'',messageType:m.message_type,created:Number(m.create_time)||Date.now()};
}
function sessionKey(botId,e){return JSON.stringify([botId,e.chatId,e.topic||'']);}
class Bridge {
  constructor(store,codex,transportFactory=(b,l)=>new FeishuTransport(b,l)){
    this.store=store;this.codex=codex;this.transportFactory=transportFactory;this.transports=new Map();this.active=new Map();this.byThread=new Map();this.pending=new Map();this.bindCodes=new Map();this.locks=new Map();this.logs=[];
    this.registration=new Registration(store,id=>this.refresh(id));
    codex.on('notification',m=>this.notification(m).catch(e=>this.log('codex-event',e)));
    codex.on('request',m=>this.serverRequest(m).catch(e=>{this.log('codex-request',e);codex.reject(m.id);}));
    codex.on('disconnected',e=>{for(const a of this.active.values())this.finish(a,'failed',e.message).catch(()=>{});});
  }
  log(kind,e){this.logs.push({time:Date.now(),kind,message:String(e?.message||e).replace(/(?:cli_|ou_|oc_)[\w-]+/g,'[id]').slice(0,400)});this.logs=this.logs.slice(-100);}
  async start(){for(const b of this.store.state.bots)if(b.enabled)this.refresh(b.id).catch(e=>this.log('start',e));}
  async refresh(id){const old=this.transports.get(id);old?.close();this.transports.delete(id);const b=this.store.bot(id);if(!b.enabled||!b.secret||!b.appId)return;const t=this.transportFactory(b,(k,e)=>this.log(k,e));this.transports.set(id,t);try{await t.start(e=>this.receive(id,e),e=>this.cardAction(id,e));}catch(e){t.state='error';t.error=e.message;this.log('connect',e);}}
  view(){return {bots:this.store.state.bots.map(b=>({...this.store.publicBot(b),runtime:{status:this.transports.get(b.id)?.state||'stopped',error:this.transports.get(b.id)?.error||null}})),projects:this.store.state.projects,active:[...this.active.values()].map(a=>({botId:a.bot.id,projectId:a.session.projectId,threadId:a.session.threadId,startedAt:a.startedAt})),logs:this.logs.slice(-12)};}
  bindCode(id){this.store.bot(id);const code=crypto.randomBytes(4).toString('hex').toUpperCase();this.bindCodes.set(id,{code,expires:Date.now()+600000});return {command:'/bind '+code,expiresAt:Date.now()+600000};}
  async receive(botId,event){
    const e=parseEvent(event);if(!e||Date.now()-e.created>300000)return;
    const key=sessionKey(botId,e),prev=this.locks.get(key)||Promise.resolve();
    const next=prev.catch(()=>{}).then(()=>this.handle(botId,e));this.locks.set(key,next);try{await next;}finally{if(this.locks.get(key)===next)this.locks.delete(key);}
  }
  async handle(botId,e){
    const bot=this.store.bot(botId),t=this.transports.get(botId);if(!bot.enabled||!t)return;
    const reply=s=>t.text(e.chatId,s,e.messageId,!!e.topic);
    const [cmd,...args]=e.text.split(/\s+/),arg=args.join(' ');
    if(!bot.ownerId){
      if(cmd!=='/bind'||e.type!=='p2p')return;
      const bind=this.bindCodes.get(botId);if(!bind||Date.now()>bind.expires||arg!==bind.code)return;
      this.bindCodes.delete(botId);bot.ownerId=e.sender;this.store.save();await reply('关联成功。发送 /workspace 选择项目。');return;
    }
    const owner=e.sender===bot.ownerId;
    if(!owner)return;
    if(e.type==='group'&&(!t.botOpenId||!e.mentionIds.includes(t.botOpenId)))return;
    if(!this.store.remember(botId+':'+e.messageId))return;
    if(cmd==='/enable'&&e.type==='group'){if(!bot.groups.includes(e.chatId))bot.groups.push(e.chatId);this.store.save();await reply('群聊已启用。当前仅绑定用户可以操作此机器人。发送 /workspace 选择项目。');return;}
    if(cmd==='/disable'&&e.type==='group'){bot.groups=bot.groups.filter(x=>x!==e.chatId);this.store.save();await this.cancelChat(botId,e.chatId);await reply('群聊已停用。');return;}
    if(e.type==='group'&&!bot.groups.includes(e.chatId)){await reply('此群尚未绑定，请 @机器人 /enable。');return;}
    const key=sessionKey(botId,e);let s=this.store.state.sessions[key];if(!s){s={botId,chatId:e.chatId,topic:e.topic,projectId:null,threadId:null};this.store.state.sessions[key]=s;}
    try{
      if(cmd==='/help'){await reply(HELP);return;}
      if(cmd==='/status'){const a=this.active.get(key);await reply(`项目：${this.store.state.projects.find(p=>p.id===s.projectId)?.name||'未选择'}\n会话：${s.threadId||'未开始'}\n状态：${a?'处理中':'空闲'}\n模型：${s.model||'Codex 默认'}\n推理强度：${s.effort||'默认'}`);return;}
      if(['/approve','/deny','/answer'].includes(cmd)){await reply(await this.resolvePending(botId,e.chatId,e.sender,args[0],cmd==='/approve'?'accept':cmd==='/deny'?'decline':'answer',args.slice(1).join(' ')));return;}
      if(cmd==='/stop'){const a=this.active.get(key);if(a?.turnId)await this.codex.request('turn/interrupt',{threadId:s.threadId,turnId:a.turnId});else if(a)a.cancelled=true;await reply(a?'已请求停止。':'当前没有运行中的任务。');return;}
      if(this.active.has(key)){await reply('当前任务仍在运行。可以发送 /stop 停止，完成后再发送新需求。');return;}
      if(cmd==='/workspace'){
        const ps=this.store.projects(bot);if(!arg){await reply(ps.length?ps.map((p,i)=>`${i+1}. ${p.name} (${p.id})`).join('\n')+'\n发送 /workspace 序号 选择。':'尚未配置项目，请在本机机器人管理中添加。');return;}
        const p=ps.find(p=>p.id===arg||p.name===arg)||ps[Number(arg)-1];if(!p)throw Error('项目不存在或超出访问范围');s.projectId=p.id;s.threadId=null;this.store.save();await reply('已切换到 '+p.name);return;
      }
      if(cmd==='/new'||cmd==='/clear'){s.threadId=null;this.store.save();await reply('新对话已就绪，请发送需求。');return;}
      if(cmd==='/model'){if(!arg){const r=await this.codex.request('model/list',{});await reply((r.data||[]).map(m=>`${m.model}${m.isDefault?'（默认）':''}`).join('\n'));}else{if(!/^[\w.\-/:]+$/.test(arg)||arg.length>150)throw Error('模型 ID 无效');s.model=arg;this.store.save();await reply('模型已设为 '+arg);}return;}
      if(cmd==='/thoughtlevel'){if(!['low','medium','high','xhigh'].includes(arg))throw Error('可选：low、medium、high、xhigh');s.effort=arg;this.store.save();await reply('推理强度已更新。');return;}
      const projects=this.store.projects(bot);if(!s.projectId&&projects.length===1)s.projectId=projects[0].id;
      if(!s.projectId)throw Error('先发送 /workspace 选择项目。');const project=this.store.project(bot,s.projectId);
      if(cmd==='/task'||cmd==='/tasks'){const r=await this.codex.request('thread/list',{cwd:project.path,limit:15,sortKey:'updated_at',sourceKinds:[]});await reply((r.data||[]).map(x=>`${x.id}\n${String(x.name||x.preview||'未命名').slice(0,80)}`).join('\n\n')||'当前项目没有会话。');return;}
      if(cmd==='/resume'){
        if(!/^[a-zA-Z0-9_-]{8,100}$/.test(arg))throw Error('请使用 /task 列出的完整会话 ID');
        const r=await this.codex.request('thread/read',{threadId:arg,includeTurns:false});if(!samePath(r.thread.cwd,project.path))throw Error('只能接续当前项目内的会话');if(r.thread.status?.type==='active')throw Error('此会话正在运行，请完成或停止后再接续');
        await this.codex.request('thread/resume',{threadId:arg,excludeTurns:true,cwd:project.path});s.threadId=arg;this.store.save();await reply('已选择会话 '+arg);return;
      }
      if(cmd.startsWith('/')){await reply('未知命令，发送 /help 查看。');return;}
      if(!e.text){await reply('当前支持文字和富文本消息，请用文字描述需求。');return;}
      await this.run(key,bot,s,project,e,t);
    }catch(err){this.log('message',err);await reply('处理失败：'+err.message);}
  }
  async run(key,bot,s,project,e,t){
    const a={key,bot,session:s,event:e,t,startedAt:Date.now(),messages:new Map(),tools:[],turnId:null,stream:null,finished:false};this.active.set(key,a);
    try {
      a.stream=await t.stream(e.chatId,e.messageId,!!e.topic);
      if(!s.threadId){const r=await this.codex.request('thread/start',{cwd:project.path,approvalPolicy:'on-request',sandbox:'workspace-write',...(s.model?{model:s.model}:{}),serviceName:'codex-feishu-bridge'});s.threadId=r.thread.id;this.store.save();}
      else {const r=await this.codex.request('thread/read',{threadId:s.threadId,includeTurns:false});if(!samePath(r.thread.cwd,project.path))throw Error('会话目录不属于当前项目');await this.codex.request('thread/resume',{threadId:s.threadId,excludeTurns:true,cwd:project.path,approvalPolicy:'on-request',sandbox:'workspace-write'});}
      this.byThread.set(s.threadId,a);
      if(a.cancelled){await this.finish(a,'interrupted');return;}
      a.timer=setInterval(()=>this.flush(a).catch(err=>this.log('stream',err)),1000);
      const r=await this.codex.request('turn/start',{threadId:s.threadId,input:[{type:'text',text:e.text,text_elements:[]}],...(s.model?{model:s.model}:{}),...(s.effort?{effort:s.effort}:{})});a.turnId=r.turn.id;
      if(a.cancelled&&!a.finished)await this.codex.request('turn/interrupt',{threadId:s.threadId,turnId:a.turnId});
    }catch(err){await this.finish(a,'failed',err.message);}
  }
  text(a){return [...a.messages.values()].join('\n\n');}
  flush(a){if(a.finished||!a.stream)return Promise.resolve();return a.stream.update(this.text(a)||'正在处理…',a.tools);}
  async notification(m){
    const p=m.params||{},a=this.byThread.get(p.threadId);if(!a)return;
    if(m.method==='turn/started'){a.turnId=p.turn.id;return;}
    if(p.turnId&&a.turnId&&p.turnId!==a.turnId)return;
    if(m.method==='item/agentMessage/delta')a.messages.set(p.itemId,(a.messages.get(p.itemId)||'')+p.delta);
    if(m.method==='item/completed'&&p.item?.type==='agentMessage')a.messages.set(p.item.id,p.item.text||'');
    if(m.method==='item/started'){
      const it=p.item;const label=it?.type==='commandExecution'?`运行：${it.command}`:it?.type==='fileChange'?`修改文件：${(it.changes||[]).map(x=>x.path).join(', ')}`:it?.type==='mcpToolCall'?`工具：${it.server}/${it.tool}`:it?.type==='webSearch'?'搜索网页':null;
      if(label)a.tools.push(label.slice(0,500));
    }
    if(m.method==='serverRequest/resolved'){for(const [k,q]of this.pending)if(q.rpcId===p.requestId){clearTimeout(q.timer);this.pending.delete(k);}}
    if(m.method==='turn/completed'&&(!a.turnId||p.turn.id===a.turnId))await this.finish(a,p.turn.status,p.turn.error?.message);
  }
  async finish(a,status,error){
    if(a.finished)return;a.finished=true;clearInterval(a.timer);this.active.delete(a.key);if(this.byThread.get(a.session.threadId)===a)this.byThread.delete(a.session.threadId);
    for(const [k,q]of this.pending)if(q.active===a){clearTimeout(q.timer);this.pending.delete(k);}
    const full=this.text(a)||(!error?(status==='interrupted'?'任务已停止。':'处理完成。'):'');
    const result=error?`${full}\n\n处理失败：${error}`:full;const label=status==='completed'?'已完成':status==='interrupted'?'已停止':'执行结束';
    if(a.stream){try{await a.stream.update(result.slice(0,28000),a.tools,true,`Codex · ${label} · ${Math.round((Date.now()-a.startedAt)/1000)}s`);}catch(err){this.log('final-card',err);await a.t.text(a.event.chatId,result.slice(0,28000));}}
    else await a.t.text(a.event.chatId,result.slice(0,28000));
    for(let i=28000;i<result.length;i+=28000)await a.t.text(a.event.chatId,result.slice(i,i+28000));
  }
  async serverRequest(m){
    const p=m.params||{},a=this.byThread.get(p.threadId);if(!a||a.finished||(p.turnId&&a.turnId&&p.turnId!==a.turnId)){this.codex.reject(m.id,'该会话未由飞书机器人发起');return;}
    const approval=['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(m.method),question=m.method==='item/tool/requestUserInput';
    if(!approval&&!question){this.codex.reject(m.id);return;}
    const key=crypto.randomBytes(4).toString('hex'),q={rpcId:m.id,active:a,method:m.method,params:p,expires:Date.now()+600000};
    q.timer=setTimeout(()=>{if(this.pending.delete(key)){question?this.codex.respond(m.id,{answers:{}}):this.codex.respond(m.id,{decision:'cancel'});}},600000);this.pending.set(key,q);
    if(approval){const detail=p.command||p.reason||'修改项目文件';await a.t.approval(a.event.chatId,`${detail}\n\n编号：${key}\n允许本次操作或拒绝。10 分钟后过期。`,key);}
    else {const qs=p.questions||[];await a.t.text(a.event.chatId,qs.map(x=>`${x.id}: ${x.question}\n${(x.options||[]).map(o=>o.label).join(' / ')}`).join('\n\n')+`\n\n回复 /answer ${key} 回答${qs.length>1?'（多个问题用 JSON：{"问题ID":"回答"}）':''}`);}
  }
  async resolvePending(botId,chatId,sender,key,decision,answer){
    const q=this.pending.get(key);if(!q||Date.now()>q.expires)throw Error('审批或问题已过期');
    if(q.active.bot.id!==botId||q.active.event.chatId!==chatId||this.store.bot(botId).ownerId!==sender)throw Error('无权处理此请求');
    if(q.active.finished||!this.store.bot(botId).enabled)throw Error('任务已结束或机器人已停用');
    let result;
    if(q.method==='item/tool/requestUserInput'){
      if(decision!=='answer')throw Error('请使用 /answer 回答问题');const qs=q.params.questions||[],answers={};
      if(qs.length===1)answers[qs[0].id]={answers:[answer]};else{let parsed;try{parsed=JSON.parse(answer);}catch{throw Error('请用 JSON 对象回答多个问题');}for(const x of qs){if(typeof parsed[x.id]!=='string')throw Error('缺少问题 '+x.id+' 的回答');answers[x.id]={answers:[parsed[x.id]]};}}
      result={answers};
    }else{if(!['accept','decline'].includes(decision))throw Error('无效审批决定');result={decision};}
    this.codex.respond(q.rpcId,result);clearTimeout(q.timer);this.pending.delete(key);return '已提交。';
  }
  async cardAction(botId,payload){const e=payload.event||payload;const action=e.action?.value||{},sender=e.operator?.open_id,chatId=e.context?.open_chat_id;if(!sender||!chatId||!['approve','deny'].includes(action.action))return;try{await this.resolvePending(botId,chatId,sender,action.key,action.action==='approve'?'accept':'decline');}catch(e){this.log('card-action',e);}}
  async cancelChat(botId,chatId){for(const a of this.active.values())if(a.bot.id===botId&&(!chatId||a.event.chatId===chatId)){a.cancelled=true;if(a.turnId)await this.codex.request('turn/interrupt',{threadId:a.session.threadId,turnId:a.turnId});}}
  async stop(){for(const t of this.transports.values())t.close();this.codex.close();}
}
module.exports={Bridge,parseEvent,sessionKey,HELP};
