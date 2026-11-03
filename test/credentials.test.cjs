const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createSecretTransform, runProcess, KEYCHAIN_SERVICE, MAC_PREFIX} = require('../src/credentials.cjs');

function keychain({key = null, readCode = 0, refuseWrite = false} = {}) {
  const state = {key, calls:[], writes:0};
  state.run = async (command, args, input = '') => {
    state.calls.push({command, args, input});
    assert.equal(command, '/usr/bin/security');
    if (args[0] === 'find-generic-password') {
      if (readCode) return {code:readCode, stdout:'', stderr:'denied'};
      return {code:state.key ? 0 : 44, stdout:state.key ? state.key + '\n' : '', stderr:''};
    }
    assert.deepEqual(args, ['-q', '-i']);
    assert.ok(!input.includes(' -U') && !input.includes(' -A'));
    const candidate = input.match(/ -w ([a-f0-9]{64})\n$/)?.[1];
    assert.ok(candidate);
    if (!state.key && !refuseWrite) { state.key = candidate; state.writes++; }
    return {code:0, stdout:'', stderr:''};
  };
  state.cipher = () => createSecretTransform({platform:'darwin', run:state.run});
  return state;
}

test('macOS credentials survive a process restart without storing plaintext or argv keys', async () => {
  const store = keychain(), encrypt = store.cipher();
  const secret = '测试密钥 \' " $()\nsecond line';
  const first = await encrypt(secret), second = await encrypt(secret);
  assert.ok(first.startsWith(MAC_PREFIX));
  assert.ok(!first.includes(secret));
  assert.notEqual(first, second);
  assert.equal(await store.cipher()(first, true), secret);
  assert.equal(store.writes, 1);
  for (const call of store.calls) {
    assert.ok(!call.args.join(' ').includes(store.key));
    assert.ok(!call.args.join(' ').includes(secret));
  }
});

test('macOS credential authentication rejects altered ciphertext', async () => {
  const store = keychain(), cipher = store.cipher();
  const encrypted = await cipher('synthetic-secret');
  const payload = Buffer.from(encrypted.slice(MAC_PREFIX.length), 'base64');
  payload[payload.length - 1] ^= 1;
  await assert.rejects(cipher(MAC_PREFIX + payload.toString('base64'), true), /解密失败/);
});

test('missing original Keychain key is never replaced while decrypting', async () => {
  const source = keychain(), encrypted = await source.cipher()('synthetic-secret');
  const missing = keychain();
  await assert.rejects(missing.cipher()(encrypted, true), /缺少原加密密钥/);
  assert.equal(missing.writes, 0);
  assert.equal(missing.calls.length, 1);
});

test('locked or denied Keychain access fails without saving a replacement key', async () => {
  const store = keychain({readCode:36});
  await assert.rejects(store.cipher()('synthetic-secret'), /解锁登录钥匙串/);
  assert.equal(store.writes, 0);
  assert.equal(store.calls.length, 1);
});

test('a successful security REPL exit is insufficient without a stored key', async () => {
  const store = keychain({refuseWrite:true});
  await assert.rejects(store.cipher()('synthetic-secret'), /凭据未保存/);
  assert.equal(store.writes, 0);
});

test('an invalid existing Keychain key is never overwritten', async () => {
  const store = keychain({key:'damaged-key'});
  await assert.rejects(store.cipher()('synthetic-secret'), /加密密钥无效/);
  assert.equal(store.key, 'damaged-key');
  assert.equal(store.writes, 0);
});

test('concurrent first saves share the winning Keychain key across processes', async () => {
  const store = keychain(), first = store.cipher(), second = store.cipher();
  const values = await Promise.all([first('first'), second('second'), first('third')]);
  assert.equal(store.writes, 1);
  const reader = store.cipher();
  assert.deepEqual(await Promise.all(values.map(value => reader(value, true))), ['first', 'second', 'third']);
});

test('foreign and malformed credentials fail before accessing the Keychain', async () => {
  const store = keychain(), cipher = store.cipher();
  await assert.rejects(cipher('windows-dpapi-base64', true), /不是 macOS 钥匙串格式/);
  await assert.rejects(cipher(MAC_PREFIX + 'not-base64', true), /格式无效/);
  assert.equal(store.calls.length, 0);
});

test('Windows retains its existing DPAPI format and stdin transport', async () => {
  const secret = 'synthetic Windows secret', protectedValue = 'existing-dpapi-ciphertext';
  const cipher = createSecretTransform({platform:'win32', run:async (command, args, input) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(!args.join(' ').includes(secret));
    const decrypt = args.at(-1).includes('::Unprotect');
    assert.equal(input, decrypt ? protectedValue : Buffer.from(secret).toString('base64'));
    return {code:0, stdout:decrypt ? Buffer.from(secret).toString('base64') : protectedValue};
  }});
  assert.equal(await cipher(secret), protectedValue);
  assert.equal(await cipher(protectedValue, true), secret);
  await assert.rejects(cipher(MAC_PREFIX + 'anything', true), /来自 macOS/);
});

test('unsupported systems never fall back to storing plaintext credentials', async () => {
  const cipher = createSecretTransform({platform:'linux'});
  await assert.rejects(cipher('synthetic-secret'), /Windows 和 macOS/);
});

test('real macOS Keychain roundtrip across separate cipher instances', {
  skip:process.platform !== 'darwin' || process.env.CODEX_FEISHU_TEST_KEYCHAIN !== '1', timeout:60000
}, async () => {
  const account = 'test-' + crypto.randomUUID();
  const options = {platform:'darwin', keychainAccount:account};
  try {
    const secret = 'synthetic-keychain-test-' + crypto.randomUUID();
    const encrypted = await createSecretTransform(options)(secret);
    assert.equal(await createSecretTransform(options)(encrypted, true), secret);
  } finally {
    const result = await runProcess('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]);
    assert.ok(result.code === 0 || result.code === 44);
  }
});
