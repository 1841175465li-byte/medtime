/* Passwords and plaintext stay in memory. No network or stored key. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedBackup = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';
  const FORMAT = 'medtime-encrypted-backup', ITERATIONS = 600000, MAX = 32 * 1024 * 1024;
  const AAD = new TextEncoder().encode(FORMAT + '/v1/PBKDF2-SHA256/600000/AES-256-GCM');
  const cryptoApi = () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('当前系统不支持加密备份，请更新 Android System WebView，或选择普通备份');
    return crypto;
  };
  function password(value) {
    if (typeof value !== 'string' || value.length < 10 || value.length > 128 || !value.trim()) throw new Error('备份密码需为 10–128 个字符');
    return value;
  }
  function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function bytes(text, length) {
    if (typeof text !== 'string' || text.length > MAX || text.length % 4 || /[^A-Za-z0-9+/=]/.test(text) || /=/.test(text.slice(0,-2)) || !/^[A-Za-z0-9+/]*={0,2}$/.test(text.slice(-2))) throw new Error('加密备份格式不正确');
    const raw = atob(text);
    if ((length && raw.length !== length) || (!length && raw.length < 16)) throw new Error('加密备份长度不正确');
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX) throw new Error('备份文件无效或超过 32 MB');
    try { return JSON.parse(text); } catch (_) { throw new Error('无法读取备份文件'); }
  }
  function isEncrypted(text) { const value=parse(text); return Boolean(value && value.format === FORMAT); }
  async function key(pass, salt, usage) {
    const api = cryptoApi(), encoded = new TextEncoder().encode(password(pass));
    try {
      const material = await api.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']);
      return await api.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS}, material, {name:'AES-GCM',length:256}, false, [usage]);
    } finally { encoded.fill(0); }
  }
  async function encrypt(text, pass) {
    if (typeof text !== 'string' || text.length > MAX / 2) throw new Error('备份内容过大');
    const api = cryptoApi(), salt = api.getRandomValues(new Uint8Array(16)), iv = api.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(text);
    try {
      const ciphertext = await api.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128}, await key(pass,salt,'encrypt'), plain);
      const output = JSON.stringify({format:FORMAT,version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt:base64(salt),iv:base64(iv),data:base64(new Uint8Array(ciphertext))}, null, 2);
      if (output.length > MAX) throw new Error('加密备份超过 32 MB');
      return output;
    } finally { plain.fill(0); }
  }
  async function decrypt(text, pass) {
    const e = parse(text);
    if (!e || Object.keys(e).sort().join('|') !== 'cipher|data|format|iterations|iv|kdf|salt|version' || e.format !== FORMAT || e.version !== 1 || e.kdf !== 'PBKDF2-SHA256' || e.iterations !== ITERATIONS || e.cipher !== 'AES-256-GCM') throw new Error('不支持此加密备份格式');
    const salt = bytes(e.salt,16), iv = bytes(e.iv,12), encrypted = bytes(e.data);
    const secret = await key(pass,salt,'decrypt');
    let plain;
    try {
      plain = new Uint8Array(await cryptoApi().subtle.decrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},secret,encrypted));
      return new TextDecoder('utf-8',{fatal:true}).decode(plain);
    } catch (_) { throw new Error('密码不正确，或备份文件已损坏'); }
    finally { if (plain) plain.fill(0); }
  }
  return Object.freeze({isEncrypted,encrypt,decrypt});
});
