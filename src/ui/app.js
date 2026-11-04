import {App} from '@modelcontextprotocol/ext-apps';
import {version} from '../../package.json';
const appRoot=document.querySelector('#app'),dialogs=document.querySelector('#dialogs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const robot='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="7" width="14" height="14" rx="3"/><path d="M12 7V3m-3 10v3m6-3v3M2 12v5m20-5v5M9 3h6"/></svg>';
const logo=(size=36)=>`<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><path fill="#00cfbf" d="M10 8h19l10 14-11 8L19 16z"/><path fill="#2c4dff" d="M6 18l17 10 12-9h10c-4 14-12 22-23 22C14 41 9 38 6 35z"/><path fill="#6489ff" d="M6 18l17 10 7-3c-3 8-10 11-24 10z"/></svg>`;
const statuses={connected:'飞书 WebSocket 运行中。',connecting:'正在连接飞书…',reconnecting:'正在重新连接…',stopped:'机器人已停用。',error:'连接失败。'};
let state={bots:[],projects:[],active:[]},selected=null,hostApp=null,qrTimer=null,modalType=null,refreshTimer=null;
let scopeDraft=null,scopeRequest=0;
let auth='';
try{auth=location.hash.slice(1)||sessionStorage.getItem('codex-feishu-token')||'';if(location.hash){sessionStorage.setItem('codex-feishu-token',auth);history.replaceState(null,'',location.pathname);}}catch{}
function toast(message){const n=document.querySelector('#notifications');n.innerHTML=`<div class="toast">${esc(message)}</div>`;setTimeout(()=>n.innerHTML='',4500);}
async function call(action,args={}){
  if(hostApp){const result=await hostApp.callServerTool({name:'feishu_ui',arguments:{action,args}});if(result.isError)throw Error(result.content?.[0]?.text||'操作失败');return result.structuredContent||JSON.parse(result.content[0].text);}
  const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth},body:JSON.stringify({action,args})});const data=await r.json();if(!r.ok||data.error)throw Error(data.error||'操作失败');return data;
}
function bot(){return state.bots.find(b=>b.id===selected);}
async function refresh(){state=await call('status');if(!state.bots.some(b=>b.id===selected))selected=state.bots[0]?.id;render();}
function render(){
  const b=bot();appRoot.innerHTML=`<header class="topbar">${robot}<h1>机器人</h1><span class="intro">把飞书与 Lark 接入 Codex 机器人。</span><button class="iconbutton" data-action="projects" title="项目配置" aria-label="项目配置">⚙</button></header><div class="layout"><aside class="sidebar"><button class="add" data-action="create">＋ 新建机器人</button><nav class="botlist" aria-label="机器人列表">${state.bots.map(x=>`<button class="botitem ${x.id===selected?'active':''}" data-bot="${esc(x.id)}">${logo()}<span class="label"><span class="name">${esc(x.name)}</span><span class="sub">${x.provider==='lark'?'Lark':'飞书'}<span class="tag">${x.provider==='lark'?'全球':'中国'}</span></span></span><i class="dot ${esc(x.runtime.status)}"></i></button>`).join('')}</nav><div class="sidebarfooter">Codex 飞书机器人 <span class="tag">本地运行</span></div></aside><main class="content">${b?details(b):`<div class="empty">${logo(48)}<p>添加机器人，从飞书访问本机项目。</p><button data-action="create">＋ 新建机器人</button></div>`}</main></div>`;
}
function details(b){
  const status=!b.hasCredentials?'尚未关联机器人。':statuses[b.runtime.status]||b.runtime.status;
  return `<div class="botheader">${logo(40)}<div class="identity"><button class="iconbutton name" style="color:inherit;padding:0" title="修改名称" data-action="rename">${esc(b.name)}</button><div class="state"><i class="dot ${esc(b.runtime.status)}"></i>${esc(status.replace('飞书',b.provider==='lark'?'Lark':'飞书'))}</div></div><button class="switch ${b.enabled?'on':''}" role="switch" aria-checked="${b.enabled}" aria-label="启用机器人" data-action="toggle"></button></div>
  ${b.runtime.error?`<div class="alert">${esc(b.runtime.error)} <button data-action="reconnect">重新连接</button></div>`:''}
  <section class="card"><div class="row"><div class="copy"><h3>关联机器人</h3><p>扫码获取应用凭据。</p></div>${b.ownerId?`<span class="inline"><span class="statuslabel"><i class="dot connected"></i> 已连通</span><button data-action="unlink">⛓ 解绑</button></span>`:`<button data-action="register">扫码关联</button>`}</div></section>
  <section class="card"><div class="row"><div class="copy"><h3>机器人回复颗粒度</h3><p>飞书/Lark 仅支持基于 Card JSON 2.0 的流式卡片，工具调用只显示折叠摘要。</p></div><select aria-label="机器人回复颗粒度"><option>流式卡片</option></select></div><div class="row"><div class="copy"><h3>项目访问范围</h3><p>${b.allowedProjects.includes('*')?`当前可访问所有已添加项目，共 ${state.projects.length} 个。`:`这个机器人可以使用 ${b.allowedProjects.length} 个指定项目。`}</p></div><div class="inline"><select id="scope" aria-label="项目访问范围"><option value="all" ${b.allowedProjects.includes('*')?'selected':''}>所有已添加项目</option><option value="selected" ${!b.allowedProjects.includes('*')?'selected':''}>指定项目</option></select><button data-action="scope">选择项目…</button></div></div></section>
  <section class="card"><div class="row"><div class="copy"><h3>群聊使用权限</h3><p>${b.groupAccess==='all_members'?'已启用群内全员使用；所有成员可让 Codex 读取或修改授权项目，管理命令与审批仍仅限绑定用户。':'只有绑定用户可以在已启用群聊中使用机器人。'}</p></div><select id="group-access" aria-label="群聊使用权限"><option value="owner" ${b.groupAccess!=='all_members'?'selected':''}>仅绑定用户</option><option value="all_members" ${b.groupAccess==='all_members'?'selected':''}>群内所有成员</option></select></div><div class="sectiontitle">已绑定群聊</div>${b.groups.length?b.groups.map(g=>`<div class="group"><code>${esc(g)}</code><button data-action="group_remove" data-group="${esc(g)}">解除</button></div>`).join(''):'<div class="emptygroup">暂无绑定群聊。在群中 @机器人 发送 /enable 后，这里会显示。</div>'}</section>
  <section class="card"><div class="row"><div class="copy"><h3>删除机器人</h3><p>移除这个机器人。</p></div><button class="red" data-action="delete">▤ 删除机器人</button></div></section>
  <div class="inline" style="margin-top:15px;justify-content:space-between"><button class="iconbutton" data-action="manual">手动配置</button><button class="iconbutton" data-action="diagnose">连接诊断</button><button class="iconbutton" data-action="help">使用说明</button></div>`;
}
function closeModal(){const wasScope=modalType==='scope';clearTimeout(qrTimer);qrTimer=null;modalType=null;scopeDraft=null;scopeRequest++;dialogs.innerHTML='';if(wasScope)render();}
function modal(title,body,footer='',wide=false){dialogs.innerHTML=`<div class="overlay"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modalhead">${robot}<h2>${esc(title)}</h2><button class="iconbutton" data-close aria-label="关闭">×</button></div><div class="modalbody">${body}</div>${footer?`<div class="modalfoot">${footer}</div>`:''}</section></div>`;}
function showProjects(){modalType='projects';modal('项目配置',`<div class="help">机器人只能访问这里配置的本地文件夹。</div><div style="max-height:230px;overflow:auto;margin:10px 0 20px">${state.projects.map(p=>`<div class="projectrow">${esc(p.name)}<small>${esc(p.path)}</small></div>`).join('')||'<p class="muted">尚未添加项目。</p>'}</div><form id="project-form"><label class="field">项目名称<input name="name" placeholder="我的项目"></label><label class="field">本地文件夹<input name="path" required placeholder="本机项目文件夹的完整路径"></label><button class="primary">添加项目</button></form>`, '',true);}
function scopeCount(){const count=document.querySelector('#scope-count');if(count)count.textContent=`已选 ${scopeDraft?.selectedIds.size||0} 个项目`;}
function filterScope(){const term=(scopeDraft?.search||'').trim().toLocaleLowerCase();for(const row of dialogs.querySelectorAll('[data-scope-project]'))row.hidden=!row.textContent.toLocaleLowerCase().includes(term);}
function renderScope(){
  const draft=scopeDraft;
  modal('项目访问范围',`<p class="help">从 Codex 已有的本地项目中选择一个或多个，保存后生效。</p>${draft.warning?`<div class="alert" style="margin-top:12px">${esc(draft.warning)}</div>`:''}<input id="scope-search" aria-label="搜索项目" placeholder="搜索项目名称或路径" value="${esc(draft.search)}" style="width:100%;margin:14px 0 10px"><div class="inline" style="margin-bottom:8px"><span class="help" style="margin-right:auto">共 ${draft.projects.length} 个本地项目</span><button data-action="scope_all">全选当前结果</button><button data-action="scope_clear">清空选择</button><button data-action="scope_refresh">刷新</button></div><div style="max-height:330px;overflow:auto">${draft.projects.map(p=>`<label class="projectrow projectoption" data-scope-project><input type="checkbox" name="scope_project" value="${esc(p.id)}" ${draft.selectedIds.has(p.id)?'checked':''} ${!p.available&&!p.projectId?'disabled':''}><span>${esc(p.name)} <small>${esc(p.path)}</small>${!p.available?'<small>目录当前不可用，请确认已挂载或文件夹仍存在。</small>':''}</span><span class="tag" style="flex:0 0 auto">${p.fromCodex?'Codex':'已添加'}</span></label>`).join('')||'<p class="muted">尚无本地项目，可在「项目配置」中手动添加文件夹。</p>'}</div>`,`<span id="scope-count" class="help" style="margin-right:auto"></span><button data-close>取消</button><button class="primary" data-action="save_scope">保存</button>`,true);
  scopeCount();filterScope();
}
async function showScope(preserve=false){
  const b=bot(),id=b.id,previous=preserve&&scopeDraft?.botId===id?scopeDraft:null,request=++scopeRequest;
  scopeDraft={botId:id,selectedIds:previous?new Set(previous.selectedIds):new Set(),search:previous?.search||'',projects:[],warning:null};
  modalType='scope';modal('项目访问范围','<div class="loader"></div><p class="help">正在读取 Codex 项目列表…</p>','',true);
  try{
    const catalog=await call('list_projects');if(modalType!=='scope'||selected!==id||request!==scopeRequest)return;
    scopeDraft.projects=catalog.projects;scopeDraft.warning=catalog.warning;
    scopeDraft.selectedIds=new Set(catalog.projects.filter(p=>previous?previous.selectedIds.has(p.id)&&(p.available||p.projectId):p.projectId&&(b.allowedProjects.includes('*')||b.allowedProjects.includes(p.projectId))).map(p=>p.id));
    renderScope();
  }catch(error){if(modalType==='scope'&&request===scopeRequest)modal('项目访问范围',`<p class="error-text">${esc(error.message)}</p>`,`<button data-close>取消</button><button data-action="scope_refresh">重试</button>`,true);}
}
async function register(){modalType='qr';modal('关联飞书机器人','<div class="qr"><div class="loader"></div><p>正在生成二维码…</p></div>');const id=selected;
  try{const r=await call('begin_registration',{id});if(modalType!=='qr'||id!==selected)return;modal('关联飞书机器人',`<p class="muted">用飞书扫描二维码，在手机上确认创建并关联机器人。</p><div class="qr"><img src="${esc(r.qrDataUrl)}" alt="飞书关联二维码"><p id="qr-state">等待扫码 · 有效期 10 分钟</p></div><div class="help">凭据加密保存在本机。扫码后自动关联当前飞书用户。</div>`,`<button data-action="open-qr" data-url="${esc(r.qrUrl)}">在浏览器打开</button><button data-action="manual">手动配置</button>`);
    async function poll(){if(modalType!=='qr')return;try{const v=await call('poll_registration',{id});if(modalType!=='qr')return;if(v.status==='success'){closeModal();toast('关联成功');await refresh();return;}if(v.status!=='pending'){document.querySelector('#qr-state').textContent=v.status==='expired'?'二维码已过期，请关闭后重新生成。':'关联未完成，请重新扫码。';return;}qrTimer=setTimeout(poll,(v.interval||5)*1000);}catch(e){if(document.querySelector('#qr-state'))document.querySelector('#qr-state').textContent=e.message;qrTimer=setTimeout(poll,10000);}}
    qrTimer=setTimeout(poll,r.interval*1000);
  }catch(e){modal('关联飞书机器人',`<p class="error-text">${esc(e.message)}</p>`,`<button data-action="register">重试</button><button data-action="manual">手动配置</button>`);}
}
function manual(){clearTimeout(qrTimer);modalType='manual';const b=bot();modal('手动配置',`<form id="credentials-form"><label class="field">App ID<input name="appId" required value="${esc(b.appId||'')}" placeholder="cli_…"></label><label class="field">App Secret<input name="secret" type="password" autocomplete="new-password" placeholder="${b.hasCredentials?'留空保留现有凭据':'输入应用密钥'}" ${b.hasCredentials?'':'required'}></label><label class="field">绑定用户 Open ID<input name="ownerId" value="${esc(b.ownerId)}" placeholder="ou_…（可稍后使用绑定码）"></label><p class="help">在飞书开放平台启用机器人和长连接，订阅 im.message.receive_v1 与 card.action.trigger。保存后，可使用一次性绑定码关联用户。</p><div class="inline" style="margin-top:18px"><button class="primary">保存并连接</button><button type="button" data-action="bind_code">生成绑定码</button></div></form>`);}
async function action(name,el){
  const b=bot();
  if(name==='create'){modalType='create';modal('新建机器人',`<form id="create-form"><label class="field">名称<input name="name" value="新机器人" required maxlength="100"></label><label class="field">平台<select name="provider"><option value="feishu">飞书 · 中国</option><option value="lark">Lark · 全球</option></select></label><button class="primary">创建机器人</button></form>`);return;}
  if(name==='projects'){showProjects();return;}if(name==='register'){await register();return;}if(name==='manual'){manual();return;}
  if(name==='scope'){await showScope();return;}
  if(name==='scope_refresh'){await showScope(true);return;}
  if(name==='scope_all'){for(const row of dialogs.querySelectorAll('[data-scope-project]')){const input=row.querySelector('input');if(!row.hidden&&!input.disabled){input.checked=true;scopeDraft.selectedIds.add(input.value);}}scopeCount();return;}
  if(name==='scope_clear'){scopeDraft.selectedIds.clear();for(const input of dialogs.querySelectorAll('[name=scope_project]'))input.checked=false;scopeCount();return;}
  if(name==='rename'){modalType='rename';modal('机器人名称',`<form id="rename-form"><label class="field">名称<input name="name" value="${esc(b.name)}" required maxlength="100"></label><button class="primary">保存</button></form>`);return;}
  if(name==='toggle'){if(!b.hasCredentials){await register();return;}await call('save_bot',{id:b.id,enabled:!b.enabled});}
  if(name==='delete'||name==='unlink'){modalType=name;modal(name==='delete'?'删除机器人':'解除关联',`<p>确认${name==='delete'?'删除':'解除关联'}「${esc(b.name)}」？当前飞书任务将停止。</p>`,`<button data-close>取消</button><button class="red" data-action="confirm_${name}">确认${name==='delete'?'删除':'解绑'}</button>`);return;}
  if(name==='confirm_delete'||name==='confirm_unlink'){await call(name==='confirm_delete'?'delete_bot':'unlink',{id:b.id});closeModal();}
  if(name==='reconnect')await call('reconnect',{id:b.id});
  if(name==='group_remove')await call('group_remove',{id:b.id,chatId:el.dataset.group});
  if(name==='save_scope'){if(scopeDraft?.botId!==b.id)throw Error('请重新打开项目选择');await call('save_project_scope',{id:b.id,projectIds:[...scopeDraft.selectedIds]});closeModal();toast('项目访问范围已保存');}
  if(name==='bind_code'){const r=await call('bind_code',{id:b.id});toast('绑定码已生成');modal('关联当前用户',`<p>在飞书中私聊机器人，发送以下命令：</p><div class="connection"><code>${esc(r.command)}</code></div><p class="help" style="margin-top:15px">10 分钟内有效，仅可使用一次。</p>`);return;}
  if(name==='diagnose'){modalType='diagnose';modal('连接诊断','<div class="loader"></div>');const r=await call('diagnose');modal('连接诊断',`<p>Codex：${r.codex.connected?'已连接':'连接失败'}</p><p style="margin-top:10px">登录状态：${r.codex.loggedIn?'已登录':'未登录或不可用'}</p>${r.codex.error?`<p class="error-text">${esc(r.codex.error)}</p>`:''}<div class="divider"></div>${r.logs.length?r.logs.map(x=>`<p class="help">${esc(new Date(x.time).toLocaleTimeString())} · ${esc(x.message)}</p>`).join(''):'<p class="muted">暂无错误记录。</p>'}`);return;}
  if(name==='help'){modal('使用说明',`<p class="help">1. 扫码关联机器人。<br>2. 在「项目访问范围」选择一个或多个 Codex 本地项目；其他文件夹可在「项目配置」添加。<br>3. 私聊机器人发送 /workspace 选择项目。<br>4. 发送需求，Codex 在本机执行并返回流式卡片。<br><br>/new 新对话 · /task 查看会话 · /resume 会话ID 继续对话<br>/stop 停止任务 · /model 切换模型 · /status 查看状态<br><br>群聊中由绑定用户 @机器人 /enable 启用。可在「群聊使用权限」选择仅绑定用户或群内所有成员；/enable、/disable、/workspace、/task、/resume、审批与问题回答仍仅限绑定用户。<br><br>本机服务需保持运行。此版本支持文字与富文本输入；图片、语音和文件传输未启用。</p>`);return;}
  if(name==='open-qr'){const url=el.dataset.url;if(hostApp)await hostApp.openLink({url});else window.open(url,'_blank','noopener');return;}
  await refresh();
}
document.addEventListener('click',async e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-close')){closeModal();return;}if(el.dataset.bot){selected=el.dataset.bot;render();return;}if(!el.dataset.action)return;el.disabled=true;try{await action(el.dataset.action,el);}catch(err){toast(err.message);}finally{el.disabled=false;}});
document.addEventListener('change',async e=>{if(e.target.name==='scope_project'&&scopeDraft){e.target.checked?scopeDraft.selectedIds.add(e.target.value):scopeDraft.selectedIds.delete(e.target.value);scopeCount();return;}if(e.target.id==='group-access'){try{await call('save_bot',{id:selected,groupAccess:e.target.value});toast('群聊使用权限已保存');await refresh();}catch(err){toast(err.message);await refresh();}return;}if(e.target.id==='scope'){if(e.target.value==='selected')await showScope();else try{await call('save_bot',{id:selected,allowedProjects:['*']});await refresh();}catch(err){toast(err.message);}}});
document.addEventListener('input',e=>{if(e.target.id==='scope-search'&&scopeDraft){scopeDraft.search=e.target.value;filterScope();}});
document.addEventListener('submit',async e=>{e.preventDefault();const f=e.target,values=Object.fromEntries(new FormData(f));const button=f.querySelector('button');if(button)button.disabled=true;
  try{if(f.id==='create-form'){const b=await call('create_bot',values);selected=b.id;closeModal();}if(f.id==='rename-form'){await call('save_bot',{id:selected,...values});closeModal();}if(f.id==='project-form'){await call('add_project',values);await refresh();showProjects();toast('项目已添加');return;}if(f.id==='credentials-form'){await call('save_bot',{id:selected,...values,enabled:true});f.reset();closeModal();toast('已保存');}await refresh();}catch(err){toast(err.message);}finally{if(button)button.disabled=false;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
async function start(){
  if(window.parent!==window){hostApp=new App({name:'Codex 飞书机器人',version},{});hostApp.ontoolresult=r=>{if(r.structuredContent?.bots){state=r.structuredContent;selected??=state.bots[0]?.id;render();}};await hostApp.connect();}
  await refresh();refreshTimer=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},5000);
}
start().catch(e=>appRoot.innerHTML=`<div class="empty"><p>${esc(e.message)}</p><p class="help">通过本机的「启动机器人管理」脚本或 Codex 中的飞书机器人插件重新打开。</p></div>`);
