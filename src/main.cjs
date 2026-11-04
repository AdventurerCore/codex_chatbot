const fs=require('node:fs');
const path=require('node:path');
const {version}=require('../package.json');
const {serve,ensureDaemon,apiCall,openBrowser,root,runtime}=require('./service.cjs');
const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
const UI='ui://codex-feishu-bot/dashboard';
const actions=['status','diagnose','create_bot','save_bot','delete_bot','unlink','reconnect','group_remove','add_project','list_projects','save_project_scope','begin_registration','poll_registration','bind_code'];
const tools=[
  {name:'feishu_dashboard',title:'飞书机器人',description:'打开飞书/Lark 机器人管理界面：扫码关联、开关、项目范围和群聊。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:{ui:{resourceUri:UI},'openai/ui':{entrypoints:[{type:'global'}]}}},
  {name:'feishu_status',title:'飞书机器人状态',description:'读取本地机器人连接状态、项目和运行中的任务；不会返回凭据。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'feishu_manage',title:'管理飞书机器人',description:'创建、配置、停用或删除本机飞书机器人，设置群聊成员权限，读取 Codex 本地项目候选列表并保存项目多选范围。凭据在管理界面输入。',inputSchema:{type:'object',properties:{action:{type:'string',enum:['create_bot','save_bot','delete_bot','unlink','reconnect','group_remove','add_project','list_projects','save_project_scope','bind_code','diagnose']},args:{type:'object',properties:{id:{type:'string'},name:{type:'string'},provider:{type:'string',enum:['feishu','lark']},enabled:{type:'boolean'},groupAccess:{type:'string',enum:['owner','all_members']},allowedProjects:{type:'array',items:{type:'string'}},projectIds:{type:'array',items:{type:'string'}},path:{type:'string'},chatId:{type:'string'}},additionalProperties:false}},required:['action','args'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
  {name:'feishu_ui',title:'机器人界面操作',description:'管理界面专用操作。',inputSchema:{type:'object',properties:{action:{type:'string',enum:actions},args:{type:'object'}},required:['action','args'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true},_meta:{ui:{visibility:['app']}}}
];
async function mcp(){
  const server=new Server({name:'codex-feishu-bot',version},{capabilities:{tools:{},resources:{},extensions:{'io.modelcontextprotocol/ui':{}}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
  server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:UI,name:'飞书机器人管理',mimeType:'text/html;profile=mcp-app'}]}));
  server.setRequestHandler(ReadResourceRequestSchema,async req=>{if(req.params.uri!==UI)throw Error('Unknown resource');return {contents:[{uri:UI,mimeType:'text/html;profile=mcp-app',text:fs.readFileSync(path.join(root,'dist/dashboard.html'),'utf8'),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen','inline']}}}]};});
  server.setRequestHandler(CallToolRequestSchema,async req=>{
    try{if(!tools.some(t=>t.name===req.params.name))throw Error('Unknown tool');const a=req.params.arguments||{},info=await ensureDaemon();
      const action=['feishu_dashboard','feishu_status'].includes(req.params.name)?'status':a.action;
      if(!actions.includes(action))throw Error('无效操作');if(req.params.name==='feishu_manage'&&a.args?.secret)throw Error('请在管理界面输入凭据');
      const result=await apiCall(info,action,a.args||{});return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  });
  await server.connect(new StdioServerTransport());
}
async function main(){
  const mode=process.argv[2]||'mcp';if(mode==='serve')return serve();if(mode==='mcp')return mcp();if(mode==='stop'){const r=runtime();if(r)await apiCall(r,'stop_service');return;}
  const info=await ensureDaemon();if(mode==='dashboard'){await openBrowser(`http://127.0.0.1:${info.port}/#${info.token}`);console.log('已打开飞书机器人管理页。');return;}
  if(mode==='status'||mode==='diagnose')console.log(JSON.stringify(await apiCall(info,mode),null,2));
  else if(mode==='stop')await apiCall(info,'stop_service');else throw Error('Usage: main.cjs [mcp|serve|dashboard|status|diagnose|stop]');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={mcp,main,tools};
