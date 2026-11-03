const Lark=require('@larksuiteoapi/node-sdk');
const QRCode=require('qrcode');
const crypto=require('node:crypto');
const {secretTransform}=require('./store.cjs');
const accounts={feishu:'https://accounts.feishu.cn',lark:'https://accounts.larksuite.com'};
function check(r){if(r?.code)throw Error(`飞书 API ${r.code}: ${String(r.msg||'请求失败').slice(0,250)}`);return r?.data||r;}
function card(text,tools=[],done=false,title='Codex',actions=[]){
  const elements=[{tag:'markdown',element_id:'answer',content:text||'正在处理…'}];
  if(tools.length)elements.push({tag:'collapsible_panel',expanded:false,header:{title:{tag:'plain_text',content:`工具调用 · ${tools.length}`}},elements:[{tag:'markdown',content:tools.slice(-25).join('\n').slice(0,10000)}]});
  elements.push(...actions.map(a=>({tag:'button',text:{tag:'plain_text',content:a.label},type:a.primary?'primary':'default',behaviors:[{type:'callback',value:a.value}]})));
  return {schema:'2.0',config:{update_multi:true,streaming_mode:!done,summary:{content:done?String(text).slice(0,90):'Codex 正在处理…'},...(!done?{streaming_config:{print_frequency_ms:{default:50},print_step:{default:4},print_strategy:'fast'}}:{})},header:{title:{tag:'plain_text',content:title},template:done?'green':'blue'},body:{elements}};
}
class FeishuTransport {
  constructor(bot,logger=()=>{}){this.bot=bot;this.logger=logger;this.state='stopped';this.error=null;this.ws=null;this.client=null;}
  async start(onMessage,onAction){
    const appSecret=await secretTransform(this.bot.secret,true);
    const config={appId:this.bot.appId,appSecret,domain:this.bot.provider==='lark'?Lark.Domain.Lark:Lark.Domain.Feishu,logger:{debug(){},info(){},warn:()=>{},error:()=>{this.error='飞书连接暂时不可用，正在重试';}}};
    this.client=new Lark.Client(config);this.ws=new Lark.WSClient({...config,loggerLevel:Lark.LoggerLevel.error});this.state='connecting';
    try{const info=check(await this.client.request({method:'GET',url:(this.bot.provider==='lark'?'https://open.larksuite.com':'https://open.feishu.cn')+'/open-apis/bot/v3/info/'}));this.botOpenId=info.bot?.open_id||info.open_id;}catch(e){this.logger('bot-identity',e);}
    const dispatcher=new Lark.EventDispatcher({}).register({
      'im.message.receive_v1':data=>{setImmediate(()=>onMessage(data).catch(e=>this.logger('message',e)));return {};},
      'card.action.trigger':data=>{setImmediate(()=>onAction(data).catch(e=>this.logger('action',e)));return {toast:{type:'info',content:'已提交'}};},
      'im.chat.member.bot.deleted_v1':data=>{this.logger('removed',data.chat_id||'');return {};}
    });
    await this.ws.start({eventDispatcher:dispatcher});
    this.monitor=setInterval(()=>{const state=this.ws?.getConnectionStatus().state;this.state=state==='failed'?'error':state==='idle'?'stopped':state||'connecting';if(state==='connected')this.error=null;},1500);this.monitor.unref?.();
  }
  close(){clearInterval(this.monitor);this.ws?.close({force:true});this.ws=null;this.state='stopped';}
  async text(chatId,text,replyId,threaded=false){return this.send(chatId,'text',{text:String(text).slice(0,28000)},replyId,threaded);}
  async send(chatId,type,content,replyId,threaded=false){
    const data={msg_type:type,content:JSON.stringify(content),uuid:crypto.randomUUID()};
    const r=replyId?await this.client.im.v1.message.reply({path:{message_id:replyId},data:{...data,reply_in_thread:threaded}}):await this.client.im.v1.message.create({params:{receive_id_type:'chat_id'},data:{...data,receive_id:chatId}});
    return check(r);
  }
  async stream(chatId,replyId,threaded){
    let cardId,messageId;
    try {const r=check(await this.client.cardkit.v1.card.create({data:{type:'card_json',data:JSON.stringify(card('正在处理…'))}}));cardId=r.card_id;
      const sent=await this.send(chatId,'interactive',{type:'card',data:{card_id:cardId}},replyId,threaded);messageId=sent.message_id;
    }catch(e){this.logger('card-fallback',e);const sent=await this.send(chatId,'interactive',card('正在处理…',[],true),replyId,threaded);messageId=sent.message_id;cardId=null;}
    let sequence=0,chain=Promise.resolve(),last='',lastTools='';
    const update=(text,tools=[],done=false,status='Codex')=>{
      chain=chain.catch(()=>{}).then(async()=>{
        const body=String(text||'正在处理…').slice(0,28000);const toolText=tools.join('\n');if(!done&&last===body&&lastTools===toolText)return;
        if(cardId){
          if(body!==last)check(await this.client.cardkit.v1.cardElement.content({path:{card_id:cardId,element_id:'answer'},data:{content:body,sequence:++sequence,uuid:crypto.randomUUID()}}));
          if(done){check(await this.client.cardkit.v1.card.settings({path:{card_id:cardId},data:{settings:JSON.stringify({config:{streaming_mode:false}}),sequence:++sequence,uuid:crypto.randomUUID()}}));
            check(await this.client.cardkit.v1.card.update({path:{card_id:cardId},data:{card:{type:'card_json',data:JSON.stringify(card(body,tools,true,status))},sequence:++sequence,uuid:crypto.randomUUID()}}));}
        }else check(await this.client.im.v1.message.patch({path:{message_id:messageId},data:{content:JSON.stringify(card(body,tools,true,status))}}));
        last=body;lastTools=toolText;
      });return chain;
    };return {update,messageId,cardId};
  }
  async approval(chatId,text,key){return this.send(chatId,'interactive',card(text,[],true,'Codex · 等待确认',[{label:'允许一次',primary:true,value:{action:'approve',key}},{label:'拒绝',value:{action:'deny',key}}]));}
}
class Registration {
  constructor(store,onBound){this.store=store;this.onBound=onBound;this.flows=new Map();}
  async post(domain,data){const r=await fetch(accounts[domain]+'/oauth/v1/app/registration',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data),signal:AbortSignal.timeout(15000)});let result;try{result=await r.json();}catch{throw Error(`飞书关联服务返回无效数据 (${r.status})`);}if(!r.ok&&!result.error)throw Error(`飞书关联服务暂不可用 (${r.status})`);return result;}
  async begin(botId){
    const bot=this.store.bot(botId);const init=await this.post('feishu',{action:'init'});
    if(!init.supported_auth_methods?.includes('client_secret'))throw Error('当前飞书环境不支持扫码创建机器人，请使用手动配置。');
    const r=await this.post('feishu',{action:'begin',archetype:'PersonalAgent',auth_method:'client_secret',request_user_info:'open_id'});
    if(!r.device_code||!r.verification_uri_complete)throw Error('飞书没有返回有效的关联二维码');
    const url=new URL(r.verification_uri_complete);if(url.protocol!=='https:'||!['open.feishu.cn','accounts.feishu.cn','open.larksuite.com','accounts.larksuite.com'].includes(url.hostname))throw Error('飞书关联地址无效');
    url.searchParams.set('from','sdk');url.searchParams.set('source','node-sdk/codex-feishu-bridge');url.searchParams.set('tp','sdk');
    const f={botId,deviceCode:r.device_code,pollDomain:'feishu',domain:bot.provider,expiresAt:Date.now()+(r.expire_in||600)*1000,interval:Math.max(2,r.interval||5),nextPoll:0};
    this.flows.set(botId,f);return {botId,qrUrl:url.href,qrDataUrl:await QRCode.toDataURL(url.href,{width:256,margin:3}),expiresAt:f.expiresAt,interval:f.interval,status:'pending'};
  }
  async poll(botId){
    const f=this.flows.get(botId);if(!f||f.expiresAt<Date.now()){this.flows.delete(botId);return {status:'expired'};}
    if(Date.now()<f.nextPoll)return {status:'pending',interval:f.interval};f.nextPoll=Date.now()+f.interval*1000;
    const r=await this.post(f.pollDomain,{action:'poll',device_code:f.deviceCode});
    if(r.user_info?.tenant_brand==='lark'&&f.pollDomain!=='lark'){f.pollDomain='lark';f.domain='lark';return {status:'pending',interval:f.interval};}
    if(r.client_id&&r.client_secret){
      if(!r.user_info?.open_id)throw Error('扫码未返回用户身份，请使用手动配置并绑定用户。');
      await this.store.saveBot({id:botId,appId:r.client_id,secret:r.client_secret,ownerId:r.user_info.open_id,provider:r.user_info.tenant_brand==='lark'?'lark':'feishu',name:r.app_name||r.client_name||r.app?.app_name||this.store.bot(botId).name,enabled:true});
      this.flows.delete(botId);await this.onBound(botId);return {status:'success'};
    }
    if(r.error==='slow_down')f.interval=Math.min(30,f.interval+5);
    if(!r.error||['authorization_pending','slow_down'].includes(r.error))return {status:'pending',interval:f.interval};
    this.flows.delete(botId);return {status:r.error==='expired_token'?'expired':r.error==='access_denied'?'denied':'error'};
  }
}
module.exports={FeishuTransport,Registration,card,check};
