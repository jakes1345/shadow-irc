import net from 'net';
import http from 'http';
import tls from 'tls';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { IRCServicesEngine } from './services.js';
import { IRCv3HistoryEngine, IRCv3CapNegotiator } from './ircv3.js';
import { BouncerEngine } from './bouncer.js';
import { BanEngine } from './banEngine.js';

/**
 * SHADOW-IRCD v4.0: Deep Space Cosmic Nebula IRC Server Daemon
 * Features:
 *  - Native TCP Sockets (6667) & WebSockets / Web Client (8888)
 *  - Deep Space Nebula Cosmos Theme (Zero Cyberpunk Text)
 *  - CTCP Subsystem (VERSION, TIME, PING, ACTION /me) & DCC Signal Relay
 *  - IP Hash Cloaking (user@cosmos/shadow/x-hash)
 *  - Channel Modes +m (Moderated), +i (Invite Only) & /invite
 *  - OperServ Wallops Network Broadcast (/wallops)
 *  - Built-in Services (NickServ, ChanServ, MemoServ, HostServ)
 *  - IRCv3 Specification Suite (server-time, echo-message, chathistory, sasl)
 *  - Ring Buffer History Engine (500 items per channel with scrollback replay)
 *  - ZNC-style 24/7 Bouncer Session Persistence
 *  - Wildcard & CIDR Ban Mask Engine (+b)
 */

class ShadowIRCServer {
  constructor(options = {}) {
    this.port = options.port || 6667;
    this.webPort = options.webPort || 8888;
    this.host = options.host || '0.0.0.0';
    this.serverName = options.serverName || 'shadow.cosmos.net';
    this.version = 'shadow-ircd-4.0.0-cosmic-space';
    this.createdDate = new Date().toISOString();
    
    // Server State
    this.clients = new Map(); // socket/ws -> ClientState
    this.nicknames = new Map(); // nickname (lowercase) -> ClientState
    this.channels = new Map(); // channelName (lowercase) -> ChannelState
    
    // Subsystem Modules
    this.services = new IRCServicesEngine();
    this.history = new IRCv3HistoryEngine(500);
    this.bouncer = new BouncerEngine();
    
    // Operator Credentials
    this.operUser = options.operUser || 'admin';
    this.operPass = options.operPass || 'cosmicsecret';
    
    // Rate Limiting
    this.maxMessageRate = 12;
    
    this.motd = [
      "==========================================================================",
      "   ______  ______  ___  ______  ______ _ _  _ ___________ _____ ",
      "  /  ___/ / / / / / _ \\ /  _  \\ /  __  / / / / / /  __/  __/  __/",
      "  \\___ \\ / /_/ / / /_\\ \\/  //  / / /_/ / /_/ / / /  _/  _/  / /_ ",
      " /____/ /_____/ /_/   \\_\\_____/ /_____/\\____/_/_/  /___/  \\____/ ",
      "==========================================================================",
      "       WELCOME TO SHADOW-IRC v4.0 - DEEP SPACE COSMOS NETWORK             ",
      " Quantum Void | Nebula Particles | Event Horizon E2EE | IP Cloaked         ",
      " Services: NickServ | ChanServ | MemoServ | HostServ | Bouncer | CTCP    ",
      "=========================================================================="
    ];
  }

  start() {
    // 1. Native TCP Socket Server (Port 6667)
    this.tcpServer = net.createServer((socket) => this.handleTcpConnection(socket));
    this.tcpServer.on('error', (err) => console.error(`[TCP ERROR] ${err.message}`));
    this.tcpServer.listen(this.port, this.host, () => {
      console.log(`\x1b[36m[SHADOW-IRCD v4.0]\x1b[0m Native TCP Space Engine on \x1b[35m${this.host}:${this.port}\x1b[0m`);
    });

    // 2. HTTP Server + WebSocket Server (Port 8888) for Web Browsers
    this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    
    this.wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    this.httpServer.listen(this.webPort, this.host, () => {
      console.log(`\x1b[36m[SHADOW-IRCD v4.0]\x1b[0m Cosmic Web Gateway on \x1b[32mhttp://${this.host}:${this.webPort}\x1b[0m`);
    });
  }

  handleTcpConnection(socket) {
    const client = this.createClientState(socket, socket.remoteAddress, 'TCP');

    socket.on('data', (chunk) => {
      this.processRawInput(client, chunk.toString('utf8'));
    });

    socket.on('close', () => this.handleDisconnect(client, 'Client Quit'));
    socket.on('error', (err) => this.handleDisconnect(client, err.message));
  }

  handleWsConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    const client = this.createClientState(ws, ip, 'WebSocket');

    ws.on('message', (message) => {
      this.processRawInput(client, message.toString('utf8'));
    });

    ws.on('close', () => this.handleDisconnect(client, 'WebSocket Disconnected'));
    ws.on('error', (err) => this.handleDisconnect(client, err.message));
  }

  createClientState(connection, ip, type) {
    const clientId = crypto.randomUUID();

    // Generate automatic IP Hash Cloak (user@cosmos/shadow/x-hash)
    const ipHash = crypto.createHash('sha256').update(ip || '127.0.0.1').digest('hex').substring(0, 10);
    const hostCloak = `cosmos/shadow/x-${ipHash}`;

    const client = {
      id: clientId,
      connection,
      type,
      ip,
      nickname: null,
      username: null,
      realname: null,
      hostname: hostCloak,
      registered: false,
      account: null,
      identified: false,
      channels: new Set(),
      invitedChannels: new Set(),
      isOper: false,
      bouncerEnabled: false,
      enabledCaps: new Set(['server-time']),
      msgCount: 0,
      lastMsgReset: Date.now(),
      buffer: ''
    };

    this.clients.set(connection, client);
    console.log(`[CONNECT] New ${type} peer from ${ip} (Cloak: ${hostCloak})`);
    return client;
  }

  processRawInput(client, rawData) {
    const now = Date.now();
    if (now - client.lastMsgReset > 2000) {
      client.msgCount = 0;
      client.lastMsgReset = now;
    }
    client.msgCount++;
    if (client.msgCount > this.maxMessageRate) {
      this.send(client, `:${this.serverName} 465 ${client.nickname || '*'} :Flood control triggered. Slow down.`);
      return;
    }

    client.buffer += rawData;
    if (client.buffer.length > 65536) {
      this.closeClient(client);
      return;
    }

    let lines = client.buffer.split(/\r?\n/);
    client.buffer = lines.pop();

    for (let line of lines) {
      line = line.trim();
      if (line.length > 0) {
        if (line.length > 512) line = line.substring(0, 512);
        this.parseAndExecute(client, line);
      }
    }
  }

  handleDisconnect(client, reason) {
    if (!this.clients.has(client.connection)) return;

    if (client.bouncerEnabled && client.account) {
      this.bouncer.detachSession(client, reason);
      this.clients.delete(client.connection);
      return;
    }
    
    console.log(`[DISCONNECT] ${client.nickname || client.ip} (${client.type}) - ${reason}`);
    
    for (const channelName of client.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        channel.members.delete(client);
        channel.ops.delete(client);
        channel.voice.delete(client);
        
        this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} QUIT :${reason}`);
        
        if (channel.members.size === 0) {
          this.channels.delete(channelName);
        }
      }
    }
    
    if (client.nickname) {
      this.nicknames.delete(client.nickname.toLowerCase());
    }
    this.clients.delete(client.connection);
  }

  closeClient(client) {
    if (client.type === 'TCP') {
      client.connection.destroy();
    } else if (client.type === 'WebSocket') {
      client.connection.close();
    }
  }

  parseAndExecute(client, rawLine) {
    let trailing = '';
    let line = rawLine;

    const trailingIdx = line.indexOf(' :');
    if (trailingIdx !== -1) {
      trailing = line.substring(trailingIdx + 2);
      line = line.substring(0, trailingIdx);
    }

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;

    if (parts[0].startsWith(':')) {
      parts.shift();
    }

    const command = parts.shift().toUpperCase();
    const args = parts;
    if (trailing) args.push(trailing);

    this.dispatchCommand(client, command, args, rawLine);
  }

  dispatchCommand(client, command, args, rawLine) {
    switch (command) {
      case 'CAP':
        IRCv3CapNegotiator.handleCap(client, args[0], args[1], (msg) => this.send(client, msg));
        break;
      case 'NICK':
        this.handleNick(client, args[0]);
        break;
      case 'USER':
        this.handleUser(client, args);
        break;
      case 'PING':
        this.send(client, `:${this.serverName} PONG ${this.serverName} :${args[0] || ''}`);
        break;
      case 'PONG':
        break;
      case 'JOIN':
        this.handleJoin(client, args[0], args[1]);
        break;
      case 'PART':
        this.handlePart(client, args[0], args[1]);
        break;
      case 'PRIVMSG':
        this.handlePrivmsg(client, args[0], args[1], false);
        break;
      case 'NOTICE':
        this.handlePrivmsg(client, args[0], args[1], true);
        break;
      case 'TOPIC':
        this.handleTopic(client, args[0], args[1]);
        break;
      case 'MODE':
        this.handleMode(client, args[0], args[1], args[2]);
        break;
      case 'INVITE':
        this.handleInvite(client, args[0], args[1]);
        break;
      case 'WHOIS':
        this.handleWhois(client, args[0]);
        break;
      case 'NAMES':
        this.handleNames(client, args[0]);
        break;
      case 'LIST':
        this.handleList(client);
        break;
      case 'OPER':
        this.handleOper(client, args[0], args[1]);
        break;
      case 'WALLOPS':
      case 'OPERWALL':
        this.handleWallops(client, args[0] || args.join(' '));
        break;
      case 'KICK':
        this.handleKick(client, args[0], args[1], args[2]);
        break;

      // Service Shortcuts
      case 'NS':
      case 'NICKSERV':
        this.services.handleNickServ(client, args[0], args.slice(1), (msg) => this.send(client, msg), this);
        break;
      case 'CS':
      case 'CHANSERV':
        this.services.handleChanServ(client, args[0], args.slice(1), (msg) => this.send(client, msg), this);
        break;
      case 'MS':
      case 'MEMOSERV':
        this.services.handleMemoServ(client, args[0], args.slice(1), (msg) => this.send(client, msg));
        break;
      case 'HS':
      case 'HOSTSERV':
        this.services.handleHostServ(client, args[0], args.slice(1), (msg) => this.send(client, msg));
        break;
      case 'BOUNCER':
        if (args[0] && args[0].toUpperCase() === 'ENABLE') {
          client.bouncerEnabled = true;
          this.send(client, `:${this.serverName} NOTICE ${client.nickname} :ZNC-Style Bouncer enabled for your session!`);
        } else if (args[0] && args[0].toUpperCase() === 'DISABLE') {
          client.bouncerEnabled = false;
          this.send(client, `:${this.serverName} NOTICE ${client.nickname} :Bouncer session persistence disabled.`);
        }
        break;

      case 'QUIT':
        this.send(client, `ERROR :Closing Link: ${client.hostname} (${args[0] || 'Quit'})`);
        this.closeClient(client);
        break;
      default:
        if (client.registered) {
          this.send(client, `:${this.serverName} 421 ${client.nickname} ${command} :Unknown command`);
        }
        break;
    }
  }

  handleNick(client, nick) {
    if (!nick) {
      this.send(client, `:${this.serverName} 431 * :No nickname given`);
      return;
    }

    if (!/^[a-zA-Z0-9_\-\[\]\\`^{}|]{1,30}$/.test(nick)) {
      this.send(client, `:${this.serverName} 432 * ${nick} :Erroneous nickname`);
      return;
    }

    const nickLower = nick.toLowerCase();
    const existing = this.nicknames.get(nickLower);

    if (existing && existing !== client) {
      this.send(client, `:${this.serverName} 433 ${client.nickname || '*'} ${nick} :Nickname is already in use`);
      return;
    }

    const oldNick = client.nickname;
    if (oldNick) {
      this.nicknames.delete(oldNick.toLowerCase());
    }
    
    client.nickname = nick;
    this.nicknames.set(nickLower, client);

    if (oldNick) {
      const nickChangeMsg = `:${oldNick}!${client.username}@${client.hostname} NICK :${nick}`;
      this.send(client, nickChangeMsg);
      const notified = new Set([client]);
      for (const chanName of client.channels) {
        const chan = this.channels.get(chanName);
        if (chan) {
          for (const member of chan.members) {
            if (!notified.has(member)) {
              notified.add(member);
              this.send(member, nickChangeMsg);
            }
          }
        }
      }
    } else {
      this.checkRegistration(client);
    }
  }

  handleUser(client, args) {
    if (client.registered) {
      this.send(client, `:${this.serverName} 462 ${client.nickname} :Unauthorized command (Already registered)`);
      return;
    }
    if (args.length < 4) {
      this.send(client, `:${this.serverName} 461 * USER :Not enough parameters`);
      return;
    }

    client.username = args[0] || 'anon';
    client.realname = args[3] || 'Shadow Cosmic User';
    this.checkRegistration(client);
  }

  checkRegistration(client) {
    if (!client.registered && client.nickname && client.username) {
      client.registered = true;
      
      this.send(client, `:${this.serverName} 001 ${client.nickname} :Welcome to the Shadow IRC Cosmic Network ${client.nickname}!${client.username}@${client.hostname}`);
      this.send(client, `:${this.serverName} 002 ${client.nickname} :Your host is ${this.serverName}, running version ${this.version}`);
      this.send(client, `:${this.serverName} 003 ${client.nickname} :This server was created ${this.createdDate}`);
      this.send(client, `:${this.serverName} 004 ${client.nickname} ${this.serverName} ${this.version} o v m i k t n s b`);

      this.send(client, `:${this.serverName} 375 ${client.nickname} :- ${this.serverName} Message of the day - `);
      for (const line of this.motd) {
        this.send(client, `:${this.serverName} 372 ${client.nickname} :- ${line}`);
      }
      this.send(client, `:${this.serverName} 376 ${client.nickname} :End of MOTD command`);

      if (this.services.accounts.has(client.nickname.toLowerCase())) {
        this.send(client, `:NickServ!Services@shadow.cosmos.net NOTICE ${client.nickname} :This nickname is registered. Please identify with /msg NickServ IDENTIFY <password>`);
      }
    }
  }

  handleJoin(client, targetChannels, key) {
    if (!this.requireAuth(client)) return;
    if (!targetChannels) {
      this.send(client, `:${this.serverName} 461 ${client.nickname} JOIN :Not enough parameters`);
      return;
    }

    const chanList = targetChannels.split(',');
    for (let name of chanList) {
      name = name.trim();
      if (!name.startsWith('#') && !name.startsWith('&')) {
        name = '#' + name;
      }
      const chanLower = name.toLowerCase();

      let channel = this.channels.get(chanLower);
      let isFirst = false;

      if (!channel) {
        isFirst = true;
        channel = {
          name,
          topic: 'Welcome to ' + name + ' | Shadow Cosmic Network',
          topicSetBy: 'System',
          topicSetAt: Math.floor(Date.now() / 1000),
          key: null,
          modes: new Set(['n', 't']),
          bans: new Set(),
          members: new Set(),
          ops: new Set(),
          voice: new Set(),
        };
        this.channels.set(chanLower, channel);
      }

      // Check Ban Engine
      if (BanEngine.isBanned(client, channel)) {
        this.send(client, `:${this.serverName} 474 ${client.nickname} ${name} :Cannot join channel (+b) - banned`);
        continue;
      }

      // Check Invite-Only Mode (+i)
      if (channel.modes.has('i') && !client.invitedChannels.has(chanLower) && !isFirst && !client.isOper) {
        this.send(client, `:${this.serverName} 473 ${client.nickname} ${name} :Cannot join channel (+i) - invite only`);
        continue;
      }

      if (channel.modes.has('k') && channel.key && channel.key !== key && !isFirst) {
        this.send(client, `:${this.serverName} 475 ${client.nickname} ${name} :Cannot join channel (+k) - bad key`);
        continue;
      }

      channel.members.add(client);
      client.channels.add(chanLower);

      const chanReg = this.services.channels.get(chanLower);
      if (isFirst || client.isOper || (chanReg && chanReg.founder === client.account)) {
        channel.ops.add(client);
      }

      const joinMsg = `:${client.nickname}!${client.username}@${client.hostname} JOIN :${name}`;
      this.broadcastChannel(channel, joinMsg);

      this.send(client, `:${this.serverName} 332 ${client.nickname} ${name} :${channel.topic}`);
      this.sendNamesReply(client, channel);

      // Replay IRCv3 History Scrollback to joining client
      const historyItems = this.history.getHistory(chanLower, 40);
      if (historyItems.length > 0) {
        this.send(client, `:shadow.cosmos.net NOTICE ${client.nickname} :*** IRCv3 Scrollback History for ${name} ***`);
        for (const item of historyItems) {
          const type = item.isNotice ? 'NOTICE' : 'PRIVMSG';
          this.send(client, `@time=${item.time} :${item.senderNick}!user@shadow.local ${type} ${name} :${item.message}`);
        }
      }
    }
  }

  sendNamesReply(client, channel) {
    const nameList = [];
    for (const member of channel.members) {
      let prefix = '';
      if (channel.ops.has(member)) prefix = '@';
      else if (channel.voice.has(member)) prefix = '+';
      nameList.push(`${prefix}${member.nickname}`);
    }
    this.send(client, `:${this.serverName} 353 ${client.nickname} = ${channel.name} :${nameList.join(' ')}`);
    this.send(client, `:${this.serverName} 366 ${client.nickname} ${channel.name} :End of /NAMES list`);
  }

  handlePart(client, targetChannels, partMsg) {
    if (!this.requireAuth(client)) return;
    if (!targetChannels) return;

    const msg = partMsg || 'Leaving';
    const chanList = targetChannels.split(',');

    for (let name of chanList) {
      const chanLower = name.trim().toLowerCase();
      const channel = this.channels.get(chanLower);

      if (channel && channel.members.has(client)) {
        const partNotice = `:${client.nickname}!${client.username}@${client.hostname} PART ${channel.name} :${msg}`;
        this.broadcastChannel(channel, partNotice);

        channel.members.delete(client);
        channel.ops.delete(client);
        channel.voice.delete(client);
        client.channels.delete(chanLower);

        if (channel.members.size === 0) {
          this.channels.delete(chanLower);
        }
      } else {
        this.send(client, `:${this.serverName} 442 ${client.nickname} ${name} :You're not on that channel`);
      }
    }
  }

  handlePrivmsg(client, target, message, isNotice = false) {
    if (!this.requireAuth(client)) return;
    if (!target || !message) {
      if (!isNotice) this.send(client, `:${this.serverName} 411 ${client.nickname} :No recipient / text to send`);
      return;
    }

    // Handle CTCP requests (e.g. \x01VERSION\x01, \x01TIME\x01, \x01PING 123\x01)
    if (message.startsWith('\x01') && message.endsWith('\x01')) {
      const ctcpCmd = message.substring(1, message.length - 1).trim();
      if (ctcpCmd.startsWith('VERSION')) {
        this.send(client, `:${this.serverName} NOTICE ${client.nickname} :\x01VERSION ${this.version}\x01`);
        return;
      } else if (ctcpCmd.startsWith('TIME')) {
        this.send(client, `:${this.serverName} NOTICE ${client.nickname} :\x01TIME ${new Date().toUTCString()}\x01`);
        return;
      } else if (ctcpCmd.startsWith('PING')) {
        this.send(client, `:${this.serverName} NOTICE ${client.nickname} :\x01${ctcpCmd}\x01`);
        return;
      }
    }

    // Routing to Services
    if (['nickserv', 'chanserv', 'memoserv', 'hostserv'].includes(target.toLowerCase())) {
      this.services.routeServiceMsg(client, target, message, (msg) => this.send(client, msg), this);
      return;
    }

    const type = isNotice ? 'NOTICE' : 'PRIVMSG';
    const msgFormatted = `:${client.nickname}!${client.username}@${client.hostname} ${type} ${target} :${message}`;

    if (target.startsWith('#') || target.startsWith('&')) {
      const chanLower = target.toLowerCase();
      const channel = this.channels.get(chanLower);
      if (!channel) {
        if (!isNotice) this.send(client, `:${this.serverName} 404 ${client.nickname} ${target} :Cannot send to channel (Channel does not exist)`);
        return;
      }

      // Check Moderated Mode (+m)
      if (channel.modes.has('m') && !channel.ops.has(client) && !channel.voice.has(client) && !client.isOper) {
        if (!isNotice) this.send(client, `:${this.serverName} 404 ${client.nickname} ${target} :Cannot send to channel (+m moderated - Ops/Voice only)`);
        return;
      }

      if (channel.modes.has('n') && !channel.members.has(client)) {
        if (!isNotice) this.send(client, `:${this.serverName} 404 ${client.nickname} ${target} :Cannot send to channel (+n external messages blocked)`);
        return;
      }

      this.history.addMessage(target, client.nickname, message, isNotice);
      this.broadcastChannel(channel, msgFormatted, client);

      if (client.enabledCaps && client.enabledCaps.has('echo-message')) {
        this.send(client, msgFormatted);
      }
    } else {
      const targetClient = this.nicknames.get(target.toLowerCase());
      if (targetClient) {
        this.send(targetClient, msgFormatted);
      } else if (this.bouncer.isDetached(target)) {
        this.bouncer.bufferMessage(target, msgFormatted);
        this.send(client, `:${this.serverName} NOTICE ${client.nickname} :${target} is currently offline (Bouncer active - message buffered).`);
      } else {
        if (!isNotice) this.send(client, `:${this.serverName} 401 ${client.nickname} ${target} :No such nick/channel`);
      }
    }
  }

  handleInvite(client, targetNick, chanName) {
    if (!this.requireAuth(client)) return;
    if (!targetNick || !chanName) return;

    const chanLower = chanName.toLowerCase();
    const channel = this.channels.get(chanLower);
    if (!channel) return;

    if (!channel.ops.has(client) && !client.isOper) {
      this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator`);
      return;
    }

    const targetClient = this.nicknames.get(targetNick.toLowerCase());
    if (targetClient) {
      targetClient.invitedChannels.add(chanLower);
      this.send(targetClient, `:${client.nickname}!${client.username}@${client.hostname} INVITE ${targetClient.nickname} :${channel.name}`);
      this.send(client, `:${this.serverName} 341 ${client.nickname} ${targetClient.nickname} ${channel.name}`);
    }
  }

  handleWallops(client, message) {
    if (!client.isOper) {
      this.send(client, `:${this.serverName} 481 ${client.nickname} :Permission Denied - You're not an IRC operator`);
      return;
    }
    const wallMsg = `:${client.nickname}!${client.username}@${client.hostname} WALLOPS :${message}`;
    for (const c of this.clients.values()) {
      if (c.registered) {
        this.send(c, wallMsg);
      }
    }
  }

  handleTopic(client, targetChan, newTopic) {
    if (!this.requireAuth(client)) return;
    if (!targetChan) return;

    const chanLower = targetChan.toLowerCase();
    const channel = this.channels.get(chanLower);

    if (!channel) {
      this.send(client, `:${this.serverName} 403 ${client.nickname} ${targetChan} :No such channel`);
      return;
    }

    if (newTopic !== undefined) {
      if (channel.modes.has('t') && !channel.ops.has(client) && !client.isOper) {
        this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator (+t mode set)`);
        return;
      }
      channel.topic = newTopic;
      channel.topicSetBy = client.nickname;
      channel.topicSetAt = Math.floor(Date.now() / 1000);

      this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} TOPIC ${channel.name} :${newTopic}`);
    } else {
      this.send(client, `:${this.serverName} 332 ${client.nickname} ${channel.name} :${channel.topic}`);
      this.send(client, `:${this.serverName} 333 ${client.nickname} ${channel.name} ${channel.topicSetBy} ${channel.topicSetAt}`);
    }
  }

  handleMode(client, target, modeFlags, param) {
    if (!this.requireAuth(client)) return;
    if (!target) return;

    if (target.startsWith('#')) {
      const channel = this.channels.get(target.toLowerCase());
      if (!channel) {
        this.send(client, `:${this.serverName} 403 ${client.nickname} ${target} :No such channel`);
        return;
      }

      if (!modeFlags) {
        this.send(client, `:${this.serverName} 324 ${client.nickname} ${channel.name} +${Array.from(channel.modes).join('')}`);
        return;
      }

      if (modeFlags === 'b' && !param) {
        for (const banMask of channel.bans) {
          this.send(client, `:${this.serverName} 367 ${client.nickname} ${channel.name} ${banMask} ${client.nickname} ${Math.floor(Date.now() / 1000)}`);
        }
        this.send(client, `:${this.serverName} 368 ${client.nickname} ${channel.name} :End of Channel Ban List`);
        return;
      }

      if (!channel.ops.has(client) && !client.isOper) {
        this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator`);
        return;
      }

      let adding = true;
      for (let i = 0; i < modeFlags.length; i++) {
        const char = modeFlags[i];
        if (char === '+') adding = true;
        else if (char === '-') adding = false;
        else if (char === 'b' && param) {
          if (adding) channel.bans.add(param);
          else channel.bans.delete(param);
          this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} MODE ${channel.name} ${adding ? '+b' : '-b'} ${param}`);
        } else if (char === 'o' && param) {
          const targetNick = this.nicknames.get(param.toLowerCase());
          if (targetNick && channel.members.has(targetNick)) {
            if (adding) channel.ops.add(targetNick);
            else channel.ops.delete(targetNick);
            this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} MODE ${channel.name} ${adding ? '+o' : '-o'} ${targetNick.nickname}`);
            this.sendNamesReply(client, channel);
          }
        } else if (char === 'v' && param) {
          const targetNick = this.nicknames.get(param.toLowerCase());
          if (targetNick && channel.members.has(targetNick)) {
            if (adding) channel.voice.add(targetNick);
            else channel.voice.delete(targetNick);
            this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} MODE ${channel.name} ${adding ? '+v' : '-v'} ${targetNick.nickname}`);
            this.sendNamesReply(client, channel);
          }
        } else if (['n', 't', 'm', 'i'].includes(char)) {
          if (adding) channel.modes.add(char);
          else channel.modes.delete(char);
          this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} MODE ${channel.name} ${adding ? '+' : '-'}${char}`);
        }
      }
    }
  }

  handleWhois(client, targetNick) {
    if (!this.requireAuth(client)) return;
    if (!targetNick) return;

    const target = this.nicknames.get(targetNick.toLowerCase());
    if (target) {
      this.send(client, `:${this.serverName} 311 ${client.nickname} ${target.nickname} ${target.username} ${target.hostname} * :${target.realname}`);
      const chanNames = Array.from(target.channels).map(c => this.channels.get(c)?.name).filter(Boolean);
      this.send(client, `:${this.serverName} 319 ${client.nickname} ${target.nickname} :${chanNames.join(' ')}`);
      this.send(client, `:${this.serverName} 312 ${client.nickname} ${target.nickname} ${this.serverName} :Shadow Cosmic IRC Server`);
      if (target.isOper) {
        this.send(client, `:${this.serverName} 313 ${client.nickname} ${target.nickname} :is an IRC operator`);
      }
      this.send(client, `:${this.serverName} 318 ${client.nickname} ${target.nickname} :End of /WHOIS list`);
    } else {
      this.send(client, `:${this.serverName} 401 ${client.nickname} ${targetNick} :No such nick/channel`);
    }
  }

  handleNames(client, targetChan) {
    if (!this.requireAuth(client)) return;
    if (!targetChan) return;

    const channel = this.channels.get(targetChan.toLowerCase());
    if (channel) {
      this.sendNamesReply(client, channel);
    }
  }

  handleList(client) {
    if (!this.requireAuth(client)) return;

    this.send(client, `:${this.serverName} 321 ${client.nickname} Channel :Users Name`);
    for (const channel of this.channels.values()) {
      this.send(client, `:${this.serverName} 322 ${client.nickname} ${channel.name} ${channel.members.size} :${channel.topic}`);
    }
    this.send(client, `:${this.serverName} 323 ${client.nickname} :End of /LIST`);
  }

  handleOper(client, user, password) {
    if (user === this.operUser && password === this.operPass) {
      client.isOper = true;
      this.send(client, `:${this.serverName} 381 ${client.nickname} :You are now an IRC Operator! Cosmic authority granted.`);
    } else {
      this.send(client, `:${this.serverName} 464 ${client.nickname} :Password incorrect`);
    }
  }

  handleKick(client, targetChan, targetNick, reason) {
    if (!this.requireAuth(client)) return;
    if (!targetChan || !targetNick) return;

    const channel = this.channels.get(targetChan.toLowerCase());
    if (!channel) return;

    if (!channel.ops.has(client) && !client.isOper) {
      this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator`);
      return;
    }

    const victim = this.nicknames.get(targetNick.toLowerCase());
    if (victim && channel.members.has(victim)) {
      const kickReason = reason || 'Kicked by operator';
      const kickNotice = `:${client.nickname}!${client.username}@${client.hostname} KICK ${channel.name} ${victim.nickname} :${kickReason}`;
      this.broadcastChannel(channel, kickNotice);

      channel.members.delete(victim);
      channel.ops.delete(victim);
      channel.voice.delete(victim);
      victim.channels.delete(channel.name.toLowerCase());
    }
  }

  requireAuth(client) {
    if (!client.registered) {
      this.send(client, `:${this.serverName} 451 * :You have not registered`);
      return false;
    }
    return true;
  }

  broadcastChannel(channel, message, excludeClient = null) {
    for (const member of channel.members) {
      if (member !== excludeClient) {
        this.send(member, message);
      }
    }
  }

  send(client, message) {
    try {
      const timeTag = client.enabledCaps && client.enabledCaps.has('server-time') ? `@time=${new Date().toISOString()} ` : '';
      const finalMsg = message.startsWith('@') ? message : timeTag + message;

      if (client.type === 'TCP') {
        client.connection.write(finalMsg + '\r\n');
      } else if (client.type === 'WebSocket') {
        if (client.connection.readyState === 1) {
          client.connection.send(finalMsg + '\r\n');
        }
      }
    } catch (err) {
      // Handle send error
    }
  }

  handleHttpRequest(req, res) {
    try {
      const desktopHtmlPath = path.join(__dirname, '../../src-desktop/index.html');
      if (fs.existsSync(desktopHtmlPath)) {
        const html = fs.readFileSync(desktopHtmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
    } catch (err) {
      console.error('[HTTP ERROR]', err.message);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('SHADOW-IRCD Web Gateway: Index File Not Found');
  }
}

// Auto-instantiate if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 6667;
  const webPort = process.env.WEB_PORT || 8888;
  const server = new ShadowIRCServer({ port, webPort });
  server.start();
}

export default ShadowIRCServer;
