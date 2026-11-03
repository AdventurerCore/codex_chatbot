const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function getDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.CODEX_FEISHU_DATA_DIR) return env.CODEX_FEISHU_DATA_DIR;
  const legacy = path.join(env.LOCALAPPDATA || path.join(home, '.local/share'), 'CodexFeishuBridge');
  if (platform !== 'darwin') return legacy;
  const current = path.join(home, 'Library', 'Application Support', 'CodexFeishuBridge');
  // Keep projects and bots saved by an earlier installation in their old place.
  return !fs.existsSync(path.join(current, 'state.json')) && fs.existsSync(path.join(legacy, 'state.json')) ? legacy : current;
}

function childEnvironment(env = process.env, platform = process.platform) {
  if (platform !== 'darwin') return env;
  // Finder-launched apps may not inherit Homebrew's PATH. Include the running
  // Node directory as well: the Codex npm launcher uses /usr/bin/env node.
  const dirs = [...(env.PATH || '/usr/bin:/bin').split(path.delimiter), path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')];
  return {...env, PATH:[...new Set(dirs)].join(path.delimiter)};
}

function codexExecutable(env = process.env, platform = process.platform) {
  if (env.CODEX_FEISHU_CODEX_PATH) return env.CODEX_FEISHU_CODEX_PATH;
  if (platform === 'darwin') {
    for (const dir of childEnvironment(env, platform).PATH.split(path.delimiter)) {
      const candidate = path.resolve(dir, 'codex');
      try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return 'codex';
}

function browserCommand(url, platform = process.platform, env = process.env) {
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw Error('管理页地址无效');
  if (platform === 'darwin') return {command:'/usr/bin/open', args:[url], env};
  if (platform === 'win32') return {command:'powershell.exe', args:['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:CODEX_FEISHU_OPEN_URL'], env:{...env, CODEX_FEISHU_OPEN_URL:url}};
  throw Error('自动打开管理页目前支持 Windows 和 macOS。');
}

module.exports = {getDataDir, childEnvironment, codexExecutable, browserCommand};
