import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * SHADOW-IRC Services: NickServ, ChanServ, MemoServ, HostServ
 *
 * Identity model: an account is a nickname bound to one or more device
 * public keys (ECDSA P-256). Login is a signed challenge; the server holds
 * nothing secret about the user. A password is an optional fallback.
 * The master account's password is read from MASTER_PASSWORD only, never
 * stored. The whole DB is AES-256-GCM encrypted at rest with a key derived
 * from SERVICES_DB_KEY, which lives in the process environment, not on disk.
 */

const DB_MAGIC = Buffer.from('SIDB1');
const LEGACY_SALT = 'SHADOW_SERVICES_SALT_2026';
const CHALLENGE_TTL_MS = 60000;
const MAX_KEYS_PER_ACCOUNT = 10;

export class IRCServicesEngine {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'services_db.json');
    this.dbKey = process.env.SERVICES_DB_KEY
      ? crypto.createHash('sha256').update(process.env.SERVICES_DB_KEY).digest()
      : null;
    this.readOnly = false;

    this.accounts = new Map(); // nickLower -> { nickname, keys: [spkiB64], salt?, passHash?, isMasterAdmin? }
    this.channels = new Map();
    this.memos = new Map();
    this.vhosts = new Map();

    this.ensureDataDir();
    this.loadDB();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt || LEGACY_SALT, 50000, 32, 'sha256').toString('hex');
  }

  // ---------- storage ----------

  encryptDB(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.dbKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([DB_MAGIC, iv, cipher.getAuthTag(), ct]);
  }

  decryptDB(buf) {
    const iv = buf.subarray(5, 17);
    const tag = buf.subarray(17, 33);
    const ct = buf.subarray(33);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.dbKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  loadDB() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile);
        let json;
        if (raw.subarray(0, 5).equals(DB_MAGIC)) {
          if (!this.dbKey) {
            // Refuse to clobber an encrypted DB we cannot read
            this.readOnly = true;
            console.error('[SERVICES] services_db is encrypted but SERVICES_DB_KEY is not set; running without persistence');
            this.ensureMasterAccount();
            return;
          }
          json = this.decryptDB(raw);
        } else {
          json = raw.toString('utf8');
        }
        const parsed = JSON.parse(json);
        for (const [k, v] of Object.entries(parsed.accounts || {})) this.accounts.set(k, this.sanitizeAccount(v));
        for (const [k, v] of Object.entries(parsed.channels || {})) this.channels.set(k, v);
        for (const [k, v] of Object.entries(parsed.memos || {})) this.memos.set(k, v);
        for (const [k, v] of Object.entries(parsed.vhosts || {})) this.vhosts.set(k, v);
      }
    } catch (err) {
      console.error('[SERVICES] could not load services_db:', err.message);
    }
    this.ensureMasterAccount();
  }

  // Keep only what login needs: no timestamps, no metadata
  sanitizeAccount(v) {
    const acc = { nickname: v.nickname, keys: Array.isArray(v.keys) ? v.keys : [] };
    if (v.isMasterAdmin) acc.isMasterAdmin = true;
    else if (v.passHash) { acc.salt = v.salt; acc.passHash = v.passHash; }
    return acc;
  }

  ensureMasterAccount() {
    const existing = this.accounts.get('shadow');
    if (existing && existing.isMasterAdmin && !existing.passHash) return;
    this.accounts.set('shadow', { nickname: 'Shadow', keys: existing ? existing.keys : [], isMasterAdmin: true });
    this.saveDB();
  }

  saveDB() {
    if (this.readOnly) return;
    try {
      const payload = JSON.stringify({
        accounts: Object.fromEntries(this.accounts),
        channels: Object.fromEntries(this.channels),
        memos: Object.fromEntries(this.memos),
        vhosts: Object.fromEntries(this.vhosts)
      });
      const out = this.dbKey ? this.encryptDB(payload) : Buffer.from(payload, 'utf8');
      const tmp = this.dbFile + '.tmp';
      fs.writeFileSync(tmp, out, { mode: 0o600 });
      fs.renameSync(tmp, this.dbFile);
    } catch (err) {
      console.error('[SERVICES] could not save services_db:', err.message);
    }
  }

  nukeDatabaseFile() {
    this.accounts.clear();
    this.channels.clear();
    this.memos.clear();
    this.vhosts.clear();
    try {
      if (fs.existsSync(this.dbFile)) {
        const size = fs.statSync(this.dbFile).size;
        if (size > 0) {
          fs.writeFileSync(this.dbFile, crypto.randomBytes(size));
          fs.writeFileSync(this.dbFile, Buffer.alloc(size, 0));
        }
        fs.unlinkSync(this.dbFile);
      }
    } catch (err) {
      // Anti-forensic purge fail-safe
    }
  }

  // ---------- keys ----------

  parsePublicKey(b64) {
    try {
      const der = Buffer.from(String(b64).trim(), 'base64');
      const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
      return { key, b64: der.toString('base64') };
    } catch {
      return null;
    }
  }

  fingerprint(b64) {
    return crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 16);
  }

  // ---------- identification ----------

  notice(sendFunc, service, nick, text) {
    sendFunc(`:${service}!Services@shadowspace.space NOTICE ${nick || '*'} :${text}`);
  }

  markIdentified(client, nickLower, sendFunc, serverState) {
    const account = this.accounts.get(nickLower);
    client.account = nickLower;
    client.identified = true;
    client.keyChallenge = null;
    if (client.shadowTimer) { clearTimeout(client.shadowTimer); client.shadowTimer = null; }

    this.notice(sendFunc, 'NickServ', client.nickname, `You are now identified for ${account.nickname}.`);

    if (account.isMasterAdmin) {
      client.isOper = true;
      const srv = serverState?.serverName || 'shadowspace.space';
      sendFunc(`:${srv} 381 ${client.nickname} :You are now Network Master Operator`);
    }

    const memoList = this.memos.get(nickLower) || [];
    if (memoList.length > 0) {
      this.notice(sendFunc, 'MemoServ', client.nickname, `You have ${memoList.length} unread memo(s). Type /msg MemoServ READ to view.`);
    }
  }

  verifyPassword(account, password) {
    if (account.isMasterAdmin) {
      const master = process.env.MASTER_PASSWORD;
      if (!master) return false;
      const a = crypto.createHash('sha256').update(password).digest();
      const b = crypto.createHash('sha256').update(master).digest();
      return crypto.timingSafeEqual(a, b);
    }
    if (!account.passHash) return false;
    const inputHash = this.hashPassword(password, account.salt);
    return crypto.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(account.passHash, 'hex'));
  }

  // ==========================================
  // NICKSERV
  // ==========================================
  handleNickServ(client, command, args, sendFunc, serverState) {
    const sub = (command || '').toUpperCase();
    const nick = client.nickname;
    const ns = (text) => this.notice(sendFunc, 'NickServ', nick, text);

    if (!nick) { ns('You must have a nickname first.'); return; }
    const nickLower = nick.toLowerCase();
    const account = this.accounts.get(nickLower);

    switch (sub) {
      case 'REGISTER': {
        const password = args[0];
        if (!password) { ns('Syntax: REGISTER <password>  (or REGISTERKEY <pubkey> for passwordless)'); return; }
        if (account) { ns(`Nickname ${nick} is already registered.`); return; }
        const salt = crypto.randomBytes(16).toString('hex');
        this.accounts.set(nickLower, { nickname: nick, keys: [], salt, passHash: this.hashPassword(password, salt) });
        this.saveDB();
        ns(`Nickname ${nick} is now registered under account ${nick}.`);
        this.markIdentified(client, nickLower, sendFunc, serverState);
        break;
      }

      case 'REGISTERKEY': {
        const pub = this.parsePublicKey(args[0]);
        if (!pub) { ns('Syntax: REGISTERKEY <base64 SPKI P-256 public key>'); return; }
        if (account) {
          if (client.identified && client.account === nickLower) {
            return this.handleNickServ(client, 'ADDKEY', args, sendFunc, serverState);
          }
          ns(`Nickname ${nick} is already registered. Identify first, then ADDKEY to link this device.`);
          return;
        }
        this.accounts.set(nickLower, { nickname: nick, keys: [pub.b64] });
        this.saveDB();
        ns(`Nickname ${nick} is now registered to key ${this.fingerprint(pub.b64)}.`);
        this.markIdentified(client, nickLower, sendFunc, serverState);
        break;
      }

      case 'CHALLENGE': {
        const pub = this.parsePublicKey(args[0]);
        if (!pub) { ns('Syntax: CHALLENGE <pubkey>'); return; }
        if (!account) { ns(`Nickname ${nick} is not registered.`); return; }
        if (!account.keys.includes(pub.b64)) { ns('UNKNOWNKEY This device is not linked to this nickname.'); return; }
        const nonce = crypto.randomBytes(32).toString('base64');
        client.keyChallenge = { nonce, keyB64: pub.b64, nickLower, expires: Date.now() + CHALLENGE_TTL_MS };
        ns(`CHALLENGE ${nonce}`);
        break;
      }

      case 'AUTH': {
        const ch = client.keyChallenge;
        client.keyChallenge = null;
        if (!ch || ch.expires < Date.now() || ch.nickLower !== nickLower) { ns('No active challenge. Send CHALLENGE <pubkey> first.'); return; }
        if (!account || !account.keys.includes(ch.keyB64)) { ns('Key no longer valid for this nickname.'); return; }
        let ok = false;
        try {
          const sig = Buffer.from(String(args[0] || ''), 'base64');
          const keyObj = crypto.createPublicKey({ key: Buffer.from(ch.keyB64, 'base64'), format: 'der', type: 'spki' });
          ok = crypto.verify('sha256', Buffer.from(ch.nonce, 'utf8'), { key: keyObj, dsaEncoding: 'ieee-p1363' }, sig);
        } catch { ok = false; }
        if (!ok) { ns('Signature invalid.'); return; }
        this.markIdentified(client, nickLower, sendFunc, serverState);
        break;
      }

      case 'IDENTIFY': {
        const password = args[0];
        if (!password) { ns('Syntax: IDENTIFY <password>'); return; }
        if (!account) { ns(`Nickname ${nick} is not registered.`); return; }
        if (!this.verifyPassword(account, password)) { ns('Password incorrect.'); return; }
        this.markIdentified(client, nickLower, sendFunc, serverState);
        break;
      }

      case 'ADDKEY': {
        if (!client.identified || client.account !== nickLower) { ns('You must be identified to add a key.'); return; }
        const pub = this.parsePublicKey(args[0]);
        if (!pub) { ns('Syntax: ADDKEY <pubkey>'); return; }
        if (account.keys.includes(pub.b64)) { ns(`Key ${this.fingerprint(pub.b64)} is already linked.`); return; }
        if (account.keys.length >= MAX_KEYS_PER_ACCOUNT) { ns(`Key limit (${MAX_KEYS_PER_ACCOUNT}) reached. DELKEY one first.`); return; }
        account.keys.push(pub.b64);
        this.saveDB();
        ns(`Key ${this.fingerprint(pub.b64)} linked to ${account.nickname}.`);
        break;
      }

      case 'DELKEY': {
        if (!client.identified || client.account !== nickLower) { ns('You must be identified to remove a key.'); return; }
        const fp = String(args[0] || '').toLowerCase();
        const idx = account.keys.findIndex((k) => this.fingerprint(k) === fp);
        if (idx === -1) { ns('Syntax: DELKEY <fingerprint>  (see LISTKEYS)'); return; }
        account.keys.splice(idx, 1);
        this.saveDB();
        ns(`Key ${fp} removed.`);
        break;
      }

      case 'LISTKEYS': {
        if (!client.identified || client.account !== nickLower) { ns('You must be identified to list keys.'); return; }
        if (account.keys.length === 0) { ns('No device keys linked.'); return; }
        account.keys.forEach((k, i) => ns(`[${i + 1}] ${this.fingerprint(k)}`));
        break;
      }

      case 'GHOST': {
        const targetNick = args[0];
        const password = args[1];
        if (!targetNick) { ns('Syntax: GHOST <nickname> [password]'); return; }
        const targetLower = targetNick.toLowerCase();
        const target = this.accounts.get(targetLower);
        if (!target) { ns(`Nickname ${targetNick} is not registered.`); return; }
        const allowed = client.account === targetLower || client.isOper || (password && this.verifyPassword(target, password));
        if (!allowed) { ns(`Permission denied for GHOST ${targetNick}.`); return; }
        const ghost = serverState.nicknames.get(targetLower);
        if (ghost) {
          serverState.send(ghost, `ERROR :Ghosted by ${nick}`);
          serverState.closeClient(ghost);
          ns(`Ghost connection for ${targetNick} has been terminated.`);
        } else {
          ns(`No active connection found for ${targetNick}.`);
        }
        break;
      }

      default:
        ns('NickServ: REGISTERKEY <pubkey> | CHALLENGE <pubkey> | AUTH <sig> | ADDKEY <pubkey> | DELKEY <fp> | LISTKEYS | REGISTER <pass> | IDENTIFY <pass> | GHOST <nick> [pass]');
    }
  }

  // ==========================================
  // CHANSERV
  // ==========================================
  handleChanServ(client, command, args, sendFunc, serverState) {
    const sub = (command || '').toUpperCase();
    const cs = (text) => this.notice(sendFunc, 'ChanServ', client.nickname, text);

    switch (sub) {
      case 'REGISTER': {
        const chanName = args[0];
        const password = args[1] || '';
        if (!client.identified || !client.account) { cs('You must be identified with NickServ to register a channel.'); return; }
        if (!chanName || !chanName.startsWith('#')) { cs('Syntax: REGISTER #channel [password]'); return; }
        const chanLower = chanName.toLowerCase();
        if (this.channels.has(chanLower)) { cs(`Channel ${chanName} is already registered.`); return; }
        this.channels.set(chanLower, {
          name: chanName,
          founder: client.account,
          passwordHash: password ? this.hashPassword(password) : null,
          topic: `Official channel ${chanName} | Founder: ${client.nickname}`,
          modes: '+nt'
        });
        this.saveDB();
        cs(`Channel ${chanName} is now registered with ${client.nickname} as Founder!`);
        break;
      }
      case 'OP': {
        const chanName = args[0];
        const targetNick = args[1] || client.nickname;
        if (!chanName) { cs('Syntax: OP #channel [nickname]'); return; }
        const chanLower = chanName.toLowerCase();
        const chanReg = this.channels.get(chanLower);
        if (chanReg && chanReg.founder === client.account) {
          const liveChan = serverState.channels.get(chanLower);
          const targetClient = serverState.nicknames.get(targetNick.toLowerCase());
          if (liveChan && targetClient && liveChan.members.has(targetClient)) {
            liveChan.ops.add(targetClient);
            serverState.broadcastChannel(liveChan, `:ChanServ!Services@shadowspace.space MODE ${liveChan.name} +o ${targetClient.nickname}`);
            cs(`Granted Op status to ${targetClient.nickname} in ${chanName}.`);
          }
        } else {
          cs(`Permission denied for ChanServ OP in ${chanName}.`);
        }
        break;
      }
      default:
        cs('ChanServ Commands: REGISTER #channel [pass], OP #channel [nick]');
    }
  }

  // ==========================================
  // MEMOSERV
  // ==========================================
  handleMemoServ(client, command, args, sendFunc) {
    const sub = (command || '').toUpperCase();
    const ms = (text) => this.notice(sendFunc, 'MemoServ', client.nickname, text);

    switch (sub) {
      case 'SEND': {
        const targetAccount = (args[0] || '').toLowerCase();
        const text = args.slice(1).join(' ');
        if (!client.identified) { ms('You must be identified with NickServ to send memos.'); return; }
        if (!targetAccount || !text) { ms('Syntax: SEND <targetAccount/Nick> <message>'); return; }
        if (!this.accounts.has(targetAccount)) { ms(`Account ${targetAccount} does not exist.`); return; }
        if (!this.memos.has(targetAccount)) this.memos.set(targetAccount, []);
        this.memos.get(targetAccount).push({ sender: client.nickname, text });
        this.saveDB();
        ms(`Memo sent to ${targetAccount}.`);
        break;
      }
      case 'READ': {
        if (!client.identified || !client.account) { ms('You must be identified to read memos.'); return; }
        const memoList = this.memos.get(client.account) || [];
        if (memoList.length === 0) { ms('You have no memos.'); return; }
        ms(`--- MEMO LIST FOR ${client.nickname} ---`);
        memoList.forEach((m, i) => ms(`[${i + 1}] From ${m.sender}: ${m.text}`));
        break;
      }
      default:
        ms('MemoServ Commands: SEND <nick> <msg>, READ');
    }
  }

  // ==========================================
  // HOSTSERV
  // ==========================================
  handleHostServ(client, command, args, sendFunc) {
    const sub = (command || '').toUpperCase();
    const hs = (text) => this.notice(sendFunc, 'HostServ', client.nickname, text);
    if (sub === 'REQUEST' && args[0]) {
      if (!client.identified || !client.account) { hs('You must be identified with NickServ to request a vhost.'); return; }
      const vhost = args[0];
      client.hostname = vhost;
      this.vhosts.set(client.nickname.toLowerCase(), vhost);
      this.saveDB();
      hs(`Your vHost has been set to ${vhost}!`);
    } else {
      hs('HostServ Syntax: REQUEST <vhost>');
    }
  }

  routeServiceMsg(client, targetService, message, sendFunc, serverState) {
    const parts = message.trim().split(/\s+/);
    const command = parts.shift();
    const args = parts;
    switch (targetService.toLowerCase()) {
      case 'nickserv': return this.handleNickServ(client, command, args, sendFunc, serverState);
      case 'chanserv': return this.handleChanServ(client, command, args, sendFunc, serverState);
      case 'memoserv': return this.handleMemoServ(client, command, args, sendFunc);
      case 'hostserv': return this.handleHostServ(client, command, args, sendFunc);
    }
  }
}
