const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
async function build(){
  const nodePaths=process.env.CODEX_FEISHU_NODE_MODULES?[process.env.CODEX_FEISHU_NODE_MODULES]:[];
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  await esbuild.build({entryPoints:[path.join(root,'src/main.cjs')],outfile:path.join(root,'dist/main.cjs'),bundle:true,platform:'node',target:'node22',format:'cjs',nodePaths,legalComments:'linked'});
  const app=await esbuild.build({entryPoints:[path.join(root,'src/ui/app.js')],bundle:true,platform:'browser',target:'es2022',format:'iife',nodePaths,write:false,legalComments:'none'});
  const template=fs.readFileSync(path.join(root,'src/ui/index.html'),'utf8');
  fs.writeFileSync(path.join(root,'dist/dashboard.html'),template.replace('/*APP_SCRIPT*/',()=>app.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));
  console.log('Built server and dashboard.');
}
build().catch(e=>{console.error(e);process.exitCode=1;});
