const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {childEnvironment, codexExecutable} = require('../src/platform.cjs');
const {version} = require('../package.json');

const root = path.resolve(__dirname, '..');
const env = childEnvironment();
function execute(command, args, json = false) {
  const result = spawnSync(command, args, {cwd:root, env, encoding:'utf8', stdio:json ? ['ignore','pipe','inherit'] : 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('安装未完成，请检查上面的命令输出。');
  return json ? JSON.parse(result.stdout) : undefined;
}
function codex(args, json = false) { return execute(codexExecutable(env), args, json); }

try {
  const marketplaces = codex(['plugin','marketplace','list','--json'], true).marketplaces;
  const existing = marketplaces.find(marketplace => marketplace.name === 'local-feishu');
  const source = existing?.marketplaceSource;
  const upstream = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?AdventurerCore\/codex_chatbot(?:\.git)?$/i;
  if (source?.sourceType === 'git' && upstream.test(source.source)) {
    // Preserve an existing upstream installation, rather than switching it to
    // a checkout path or failing because the marketplace name already exists.
    codex(['plugin','marketplace','upgrade','local-feishu']);
  } else {
    codex(['plugin','marketplace','add',root]);
  }
  const installed = codex(['plugin','add','codex-feishu-bot@local-feishu','--json'], true);
  if (installed.version !== version) throw Error(`市场中的版本为 ${installed.version}，当前仓库为 ${version}。请更新仓库或检查市场是否固定了旧版引用。`);
  console.log(`飞书机器人 ${installed.version} 已安装。`);
  execute(process.execPath, [path.join(installed.installedPath, 'dist/main.cjs'), 'dashboard']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
