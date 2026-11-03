const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {getDataDir, childEnvironment, codexExecutable, browserCommand} = require('../src/platform.cjs');

test('macOS data location preserves legacy state and respects explicit overrides', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-home-'));
  try {
    const current = path.join(home, 'Library', 'Application Support', 'CodexFeishuBridge');
    const legacy = path.join(home, '.local/share/CodexFeishuBridge');
    assert.equal(getDataDir({}, 'darwin', home), current);
    fs.mkdirSync(legacy, {recursive:true});
    fs.writeFileSync(path.join(legacy, 'state.json'), '{}');
    assert.equal(getDataDir({}, 'darwin', home), legacy);
    fs.mkdirSync(current, {recursive:true});
    fs.writeFileSync(path.join(current, 'state.json'), '{}');
    assert.equal(getDataDir({}, 'darwin', home), current);
    assert.equal(getDataDir({CODEX_FEISHU_DATA_DIR:legacy}, 'darwin', home), legacy);
  } finally { fs.rmSync(home, {recursive:true, force:true}); }
});

test('macOS browser launch passes a URL as one argument without shell interpolation', () => {
  const url = 'http://127.0.0.1:23947/#abc&value=$(touch%20/tmp/should-not-exist)';
  const command = browserCommand(url, 'darwin');
  assert.equal(command.command, '/usr/bin/open');
  assert.deepEqual(command.args, [url]);
  assert.throws(() => browserCommand('file:///tmp/example', 'darwin'), /地址无效/);
});

test('Windows browser launch keeps the URL out of the PowerShell program', () => {
  const url = 'http://127.0.0.1:23947/#example';
  const command = browserCommand(url, 'win32');
  assert.equal(command.command, 'powershell.exe');
  assert.equal(command.env.CODEX_FEISHU_OPEN_URL, url);
  assert.ok(!command.args.at(-1).includes(url));
});

test('Finder PATH fallback still honors the configured Codex executable and PATH order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-tools-'));
  try {
    const custom = path.join(dir, 'codex');
    fs.writeFileSync(custom, '#!/bin/sh\nexit 0\n', {mode:0o755});
    const env = {PATH:dir};
    assert.equal(codexExecutable(env, 'darwin'), custom);
    assert.equal(codexExecutable({...env, CODEX_FEISHU_CODEX_PATH:'/custom/codex'}, 'darwin'), '/custom/codex');
    const expanded = childEnvironment(env, 'darwin');
    assert.equal(expanded.PATH.split(path.delimiter)[0], dir);
    assert.ok(expanded.PATH.split(path.delimiter).includes('/opt/homebrew/bin'));
    assert.equal(env.PATH, dir);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
