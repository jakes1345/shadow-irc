import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

/**
 * SHADOW-IRCD: Pure Native RFC 1459/2812/IRCv3 TCP IRC Server Daemon
 * Security Hardened | Flood Protection | E2EE Passthrough | Operator Controls
 */

class ShadowIRCServer {
  constructor(options = {}) {
    this.port = options.port || 6667;
    this.host = options.host || '0.0.0.0';
    this.serverName = options.serverName || 'shadow.cosmos.net';
    this.version = 'shadow-ircd-1.0.0';
    this.createdDate = new Date().toISOString();
    
    // Server State
    this.clients = new Map(); // socket -> ClientState
    this.nicknames = new Map(); // nickname (lowercase) -> ClientState
    this.channels = new Map(); // channelName (lowercase) -> ChannelState
    
    // Operator Credentials
    this.operUser = options.operUser || 'admin';
    this.operPass = options.operPass || 'cosmicsecret';
    
    // Rate Limiting & Flood Control
    this.maxMessageRate = 10; // max msgs per 2 seconds
    
    this.motd = [
      "==========================================================================",
      "   ______  ______  ___  ______  ______ _ _  _ ___________ _____ ",
      "  /  ___/ / / / / / _ \\ /  _  \\ /  __  / / / / / /  __/  __/  __/",
      "  \\___ \\ / /_/ / / /_\\ \\/  //  / / /_/ / /_/ / / /  _/  _/  / /_ ",
      " /____/ /_____/ /_/   \\_\\_____/ /_____/\\____/_/_/  /___/  \\____/ ",
      "==========================================================================",
      "          WELCOME TO SHADOW-IRC - DEEP SPACE COSMIC NETWORK               ",
      "             Security-Hardened | E2EE Ready | Native IRCd                 ",
      "=========================================================================="
    ];
  }

  start() {
    this.server = net.createServer((socket) => this.handleConnection(socket));

    this.server.on('error', (err) => {
      console.error(`[SHADOW-IRCD ERROR] ${err.message}`);
    });

    this.server.listen(this.port, this.host, () => {
      console.log(`\x1b[36m[SHADOW-IRCD]\x1b[0m Server active on \x1b[35m${this.host}:${this.port}\x1b[0m`);
      console.log(`\x1b[36m[SHADOW-IRCD]\x1b[0m Server Name: \x1b[32m${this.serverName}\x1b[0m`);
    });
  }

  handleConnection(socket) {
    const clientId = crypto.randomUUID();
    const client = {
      id: clientId,
      socket,
      ip: socket.remoteAddress,
      nickname: null,
      username: null,
      realname: null,
      hostname: socket.remoteAddress || 'shadow.local',
      registered: false,
      channels: new Set(), // Set of channel lowercase names
      isOper: false,
      msgCount: 0,
      lastMsgReset: Date.now(),
      buffer: ''
    };

    this.clients.set(socket, client);
    console.log(`[CONNECT] New peer from ${client.ip}`);

    socket.on('data', (chunk) => {
      // Check flood rate limit
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

      client.buffer += chunk.toString('utf8');
      
      // Prevent buffer memory exhaustion attack
      if (client.buffer.length > 65536) {
        socket.destroy();
        return;
      }

      let lines = client.buffer.split(/\r?\n/);
      client.buffer = lines.pop(); // Keep uncompleted line

      for (let line of lines) {
        line = line.trim();
        if (line.length > 0) {
          // Truncate to RFC 512 byte limit to prevent injection
          if (line.length > 512) line = line.substring(0, 512);
          this.parseAndExecute(client, line);
        }
      }
    });

    socket.on('close', () => {
      this.handleDisconnect(client, 'Client Quit');
    });

    socket.on('error', (err) => {
      this.handleDisconnect(client, err.message);
    });
  }

  handleDisconnect(client, reason) {
    if (!this.clients.has(client.socket)) return;
    
    console.log(`[DISCONNECT] ${client.nickname || client.ip} (${reason})`);
    
    // Leave all channels
    for (const channelName of client.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        channel.members.delete(client);
        channel.ops.delete(client);
        channel.voice.delete(client);
        
        // Notify remaining channel members
        this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} QUIT :${reason}`);
        
        if (channel.members.size === 0) {
          this.channels.delete(channelName);
        }
      }
    }
    
    if (client.nickname) {
      this.nicknames.delete(client.nickname.toLowerCase());
    }
    this.clients.delete(client.socket);
  }

  parseAndExecute(client, rawLine) {
    // Linear parsing safe from ReDoS
    let prefix = '';
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
      prefix = parts.shift().substring(1);
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
        // Heartbeat ACK
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
        client.socket.end();
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

    // Validate nickname syntax
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
      // Notify all users in shared channels
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
      
      // Welcome RPL_WELCOME (001)
      this.send(client, `:${this.serverName} 001 ${client.nickname} :Welcome to the Shadow IRC Cosmic Network ${client.nickname}!${client.username}@${client.hostname}`);
      this.send(client, `:${this.serverName} 002 ${client.nickname} :Your host is ${this.serverName}, running version ${this.version}`);
      this.send(client, `:${this.serverName} 003 ${client.nickname} :This server was created ${this.createdDate}`);
      this.send(client, `:${this.serverName} 004 ${client.nickname} ${this.serverName} ${this.version} o v m i k t n s`);

      // MOTD RPL_MOTDSTART (375) / RPL_MOTD (372) / RPL_ENDOFMOTD (376)
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
          modes: new Set(['n', 't']), // default modes
          members: new Set(),
          ops: new Set(),
          voice: new Set(),
        };
        this.channels.get = this.channels.get.bind(this.channels);
        this.channels.set(chanLower, channel);
      }

      // Check key mode
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

      // RPL_TOPIC (332)
      this.send(client, `:${this.serverName} 332 ${client.nickname} ${name} :${channel.topic}`);
      
      // RPL_NAMREPLY (353)
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
      // Channel message
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
      // Direct Message to Nickname
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
      // Set Topic
      if (channel.modes.has('t') && !channel.ops.has(client) && !client.isOper) {
        this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator (+t mode set)`);
        return;
      }
      channel.topic = newTopic;
      channel.topicSetBy = client.nickname;
      channel.topicSetAt = Math.floor(Date.now() / 1000);

      this.broadcastChannel(channel, `:${client.nickname}!${client.username}@${client.hostname} TOPIC ${channel.name} :${newTopic}`);
    } else {
      // View Topic
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
        // Query channel modes
        this.send(client, `:${this.serverName} 324 ${client.nickname} ${channel.name} +${Array.from(channel.modes).join('')}`);
        return;
      }

      if (!channel.ops.has(client) && !client.isOper) {
        this.send(client, `:${this.serverName} 482 ${client.nickname} ${channel.name} :You're not channel operator`);
        return;
      }

      // Apply mode changes (e.g. +o nick, -o nick, +v nick, -v nick)
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
      client.socket.write(message + '\r\n');
    } catch (err) {
      // Socket error handling
    }
  }
}

// Auto-instantiate if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 6667;
  const server = new ShadowIRCServer({ port });
  server.start();
}

export default ShadowIRCServer;
