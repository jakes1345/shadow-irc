import net from 'net';
import { ShadowCrypto } from '../common/crypto.js';

/**
 * COSMIC AI BOT for SHADOW-IRC
 * Responds to chat, tests E2EE, provides system info, and acts as live assistant
 */

class CosmicBot {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 6667;
    this.nick = options.nick || 'CosmicAI';
    this.channel = options.channel || '#cosmos';
    this.socket = null;
    this.e2eKey = null;
  }

  start() {
    console.log(`[CosmicBot] Connecting to SHADOW-IRC at ${this.host}:${this.port}...`);
    this.socket = net.connect(this.port, this.host, () => {
      console.log(`[CosmicBot] Connected! Registering as ${this.nick}...`);
      this.send(`NICK ${this.nick}`);
      this.send(`USER cosmicbot 0 * :SHADOW Cosmic AI Bot`);
      this.send(`JOIN ${this.channel}`);
    });

    let buffer = '';
    this.socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (let line of lines) {
        if (line.trim().length > 0) {
          this.handleLine(line.trim());
        }
      }
    });

    this.socket.on('error', (err) => {
      console.error(`[CosmicBot Error] ${err.message}`);
    });
  }

  send(line) {
    if (this.socket) {
      this.socket.write(line + '\r\n');
    }
  }

  say(msg) {
    let text = msg;
    if (this.e2eKey) {
      text = ShadowCrypto.encrypt(msg, this.e2eKey);
    }
    this.send(`PRIVMSG ${this.channel} :${text}`);
  }

  handleLine(line) {
    // Strip IRCv3 message tags (@key=val;... prefix)
    if (line.startsWith('@')) {
      const tagEnd = line.indexOf(' ');
      if (tagEnd !== -1) line = line.substring(tagEnd + 1).trimStart();
    }

    if (line.startsWith('PING ')) {
      this.send(`PONG ${line.substring(5)}`);
      return;
    }

    let trailing = '';
    let msgLine = line;
    const trailingIdx = msgLine.indexOf(' :');
    if (trailingIdx !== -1) {
      trailing = msgLine.substring(trailingIdx + 2);
      msgLine = msgLine.substring(0, trailingIdx);
    }

    const parts = msgLine.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;

    let prefix = '';
    if (parts[0].startsWith(':')) {
      prefix = parts.shift().substring(1);
    }

    const command = parts.shift().toUpperCase();
    const senderNick = prefix.split('!')[0];

    if (command === 'PRIVMSG') {
      const target = parts[0];
      let body = trailing;

      if (senderNick === this.nick) return;

      // Handle E2EE
      if (ShadowCrypto.isEncrypted(body)) {
        if (this.e2eKey) {
          const dec = ShadowCrypto.decrypt(body, this.e2eKey);
          if (dec) body = dec;
        }
      }

      const lower = body.toLowerCase();
      if (lower.startsWith('!help') || lower.includes('hello') || lower.includes('hi')) {
        this.say(`🚀 Hello ${senderNick}! Commands: !info, !status, !e2e <pass>, !features`);
      } else if (lower.startsWith('!info')) {
        this.say(`⚡ SHADOW-IRC: RFC 1459/2812/IRCv3 Dual-Engine TCP (6667) & Tauri WS Bridge (8888). 100% Free MIT Software!`);
      } else if (lower.startsWith('!status')) {
        this.say(`🟢 Network Status: Optimal | Services: Active | Bouncer: 24/7 | Uptime: Live`);
      } else if (lower.startsWith('!e2e')) {
        const key = body.split(/\s+/)[1];
        if (key) {
          this.e2eKey = key;
          this.say(`🔒 E2EE enabled for CosmicAI.`);
        } else {
          this.e2eKey = null;
          this.say(`🔓 E2EE Disabled for CosmicAI.`);
        }
      } else if (lower.startsWith('!features')) {
        this.say(`✨ Features: Tauri v2 Desktop App, 24-bit ANSI TUI, IRC Services (NickServ/ChanServ), IRCv3 History, Anti-Forensic Purge (/nuke)!`);
      }
    }
  }
}

// Start bot if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = new CosmicBot({});
  bot.start();
}

export default CosmicBot;
