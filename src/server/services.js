import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * SHADOW-IRC Services Subsystem
 * Implements: NickServ, ChanServ, MemoServ, HostServ
 * Enterprise Grade | Password Hashing (PBKDF2) | Persistent DB Storage
 */

export class IRCServicesEngine {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'services_db.json');

    // DB Schema
    this.accounts = new Map(); // accountNameLower -> AccountRecord
    this.channels = new Map(); // chanNameLower -> ChannelRegRecord
    this.memos = new Map(); // accountNameLower -> Array of MemoRecords
    this.vhosts = new Map(); // accountNameLower -> vhost string

    this.ensureDataDir();
    this.loadDB();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  hashPassword(password, salt = 'SHADOW_SERVICES_SALT_2026') {
    return crypto.pbkdf2Sync(password, salt, 50000, 32, 'sha256').toString('hex');
  }

  loadDB() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.accounts) {
          for (const [k, v] of Object.entries(parsed.accounts)) this.accounts.set(k, v);
        }
        if (parsed.channels) {
          for (const [k, v] of Object.entries(parsed.channels)) this.channels.set(k, v);
        }
        if (parsed.memos) {
          for (const [k, v] of Object.entries(parsed.memos)) this.memos.set(k, v);
        }
        if (parsed.vhosts) {
          for (const [k, v] of Object.entries(parsed.vhosts)) this.vhosts.set(k, v);
        }
        console.log(`[SERVICES] Loaded ${this.accounts.size} accounts, ${this.channels.size} registered channels.`);
      }
    } catch (err) {
      console.error(`[SERVICES ERROR] DB load failed: ${err.message}`);
    }
  }

  saveDB() {
    try {
      const payload = {
        accounts: Object.fromEntries(this.accounts),
        channels: Object.fromEntries(this.channels),
        memos: Object.fromEntries(this.memos),
        vhosts: Object.fromEntries(this.vhosts)
      };
      fs.writeFileSync(this.dbFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.error(`[SERVICES ERROR] DB save failed: ${err.message}`);
    }
  }

  // ==========================================
  // NICKSERV IMPLEMENTATION
  // ==========================================
  handleNickServ(client, command, args, sendFunc, serverState) {
    const sub = (command || '').toUpperCase();

    switch (sub) {
      case 'REGISTER': {
        const password = args[0];
        const email = args[1] || 'user@shadow.net';

        if (!client.nickname) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname || '*'} :You must have a nickname to register.`);
          return;
        }
        if (!password) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: REGISTER <password> [email]`);
          return;
        }

        const nickLower = client.nickname.toLowerCase();
        if (this.accounts.has(nickLower)) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Nickname ${client.nickname} is already registered.`);
          return;
        }

        const passHash = this.hashPassword(password);
        const account = {
          nickname: client.nickname,
          passHash,
          email,
          registeredAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };

        this.accounts.set(nickLower, account);
        client.account = nickLower;
        client.identified = true;
        this.saveDB();

        sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Nickname ${client.nickname} is now registered under account ${client.nickname}!`);
        break;
      }
      case 'IDENTIFY': {
        const password = args[0];
        if (!password) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: IDENTIFY <password>`);
          return;
        }

        const nickLower = client.nickname.toLowerCase();
        const account = this.accounts.get(nickLower);

        if (!account) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Nickname ${client.nickname} is not registered.`);
          return;
        }

        const passHash = this.hashPassword(password);
        if (passHash === account.passHash) {
          client.account = nickLower;
          client.identified = true;
          account.lastLoginAt = new Date().toISOString();
          this.saveDB();

          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Password accepted - you are now identified for ${client.nickname}.`);
          
          // Check MemoServ unread memos
          const memoList = this.memos.get(nickLower) || [];
          if (memoList.length > 0) {
            sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :You have ${memoList.length} unread memo(s). Type /msg MemoServ READ to view.`);
          }
        } else {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Password incorrect.`);
        }
        break;
      }
      case 'GHOST': {
        const targetNick = args[0];
        const password = args[1];

        if (!targetNick) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: GHOST <nickname> [password]`);
          return;
        }

        const targetLower = targetNick.toLowerCase();
        const account = this.accounts.get(targetLower);

        if (!account) {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Nickname ${targetNick} is not registered.`);
          return;
        }

        const passHash = password ? this.hashPassword(password) : null;
        if (client.account === targetLower || (passHash && passHash === account.passHash) || client.isOper) {
          // Disconnect ghost target
          const ghostClient = serverState.nicknames.get(targetLower);
          if (ghostClient) {
            serverState.send(ghostClient, `ERROR :Ghosted by ${client.nickname}`);
            serverState.closeClient(ghostClient);
            sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Ghost connection for ${targetNick} has been terminated.`);
          } else {
            sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :No active connection found for ${targetNick}.`);
          }
        } else {
          sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Permission denied for GHOST ${targetNick}.`);
        }
        break;
      }
      default: {
        sendFunc(`:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :NickServ Commands: REGISTER <pass>, IDENTIFY <pass>, GHOST <nick> [pass]`);
        break;
      }
    }
  }

  // ==========================================
  // CHANSERV IMPLEMENTATION
  // ==========================================
  handleChanServ(client, command, args, sendFunc, serverState) {
    const sub = (command || '').toUpperCase();

    switch (sub) {
      case 'REGISTER': {
        const chanName = args[0];
        const password = args[1] || '';

        if (!client.identified || !client.account) {
          sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :You must be identified with NickServ to register a channel.`);
          return;
        }
        if (!chanName || !chanName.startsWith('#')) {
          sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: REGISTER #channel [password]`);
          return;
        }

        const chanLower = chanName.toLowerCase();
        if (this.channels.has(chanLower)) {
          sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Channel ${chanName} is already registered.`);
          return;
        }

        const channelReg = {
          name: chanName,
          founder: client.account,
          registeredAt: new Date().toISOString(),
          passwordHash: password ? this.hashPassword(password) : null,
          topic: `Official channel ${chanName} | Founder: ${client.nickname}`,
          modes: '+nt'
        };

        this.channels.set(chanLower, channelReg);
        this.saveDB();

        sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Channel ${chanName} is now registered with ${client.nickname} as Founder!`);
        break;
      }
      case 'OP': {
        const chanName = args[0];
        const targetNick = args[1] || client.nickname;

        if (!chanName) {
          sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: OP #channel [nickname]`);
          return;
        }

        const chanLower = chanName.toLowerCase();
        const chanReg = this.channels.get(chanLower);

        if (chanReg && chanReg.founder === client.account) {
          const liveChan = serverState.channels.get(chanLower);
          const targetClient = serverState.nicknames.get(targetNick.toLowerCase());

          if (liveChan && targetClient && liveChan.members.has(targetClient)) {
            liveChan.ops.add(targetClient);
            serverState.broadcastChannel(liveChan, `:ChanServ!Services@shadow.cosmos.net MODE ${liveChan.name} +o ${targetClient.nickname}`);
            sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Granted Op status to ${targetClient.nickname} in ${chanName}.`);
          }
        } else {
          sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Permission denied for ChanServ OP in ${chanName}.`);
        }
        break;
      }
      default: {
        sendFunc(`:ChanServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :ChanServ Commands: REGISTER #channel [pass], OP #channel [nick]`);
        break;
      }
    }
  }

  // ==========================================
  // MEMOSERV IMPLEMENTATION
  // ==========================================
  handleMemoServ(client, command, args, sendFunc) {
    const sub = (command || '').toUpperCase();

    switch (sub) {
      case 'SEND': {
        const targetAccount = (args[0] || '').toLowerCase();
        const text = args.slice(1).join(' ');

        if (!client.identified) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :You must be identified with NickServ to send memos.`);
          return;
        }
        if (!targetAccount || !text) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Syntax: SEND <targetAccount/Nick> <message>`);
          return;
        }

        if (!this.accounts.has(targetAccount)) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Account ${targetAccount} does not exist.`);
          return;
        }

        if (!this.memos.has(targetAccount)) {
          this.memos.set(targetAccount, []);
        }

        const memoList = this.memos.get(targetAccount);
        memoList.push({
          sender: client.nickname,
          time: new Date().toISOString(),
          text
        });

        this.saveDB();
        sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Memo sent to ${targetAccount}.`);
        break;
      }
      case 'READ': {
        if (!client.identified || !client.account) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :You must be identified to read memos.`);
          return;
        }

        const memoList = this.memos.get(client.account) || [];
        if (memoList.length === 0) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :You have no memos.`);
          return;
        }

        sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :--- MEMO LIST FOR ${client.nickname} ---`);
        let idx = 1;
        for (const m of memoList) {
          sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :[${idx}] From ${m.sender} (${m.time}): ${m.text}`);
          idx++;
        }
        break;
      }
      default: {
        sendFunc(`:MemoServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :MemoServ Commands: SEND <nick> <msg>, READ`);
        break;
      }
    }
  }

  // ==========================================
  // HOSTSERV IMPLEMENTATION
  // ==========================================
  handleHostServ(client, command, args, sendFunc) {
    const sub = (command || '').toUpperCase();
    if (sub === 'REQUEST' && args[0]) {
      const vhost = args[0];
      client.hostname = vhost;
      this.vhosts.set(client.nickname.toLowerCase(), vhost);
      this.saveDB();
      sendFunc(`:HostServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :Your vHost has been set to ${vhost}!`);
    } else {
      sendFunc(`:HostServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :HostServ Syntax: REQUEST <vhost>`);
    }
  }

  // Router for services PRIVMSG target
  routeServiceMsg(client, targetService, message, sendFunc, serverState) {
    const parts = message.trim().split(/\s+/);
    const command = parts.shift();
    const args = parts;

    const serviceLower = targetService.toLowerCase();
    if (serviceLower === 'nickserv') {
      this.handleNickServ(client, command, args, sendFunc, serverState);
    } else if (serviceLower === 'chanserv') {
      this.handleChanServ(client, command, args, sendFunc, serverState);
    } else if (serviceLower === 'memoserv') {
      this.handleMemoServ(client, command, args, sendFunc);
    } else if (serviceLower === 'hostserv') {
      this.handleHostServ(client, command, args, sendFunc);
    }
  }
}
