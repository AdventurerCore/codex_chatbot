const crypto = require('node:crypto');
const {execFile} = require('node:child_process');

const KEYCHAIN_SERVICE = 'com.adventurercore.codex-feishu-bot';
const KEYCHAIN_ACCOUNT = 'credential-key-v1';
const MAC_PREFIX = 'macos-keychain-v1:';

function runProcess(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {encoding:'utf8', timeout:30000, maxBuffer:65536, windowsHide:true}, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else resolve({code:error?.code || 0, stdout, stderr});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function createSecretTransform({platform = process.platform, run = runProcess, keychainAccount = KEYCHAIN_ACCOUNT} = {}) {
  // This account also appears in security's stdin command language. Never accept
  // quotes, whitespace or command separators here.
  if (!/^[a-zA-Z0-9-]+$/.test(keychainAccount)) throw Error('Invalid Keychain account');
  let keyPromise;

  async function readKey() {
    let result;
    try {
      result = await run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount, '-w']);
    } catch {
      throw Error('无法访问 macOS 钥匙串，请解锁登录钥匙串并允许访问后重试。');
    }
    if (result.code === 44) return null; // errSecItemNotFound
    if (result.code !== 0) throw Error(`无法读取 macOS 钥匙串（错误 ${result.code}），请解锁登录钥匙串并允许访问后重试。`);
    const hex = result.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(hex)) throw Error('macOS 钥匙串中的加密密钥无效，请恢复原密钥或重新配置凭据。');
    return Buffer.from(hex, 'hex');
  }

  async function loadKey(create) {
    let key = await readKey();
    if (key) return key;
    if (!create) throw Error('macOS 钥匙串中缺少原加密密钥，请在这台 Mac 上重新关联机器人。');
    const candidate = crypto.randomBytes(32).toString('hex');
    try {
      // Use security's stdin, never argv or a shell, for the generated key.
      // Do not use -U: concurrent first saves must keep the first stored key.
      await run('/usr/bin/security', ['-q', '-i'], `add-generic-password -s ${KEYCHAIN_SERVICE} -a ${keychainAccount} -l "Codex Feishu Bridge" -w ${candidate}\n`);
    } catch {
      throw Error('无法将加密密钥保存到 macOS 钥匙串，请解锁登录钥匙串并允许访问后重试。');
    }
    // Interactive security may exit successfully even if its command failed.
    // Read back the winning key, including when another process created it.
    key = await readKey();
    if (!key) throw Error('未能将加密密钥保存到 macOS 钥匙串，凭据未保存。');
    return key;
  }

  function macKey(create) {
    if (!keyPromise) keyPromise = loadKey(create).catch(error => { keyPromise = null; throw error; });
    return keyPromise;
  }

  return async function secretTransform(value, decrypt = false) {
    if (platform === 'win32') {
      if (decrypt && value.startsWith(MAC_PREFIX)) throw Error('这些凭据来自 macOS，请在 Windows 上重新关联机器人。');
      const script = 'Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::' + (decrypt ? 'Unprotect' : 'Protect') + '($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))';
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], decrypt ? value : Buffer.from(value, 'utf8').toString('base64'));
      if (result.code) throw Error('Windows 凭据加密/解密失败');
      return decrypt ? Buffer.from(result.stdout.trim(), 'base64').toString('utf8') : result.stdout.trim();
    }
    if (platform !== 'darwin') throw Error('此插件的凭据存储目前支持 Windows 和 macOS。');

    if (decrypt) {
      if (!value.startsWith(MAC_PREFIX)) throw Error('这些凭据不是 macOS 钥匙串格式，请在这台 Mac 上重新关联机器人。');
      const encoded = value.slice(MAC_PREFIX.length), payload = Buffer.from(encoded, 'base64');
      if (payload.length < 28 || payload.toString('base64') !== encoded) throw Error('macOS 凭据格式无效，请重新关联机器人。');
      const key = await macKey(false);
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
        decipher.setAAD(Buffer.from(MAC_PREFIX));
        decipher.setAuthTag(payload.subarray(12, 28));
        return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        throw Error('macOS 凭据解密失败，请恢复原钥匙串或重新关联机器人。');
      }
    }

    const key = await macKey(true), nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(MAC_PREFIX));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return MAC_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
  };
}

const secretTransform = createSecretTransform();
module.exports = {secretTransform, createSecretTransform, runProcess, KEYCHAIN_SERVICE, MAC_PREFIX};
