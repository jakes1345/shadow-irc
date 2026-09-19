import net from 'net';
import http from 'http';
import tls from 'tls';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';

/**
 * SHADOW-IRCD: Dual-Engine Native TCP + WebSocket IRC Server Daemon
 * Supports:
 *  1. Native TCP Sockets (port 6667) for Terminal CLI, HexChat, Irssi, Textual, mIRC
 *  2. WebSockets & Embedded Cosmic Web Client (port 8080) for Windows / macOS / Mobile web browsers
 */

class ShadowIRCServer {
  constructor(options = {}) {
    this.port = options.port || 6667;
    this.webPort = options.webPort || 8080;
    this.host = options.host || '0.0.0.0';
    this.serverName = options.serverName || 'shadow.cosmos.net';
    this.version = 'shadow-ircd-2.0.0-hybrid';
    this.createdDate = new Date().toISOString();
    
    // Server State
    this.clients = new Map(); // socket/ws -> ClientState
    this.nicknames = new Map(); // nickname (lowercase) -> ClientState
    this.channels = new Map(); // channelName (lowercase) -> ChannelState
    
    // Operator Credentials
    this.operUser = options.operUser || 'admin';
    this.operPass = options.operPass || 'cosmicsecret';
    
    // Rate Limiting & Flood Control
    this.maxMessageRate = 10;
    
    this.motd = [
      "==========================================================================",
      "   ______  ______  ___  ______  ______ _ _  _ ___________ _____ ",
      "  /  ___/ / / / / / _ \\ /  _  \\ /  __  / / / / / /  __/  __/  __/",
      "  \\___ \\ / /_/ / / /_\\ \\/  //  / / /_/ / /_/ / / /  _/  _/  / /_ ",
      " /____/ /_____/ /_/   \\_\\_____/ /_____/\\____/_/_/  /___/  \\____/ ",
      "==========================================================================",
      "          WELCOME TO SHADOW-IRC - DEEP SPACE COSMIC NETWORK               ",
      "    Cross-Platform | Native TCP (6667) & WebSockets (8080) | E2EE Ready    ",
      "=========================================================================="
    ];
  }

  start() {
    // 1. Native TCP Socket Server (Port 6667)
    this.tcpServer = net.createServer((socket) => this.handleTcpConnection(socket));
    this.tcpServer.on('error', (err) => console.error(`[TCP ERROR] ${err.message}`));
    this.tcpServer.listen(this.port, this.host, () => {
      console.log(`\x1b[36m[SHADOW-IRCD]\x1b[0m Native TCP Engine on \x1b[35m${this.host}:${this.port}\x1b[0m (Terminal & Desktop Apps)`);
    });

    // 2. HTTP Server + WebSocket Server (Port 8080) for Windows / Mac Web Browsers
    this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    
    this.wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    this.httpServer.listen(this.webPort, this.host, () => {
      console.log(`\x1b[36m[SHADOW-IRCD]\x1b[0m Web Gateway & Embedded Client on \x1b[32mhttp://${this.host}:${this.webPort}\x1b[0m (Windows/macOS/Browser)`);
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
    const client = {
      id: clientId,
      connection, // net.Socket or WebSocket
      type, // 'TCP' or 'WebSocket'
      ip,
      nickname: null,
      username: null,
      realname: null,
      hostname: ip || 'shadow.local',
      registered: false,
      channels: new Set(),
      isOper: false,
      msgCount: 0,
      lastMsgReset: Date.now(),
      buffer: ''
    };

    this.clients.set(connection, client);
    console.log(`[CONNECT] New ${type} peer from ${ip}`);
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
      case 'KICK':
        this.handleKick(client, args[0], args[1], args[2]);
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
      this.send(client, `:${this.serverName} 004 ${client.nickname} ${this.serverName} ${this.version} o v m i k t n s`);

      this.send(client, `:${this.serverName} 375 ${client.nickname} :- ${this.serverName} Message of the day - `);
      for (const line of this.motd) {
        this.send(client, `:${this.serverName} 372 ${client.nickname} :- ${line}`);
      }
      this.send(client, `:${this.serverName} 376 ${client.nickname} :End of MOTD command`);
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
          members: new Set(),
          ops: new Set(),
          voice: new Set(),
        };
        this.channels.set(chanLower, channel);
      }

      if (channel.modes.has('k') && channel.key && channel.key !== key && !isFirst) {
        this.send(client, `:${this.serverName} 475 ${client.nickname} ${name} :Cannot join channel (+k) - bad key`);
        continue;
      }

      channel.members.add(client);
      client.channels.add(chanLower);

      if (isFirst || client.isOper) {
        channel.ops.add(client);
      }

      const joinMsg = `:${client.nickname}!${client.username}@${client.hostname} JOIN :${name}`;
      this.broadcastChannel(channel, joinMsg);

      this.send(client, `:${this.serverName} 332 ${client.nickname} ${name} :${channel.topic}`);
      this.sendNamesReply(client, channel);
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

    const type = isNotice ? 'NOTICE' : 'PRIVMSG';
    const msgFormatted = `:${client.nickname}!${client.username}@${client.hostname} ${type} ${target} :${message}`;

    if (target.startsWith('#') || target.startsWith('&')) {
      const chanLower = target.toLowerCase();
      const channel = this.channels.get(chanLower);
      if (!channel) {
        if (!isNotice) this.send(client, `:${this.serverName} 404 ${client.nickname} ${target} :Cannot send to channel (Channel does not exist)`);
        return;
      }
      if (channel.modes.has('n') && !channel.members.has(client)) {
        if (!isNotice) this.send(client, `:${this.serverName} 404 ${client.nickname} ${target} :Cannot send to channel (+n external messages blocked)`);
        return;
      }

      this.broadcastChannel(channel, msgFormatted, client);
    } else {
      const targetClient = this.nicknames.get(target.toLowerCase());
      if (targetClient) {
        this.send(targetClient, msgFormatted);
      } else {
        if (!isNotice) this.send(client, `:${this.serverName} 401 ${client.nickname} ${target} :No such nick/channel`);
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

      if (!channel.ops.has(client) && !client.isOper) {
        this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator`);
        return;
      }

      let adding = true;
      for (let i = 0; i < modeFlags.length; i++) {
        const char = modeFlags[i];
        if (char === '+') adding = true;
        else if (char === '-') adding = false;
        else if (char === 'o' && param) {
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
      if (client.type === 'TCP') {
        client.connection.write(message + '\r\n');
      } else if (client.type === 'WebSocket') {
        if (client.connection.readyState === 1) { // OPEN
          client.connection.send(message + '\r\n');
        }
      }
    } catch (err) {
      // Handle socket error
    }
  }

  handleHttpRequest(req, res) {
    // Serve zero-dependency Web Client for Windows / macOS browsers
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🌌 SHADOW // IRC [Cosmic Cyber Network]</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Courier New', monospace; }
    body { background: #030308; color: #00f3ff; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    canvas { position: absolute; top:0; left:0; width:100%; height:100%; z-index: -1; }
    header { background: rgba(7,7,18,0.85); padding: 12px; border-bottom: 1px solid #8a2be2; display: flex; justify-content: space-between; align-items: center; }
    h1 { font-size: 18px; color: #ff007f; text-shadow: 0 0 10px #ff007f; }
    #main { display: flex; flex: 1; height: calc(100vh - 100px); }
    #chat { flex: 1; background: rgba(3,3,8,0.7); padding: 15px; overflow-y: auto; border-right: 1px solid #1d1d3d; }
    #users { width: 200px; background: rgba(7,7,18,0.85); padding: 15px; border-left: 1px solid #8a2be2; }
    .msg { margin-bottom: 8px; line-height: 1.4; word-break: break-word; }
    .time { color: #64748b; font-size: 12px; }
    .nick { color: #00f3ff; font-weight: bold; }
    .system { color: #ffaa00; }
    .op { color: #ff007f; }
    #input-bar { background: rgba(7,7,18,0.9); padding: 12px; border-top: 1px solid #00f3ff; display: flex; }
    input { flex: 1; background: #070712; border: 1px solid #8a2be2; color: #00ff41; padding: 10px; outline: none; font-size: 14px; }
    button { background: #8a2be2; color: #fff; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; }
    button:hover { background: #ff007f; }
  </style>
</head>
<body>
  <canvas id="space"></canvas>
  <header>
    <h1>🌌 SHADOW // IRC [Cosmic Web Client]</h1>
    <span id="status">Status: Connecting...</span>
  </header>
  <div id="main">
    <div id="chat"></div>
    <div id="users">
      <h3 style="color:#ff007f; margin-bottom:10px;">USERS</h3>
      <ul id="user-list" style="list-style:none;"></ul>
    </div>
  </div>
  <div id="input-bar">
    <input type="text" id="prompt" placeholder="Type /join #cosmos or message..." autofocus />
    <button onclick="sendMsg()">SEND</button>
  </div>

  <script>
    // Canvas Space Particle Animation
    const canvas = document.getElementById('space');
    const ctx = canvas.getContext('2d');
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.onresize = resize; resize();
    const stars = Array.from({length: 150}, () => ({
      x: Math.random()*canvas.width, y: Math.random()*canvas.height, r: Math.random()*2, color: ['#00f3ff','#ff007f','#8a2be2','#00ff66'][Math.floor(Math.random()*4)]
    }));
    function drawStars() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      stars.forEach(s => {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = s.color; ctx.shadowBlur = 8; ctx.shadowColor = s.color; ctx.fill();
        s.y += 0.2; if (s.y > canvas.height) s.y = 0;
      });
      requestAnimationFrame(drawStars);
    }
    drawStars();

    // WebSocket IRC Engine
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + location.host);
    const chat = document.getElementById('chat');
    const status = document.getElementById('status');
    const userList = document.getElementById('user-list');
    const prompt = document.getElementById('prompt');
    let myNick = 'web_user_' + Math.floor(Math.random()*8999+1000);

    ws.onopen = () => {
      status.innerText = 'Connected as ' + myNick;
      ws.send('NICK ' + myNick + '\\r\\n');
      ws.send('USER ' + myNick + ' 0 * :Shadow Web User\\r\\n');
      ws.send('JOIN #cosmos\\r\\n');
    };

    ws.onmessage = (e) => {
      const line = e.data.trim();
      const div = document.createElement('div');
      div.className = 'msg';
      const time = new Date().toLocaleTimeString();
      div.innerHTML = '<span class="time">[' + time + ']</span> ' + escapeHtml(line);
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;

      if (line.includes(' 353 ')) {
        const parts = line.split(' :');
        if (parts[1]) {
          userList.innerHTML = parts[1].split(' ').map(u => '<li class="' + (u.startsWith('@')?'op':'nick') + '">' + escapeHtml(u) + '</li>').join('');
        }
      }
    };

    function sendMsg() {
      const text = prompt.value.trim();
      if (!text) return;
      prompt.value = '';
      if (text.startsWith('/')) {
        ws.send(text.substring(1) + '\\r\\n');
      } else {
        ws.send('PRIVMSG #cosmos :' + text + '\\r\\n');
        const div = document.createElement('div');
        div.className = 'msg';
        div.innerHTML = '<span class="time">[' + new Date().toLocaleTimeString() + ']</span> <span class="op">&lt;' + myNick + '&gt;</span> ' + escapeHtml(text);
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
      }
    }

    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
    function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
}

// Auto-instantiate if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 6667;
  const webPort = process.env.WEB_PORT || 8080;
  const server = new ShadowIRCServer({ port, webPort });
  server.start();
}

export default ShadowIRCServer;
