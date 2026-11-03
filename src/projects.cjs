const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function projectPathKey(input) {
  let real;
  try { real = fs.realpathSync.native(input); } catch { real = path.resolve(input); }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function projectEntry(input, name, projectId = null) {
  if (typeof input !== 'string' || input.includes('\0') || !path.isAbsolute(input)) return null;
  let real = path.resolve(input), available = false;
  try { real = fs.realpathSync.native(real); available = fs.statSync(real).isDirectory(); } catch {}
  return {
    id:'project-' + crypto.createHash('sha256').update(projectPathKey(real)).digest('hex').slice(0,24),
    name:String(name || path.basename(real)).slice(0,100), path:real,
    projectId, available, fromCodex:false
  };
}

async function listProjectCatalog(codex, configured = []) {
  const entries = new Map();
  for (const project of configured) {
    const entry = projectEntry(project.path, project.name, project.id);
    if (entry) entries.set(entry.id, entry);
  }
  let warning = null;
  try {
    const native = [], cursors = new Set();
    let cursor = null;
    do {
      const page = await codex.request('project/list', {limit:100, cursor});
      if (!Array.isArray(page.data)) throw Error('Invalid project catalog');
      native.push(...page.data);
      cursor = page.nextCursor || null;
      if (cursor && cursors.has(cursor)) throw Error('Repeated project cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    for (const project of native) {
      const roots = Array.isArray(project.roots) ? project.roots : [];
      for (const root of roots) {
        if (!root || typeof root.path !== 'string') continue;
        const name = roots.length > 1 ? `${project.name || '项目'} · ${path.basename(root.path || '')}` : project.name;
        const entry = projectEntry(root.path, name);
        if (!entry) continue;
        const existing = entries.get(entry.id);
        if (existing) existing.fromCodex = true;
        else entries.set(entry.id, {...entry, fromCodex:true});
      }
    }
  } catch {
    warning = '暂时无法读取 Codex 已有项目，请检查 Codex CLI 后刷新。也可以在项目配置中手动添加文件夹。';
  }
  return {projects:[...entries.values()].sort((a,b) => a.name.localeCompare(b.name, 'zh-CN', {numeric:true})), warning};
}

module.exports = {listProjectCatalog, projectPathKey};
