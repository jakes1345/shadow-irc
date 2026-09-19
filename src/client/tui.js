import blessed from 'neo-blessed';
import net from 'net';
import readline from 'readline';
import { ShadowCrypto } from '../common/crypto.js';

/**
 * SHADOW-IRC: Native Cosmic Cyber Terminal TUI Client
 * 24-bit TrueColor ANSI Space Renderer | E2EE | Tabbed Channels | Hacker CLI
 */

class ShadowIRCClient {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 6667;
    this.nickname = options.nickname || `shadow_${Math.floor(Math.random() * 8999 + 1000)}`;
    this.username = options.username || 'shadow_user';
    this.realname = options.realname || 'Shadow Cosmic User';

    // State
    this.socket = null;
    this.connected = false;
    this.currentWindow = 'status'; // 'status', '#cosmos', '#shadow', etc.
    this.windows = new Map(); // windowName -> { title, messages: [], unread: 0, users: Set() }
    this.channelKeys = new Map(); // channelName -> passphrase for E2EE
    this.inputHistory = [];
    this.historyIdx = -1;
    this.warpSpeed = false;
    this.matrixMode = false;

    // Initialize default status window
    this.addWindow('status', 'SHADOW // Status Log');
    
    // UI Screen & Widgets initialization
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'SHADOW // IRC [Cosmic Cyber Network]',
      fullUnicode: true,
      cursor: {
        synthetic: true,
        blink: true,
        color: '#00f3ff'
      }
    });

    // Cosmic Header Bar (Banner & Particle Animation)
    this.headerBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: {
        fg: '#00f3ff',
        bg: '#070712',
        border: { fg: '#8a2be2' }
      },
      border: { type: 'line' },
      content: ' {bold}{#ff007f-fg}🌌 SHADOW // IRC{/#ff007f-fg}{/bold} | {cyan-fg}COSMIC CYBER PROTOCOL{/cyan-fg} | {bold}{#00ff66-fg}E2EE SECURED{/#00ff66-fg}{/bold} | Host: {#b026ff-fg}' + this.host + ':' + this.port + '{/#b026ff-fg}'
    });

    // Window Tabs Bar
    this.tabBar = blessed.box({
      top: 3,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: '#ffffff',
        bg: '#0d0d1f'
      },
      content: ''
    });

    // Main Chat Log Area
    this.chatLog = blessed.log({
      top: 4,
      left: 0,
      width: '80%',
      height: 'shrink',
      bottom: 3,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '█',
        style: { fg: '#00f3ff' }
      },
      style: {
        fg: '#e2e8f0',
        bg: '#030308',
        border: { fg: '#1d1d3d' }
      },
      border: { type: 'line' }
    });

    // User List Sidebar
    this.userList = blessed.list({
      top: 4,
      right: 0,
      width: '20%',
      height: 'shrink',
      bottom: 3,
      tags: true,
      label: ' {bold}{#00f3ff-fg}USERS{/#00f3ff-fg}{/bold} ',
      style: {
        fg: '#00f3ff',
        bg: '#070712',
        border: { fg: '#8a2be2' },
        selected: { bg: '#8a2be2', fg: '#ffffff' }
      },
      border: { type: 'line' },
      items: []
    });

    // Status / Topic Line
    this.topicBar = blessed.box({
      bottom: 2,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: '#ffaa00',
        bg: '#14142b'
      },
      content: ' Topic: Connect to network to view topic...'
    });

    // Input Prompt Bar
    this.inputBar = blessed.textbox({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      inputOnFocus: true,
      tags: true,
      label: ' {bold}{#ff007f-fg}COMMAND / PROMPT{/#ff007f-fg}{/bold} ',
      style: {
        fg: '#00ff41',
        bg: '#070712',
        border: { fg: '#00f3ff' }
      },
      border: { type: 'line' }
    });

    // Append to screen
    this.screen.append(this.headerBox);
    this.screen.append(this.tabBar);
    this.screen.append(this.chatLog);
    this.screen.append(this.userList);
    this.screen.append(this.topicBar);
    this.screen.append(this.inputBar);

    // Event Bindings
    this.setupEvents();
    this.startCosmicAnimation();
    this.renderTabs();
    this.inputBar.focus();
    this.screen.render();
  }

  setupEvents() {
    // Input submission
    this.inputBar.on('submit', (value) => {
      const text = value.trim();
      this.inputBar.clearValue();
      this.inputBar.focus();

      if (text.length > 0) {
        this.inputHistory.push(text);
        this.historyIdx = this.inputHistory.length;
        this.handleUserSubmit(text);
      }
      this.screen.render();
    });

    // Global Key Bindings
    this.screen.key(['C-c', 'C-d'], () => {
      this.disconnect('Client Exit');
      process.exit(0);
    });

    // Tab switching keybindings (Alt+1 through Alt+9)
    for (let i = 1; i <= 9; i++) {
      this.screen.key([`M-${i}`], () => {
        const winKeys = Array.from(this.windows.keys());
        if (winKeys[i - 1]) {
          this.switchWindow(winKeys[i - 1]);
        }
      });
    }

    // Scroll keys (PageUp / PageDown)
    this.screen.key(['pageup'], () => {
      this.chatLog.scroll(-5);
      this.screen.render();
    });

    this.screen.key(['pagedown'], () => {
      this.chatLog.scroll(5);
      this.screen.render();
    });

    // Command History Navigation (Up / Down)
    this.inputBar.key(['up'], () => {
      if (this.inputHistory.length > 0 && this.historyIdx > 0) {
        this.historyIdx--;
        this.inputBar.setValue(this.inputHistory[this.historyIdx]);
        this.screen.render();
      }
    });

    this.inputBar.key(['down'], () => {
      if (this.historyIdx < this.inputHistory.length - 1) {
        this.historyIdx++;
        this.inputBar.setValue(this.inputHistory[this.historyIdx]);
      } else {
        this.historyIdx = this.inputHistory.length;
        this.inputBar.clearValue();
      }
      this.screen.render();
    });

    // Tab Auto-Completion
    this.inputBar.key(['tab'], () => {
      const currentVal = this.inputBar.getValue();
      const parts = currentVal.split(' ');
      const lastPart = parts.pop().toLowerCase();

      if (lastPart.length > 0) {
        // Match users in current window
        const win = this.windows.get(this.currentWindow);
        if (win && win.users) {
          for (const user of win.users) {
            const cleanUser = user.replace(/^[@+]/, '');
            if (cleanUser.toLowerCase().startsWith(lastPart)) {
              parts.push(cleanUser + ':');
              this.inputBar.setValue(parts.join(' ') + ' ');
              this.screen.render();
              break;
            }
          }
        }
      }
    });
  }

  addWindow(name, title) {
    if (!this.windows.has(name)) {
      this.windows.set(name, {
        name,
        title: title || name,
        messages: [],
        unread: 0,
        users: new Set(),
        topic: ''
      });
      this.renderTabs();
    }
  }

  switchWindow(name) {
    if (this.windows.has(name)) {
      this.currentWindow = name;
      const win = this.windows.get(name);
      win.unread = 0;

      // Refresh chat log with current window's messages
      this.chatLog.setContent('');
      for (const msg of win.messages) {
        this.chatLog.add(msg);
      }
      
      // Update User List Sidebar
      this.updateUserListUI(win);
      
      // Update Topic Bar
      this.topicBar.setContent(` Topic: ${win.topic || 'No topic set.'}`);

      this.renderTabs();
      this.screen.render();
    }
  }

  updateUserListUI(win) {
    if (win && win.users && win.name.startsWith('#')) {
      const sortedUsers = Array.from(win.users).sort((a, b) => {
        if (a.startsWith('@') && !b.startsWith('@')) return -1;
        if (b.startsWith('@') && !a.startsWith('@')) return 1;
        if (a.startsWith('+') && !b.startsWith('+')) return -1;
        if (b.startsWith('+') && !a.startsWith('+')) return 1;
        return a.localeCompare(b);
      });
      
      const formattedItems = sortedUsers.map(u => {
        if (u.startsWith('@')) return `{bold}{#ff007f-fg}@${u.substring(1)}{/#ff007f-fg}{/bold}`;
        if (u.startsWith('+')) return `{#00f3ff-fg}+${u.substring(1)}{/#00f3ff-fg}`;
        return `{#e2e8f0-fg}${u}{/#e2e8f0-fg}`;
      });
      
      this.userList.setItems(formattedItems);
    } else {
      this.userList.setItems(['(Status Mode)']);
    }
  }

  renderTabs() {
    let tabStr = ' ';
    let idx = 1;
    for (const [name, win] of this.windows.entries()) {
      const isSelected = name === this.currentWindow;
      const unreadBadge = win.unread > 0 ? ` {#ff007f-fg}(${win.unread}){/#ff007f-fg}` : '';
      
      if (isSelected) {
        tabStr += `{#070712-bg}{#00f3ff-fg}{bold} [${idx}:${name}${unreadBadge}] {/bold}{/#00f3ff-fg}{/#070712-bg} `;
      } else {
        tabStr += `{#1d1d3d-bg}{#94a3b8-fg} ${idx}:${name}${unreadBadge} {/#94a3b8-fg}{/#1d1d3d-bg} `;
      }
      idx++;
    }
    this.tabBar.setContent(tabStr);
    this.screen.render();
  }

  logMessage(targetWindow, formattedMessage, countUnread = true) {
    this.addWindow(targetWindow);
    const win = this.windows.get(targetWindow);
    win.messages.push(formattedMessage);

    if (this.currentWindow === targetWindow) {
      this.chatLog.add(formattedMessage);
      this.chatLog.scroll(1);
    } else if (countUnread) {
      win.unread++;
      this.renderTabs();
    }
    this.screen.render();
  }

  connect() {
    this.logMessage('status', `{bold}{#00f3ff-fg}[SYSTEM]{/#00f3ff-fg}{/bold} Connecting to native IRC server at {#b026ff-fg}${this.host}:${this.port}{/#b026ff-fg}...`);
    
    this.socket = net.connect(this.port, this.host, () => {
      this.connected = true;
      this.logMessage('status', `{bold}{#00ff66-fg}[SUCCESS]{/#00ff66-fg}{/bold} Socket established! Sending IRC Registration...`);
      
      // IRC Registration Sequence
      this.sendRaw(`NICK ${this.nickname}`);
      this.sendRaw(`USER ${this.username} 0 * :${this.realname}`);
    });

    let buffer = '';
    this.socket.on('data', (data) => {
      buffer += data.toString('utf8');
      let lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim().length > 0) {
          this.handleIncomingIRC(line.trim());
        }
      }
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.logMessage('status', `{bold}{#ff0055-fg}[DISCONNECT]{/#ff0055-fg}{/bold} Connection closed.`);
    });

    this.socket.on('error', (err) => {
      this.logMessage('status', `{bold}{#ff0055-fg}[ERROR]{/#ff0055-fg}{/bold} Socket error: ${err.message}`);
    });
  }

  sendRaw(line) {
    if (this.socket && this.connected) {
      this.socket.write(line + '\r\n');
    }
  }

  handleUserSubmit(text) {
    if (text.startsWith('/')) {
      this.handleCommand(text);
    } else {
      // Send regular message to current active window
      if (this.currentWindow === 'status') {
        this.logMessage('status', `{#ff5555-fg}Cannot send chat in status window. Use /join #channel first.{/#ff5555-fg}`);
        return;
      }

      let payload = text;
      let e2eTag = '';
      
      // Check E2EE encryption passphrase for channel
      const key = this.channelKeys.get(this.currentWindow.toLowerCase());
      if (key) {
        payload = ShadowCrypto.encrypt(text, key);
        e2eTag = ' {bold}{#00ff66-fg}[E2EE🔒]{/#00ff66-fg}{/bold}';
      }

      this.sendRaw(`PRIVMSG ${this.currentWindow} :${payload}`);
      
      const time = new Date().toLocaleTimeString();
      this.logMessage(this.currentWindow, `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#ff007f-fg}<${this.nickname}>${e2eTag}{/#ff007f-fg}{/bold} ${text}`, false);
    }
  }

  handleCommand(cmdLine) {
    const parts = cmdLine.substring(1).split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const args = parts;

    switch (cmd) {
      case 'connect':
      case 'server':
        this.host = args[0] || 'localhost';
        this.port = parseInt(args[1] || '6667', 10);
        this.connect();
        break;
      case 'join':
        if (args[0]) {
          const chan = args[0].startsWith('#') ? args[0] : '#' + args[0];
          this.addWindow(chan);
          this.switchWindow(chan);
          this.sendRaw(`JOIN ${chan} ${args[1] || ''}`);
        }
        break;
      case 'part':
        const pChan = args[0] || this.currentWindow;
        if (pChan.startsWith('#')) {
          this.sendRaw(`PART ${pChan} :${args.slice(1).join(' ') || 'Leaving'}`);
          this.windows.delete(pChan);
          this.switchWindow('status');
        }
        break;
      case 'nick':
        if (args[0]) {
          this.sendRaw(`NICK ${args[0]}`);
          this.nickname = args[0];
        }
        break;
      case 'topic':
        if (this.currentWindow.startsWith('#')) {
          if (args.length > 0) {
            this.sendRaw(`TOPIC ${this.currentWindow} :${args.join(' ')}`);
          } else {
            this.sendRaw(`TOPIC ${this.currentWindow}`);
          }
        }
        break;
      case 'msg':
      case 'query':
        if (args[0] && args.length > 1) {
          const target = args[0];
          const msg = args.slice(1).join(' ');
          this.addWindow(target);
          this.sendRaw(`PRIVMSG ${target} :${msg}`);
          const time = new Date().toLocaleTimeString();
          this.logMessage(target, `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#00f3ff-fg}<${this.nickname}> -> ${target}{/#00f3ff-fg}{/bold} ${msg}`, false);
        }
        break;
      case 'encrypt':
        if (args[0]) {
          this.channelKeys.set(this.currentWindow.toLowerCase(), args[0]);
          this.logMessage(this.currentWindow, `{bold}{#00ff66-fg}[E2EE ENCRYPTION ENABLED]{/#00ff66-fg}{/bold} Room key configured for ${this.currentWindow}`);
        } else {
          this.logMessage(this.currentWindow, `{#ffaa00-fg}Usage: /encrypt <passphrase>{/#ffaa00-fg}`);
        }
        break;
      case 'decrypt':
        this.channelKeys.delete(this.currentWindow.toLowerCase());
        this.logMessage(this.currentWindow, `{#ff5555-fg}[E2EE DISABLED]{/#ff5555-fg} Encryption disabled for ${this.currentWindow}`);
        break;
      case 'mode':
        if (args.length > 0) {
          this.sendRaw(`MODE ${args.join(' ')}`);
        }
        break;
      case 'op':
        if (args[0] && this.currentWindow.startsWith('#')) {
          this.sendRaw(`MODE ${this.currentWindow} +o ${args[0]}`);
        }
        break;
      case 'deop':
        if (args[0] && this.currentWindow.startsWith('#')) {
          this.sendRaw(`MODE ${this.currentWindow} -o ${args[0]}`);
        }
        break;
      case 'voice':
        if (args[0] && this.currentWindow.startsWith('#')) {
          this.sendRaw(`MODE ${this.currentWindow} +v ${args[0]}`);
        }
        break;
      case 'kick':
        if (args[0] && this.currentWindow.startsWith('#')) {
          this.sendRaw(`KICK ${this.currentWindow} ${args[0]} :${args.slice(1).join(' ') || 'Kicked'}`);
        }
        break;
      case 'oper':
        if (args[0] && args[1]) {
          this.sendRaw(`OPER ${args[0]} ${args[1]}`);
        }
        break;
      case 'whois':
        if (args[0]) {
          this.sendRaw(`WHOIS ${args[0]}`);
        }
        break;
      case 'clear':
        const win = this.windows.get(this.currentWindow);
        if (win) win.messages = [];
        this.chatLog.setContent('');
        this.screen.render();
        break;
      case 'warp':
        this.warpSpeed = !this.warpSpeed;
        this.logMessage('status', `{bold}{#00f3ff-fg}[COSMIC ENGINE]{/#00f3ff-fg}{/bold} Hyperspace warp effect set to ${this.warpSpeed}`);
        break;
      case 'help':
        this.logMessage(this.currentWindow, `{bold}{#00f3ff-fg}=== SHADOW-IRC COMMAND MANUAL ==={/#00f3ff-fg}{/bold}`);
        this.logMessage(this.currentWindow, ` /server <host> <port>   - Connect to IRC Server`);
        this.logMessage(this.currentWindow, ` /join #channel          - Join Channel`);
        this.logMessage(this.currentWindow, ` /part [#channel]        - Leave Channel`);
        this.logMessage(this.currentWindow, ` /msg <nick> <text>      - Direct Message`);
        this.logMessage(this.currentWindow, ` /encrypt <key>          - Turn ON AES-256 E2EE for current channel`);
        this.logMessage(this.currentWindow, ` /decrypt                - Turn OFF E2EE`);
        this.logMessage(this.currentWindow, ` /topic <text>           - Set Channel Topic`);
        this.logMessage(this.currentWindow, ` /op <nick> / /deop <nick>- Give/Remove Operator status`);
        this.logMessage(this.currentWindow, ` /voice <nick>           - Give Voice status`);
        this.logMessage(this.currentWindow, ` /kick <nick> [reason]   - Kick User from channel`);
        this.logMessage(this.currentWindow, ` /whois <nick>           - User lookup info`);
        this.logMessage(this.currentWindow, ` /clear                  - Clear window scrollback`);
        this.logMessage(this.currentWindow, ` /quit                   - Exit Client`);
        this.logMessage(this.currentWindow, ` ShortKeys: Alt+1..9 switch channel tabs, PageUp/PageDown scroll.`);
        break;
      case 'quit':
        this.disconnect('Client Exit');
        process.exit(0);
        break;
      default:
        this.sendRaw(cmdLine.substring(1));
        break;
    }
  }

  handleIncomingIRC(rawLine) {
    let trailing = '';
    let line = rawLine;

    const trailingIdx = line.indexOf(' :');
    if (trailingIdx !== -1) {
      trailing = line.substring(trailingIdx + 2);
      line = line.substring(0, trailingIdx);
    }

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;

    let prefix = '';
    if (parts[0].startsWith(':')) {
      prefix = parts.shift().substring(1);
    }

    const command = parts.shift().toUpperCase();
    const args = parts;
    if (trailing) args.push(trailing);

    const senderNick = prefix.split('!')[0] || this.host;
    const time = new Date().toLocaleTimeString();

    switch (command) {
      case 'PRIVMSG': {
        const target = args[0];
        let message = args[1] || '';
        let e2eStatus = '';

        // Check if message is E2EE encrypted
        if (ShadowCrypto.isEncrypted(message)) {
          const chanKey = this.channelKeys.get(target.toLowerCase());
          if (chanKey) {
            const decrypted = ShadowCrypto.decrypt(message, chanKey);
            if (decrypted) {
              message = decrypted;
              e2eStatus = ' {bold}{#00ff66-fg}[E2EE🔒]{/#00ff66-fg}{/bold}';
            } else {
              message = '{#ff5555-fg}[E2EE Encrypted Message - Decryption Failed / Invalid Key]{/#ff5555-fg}';
            }
          } else {
            message = '{#ffaa00-fg}[E2EE Encrypted Message - Set /encrypt <key> to view]{/#ffaa00-fg}';
          }
        }

        const formatted = `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#00f3ff-fg}<${senderNick}>${e2eStatus}{/#00f3ff-fg}{/bold} ${message}`;
        
        if (target.startsWith('#')) {
          this.logMessage(target, formatted);
        } else {
          // Direct message
          this.logMessage(senderNick, formatted);
        }

        // Terminal Audio Bell Notification
        process.stdout.write('\a');
        break;
      }
      case 'NOTICE': {
        const formatted = `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#ffaa00-fg}-${senderNick}-{/#ffaa00-fg}{/bold} ${args[1] || ''}`;
        this.logMessage(this.currentWindow, formatted);
        break;
      }
      case 'JOIN': {
        const chan = args[0];
        this.addWindow(chan);
        const win = this.windows.get(chan);
        if (win) win.users.add(senderNick);

        this.logMessage(chan, `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#00ff66-fg}--> ${senderNick}{/#00ff66-fg}{/bold} joined ${chan}`);
        this.updateUserListUI(win);
        break;
      }
      case 'PART': {
        const chan = args[0];
        const win = this.windows.get(chan);
        if (win) win.users.delete(senderNick);

        this.logMessage(chan, `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#ff0055-fg}<-- ${senderNick}{/#ff0055-fg}{/bold} left ${chan} (${args[1] || ''})`);
        this.updateUserListUI(win);
        break;
      }
      case 'TOPIC': {
        const chan = args[0];
        const newTopic = args[1] || '';
        const win = this.windows.get(chan);
        if (win) win.topic = newTopic;

        this.logMessage(chan, `{#64748b-fg}[${time}]{/#64748b-fg} {bold}{#ffaa00-fg}* ${senderNick}{/#ffaa00-fg}{/bold} set topic to: ${newTopic}`);
        if (this.currentWindow === chan) {
          this.topicBar.setContent(` Topic: ${newTopic}`);
        }
        break;
      }
      case '332': { // RPL_TOPIC
        const chan = args[1];
        const topicStr = args[2];
        const win = this.windows.get(chan);
        if (win) win.topic = topicStr;

        this.logMessage(chan, `{bold}{#ffaa00-fg}* Topic for ${chan}:{/#ffaa00-fg}{/bold} ${topicStr}`);
        if (this.currentWindow === chan) {
          this.topicBar.setContent(` Topic: ${topicStr}`);
        }
        break;
      }
      case '353': { // RPL_NAMREPLY
        const chan = args[2];
        const names = (args[3] || '').split(/\s+/).filter(Boolean);
        const win = this.windows.get(chan);
        if (win) {
          for (const n of names) win.users.add(n);
          this.updateUserListUI(win);
        }
        break;
      }
      default: {
        // Server response numeric or info message
        if (args.length > 1) {
          const sysMsg = args.slice(1).join(' ');
          this.logMessage('status', `{#64748b-fg}[${time}]{/#64748b-fg} {#8a2be2-fg}[SERVER]{/#8a2be2-fg} ${sysMsg}`);
        }
        break;
      }
    }
  }

  startCosmicAnimation() {
    // Dynamic ANSI Space Particle Starfield Renderer
    const starChars = ['✦', '✧', '★', '☆', '·', '•', '°', '🌌', '⚡'];
    let frame = 0;

    setInterval(() => {
      frame++;
      if (frame % 5 === 0) {
        const star = starChars[Math.floor(Math.random() * starChars.length)];
        const color = ['#ff007f', '#00f3ff', '#8a2be2', '#00ff66', '#ffaa00'][frame % 5];
        const hostInfo = `${this.host}:${this.port}`;
        
        let headerContent = ` {bold}{#ff007f-fg}🌌 SHADOW // IRC{/#ff007f-fg}{/bold} | {cyan-fg}COSMIC CYBER PROTOCOL{/cyan-fg} | {bold}{#00ff66-fg}E2EE SECURED{/#00ff66-fg}{/bold} | Host: {#b026ff-fg}${hostInfo}{/#b026ff-fg}  {${color}-fg}${star}{/${color}-fg}`;
        this.headerBox.setContent(headerContent);
        this.screen.render();
      }
    }, 200);
  }

  disconnect(reason) {
    if (this.socket && this.connected) {
      this.sendRaw(`QUIT :${reason || 'Client Exit'}`);
      this.socket.end();
    }
  }
}

// Auto-instantiate if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.argv[2] || 'localhost';
  const port = parseInt(process.argv[3] || '6667', 10);
  const nick = process.argv[4] || `shadow_${Math.floor(Math.random() * 8999 + 1000)}`;

  const client = new ShadowIRCClient({ host, port, nickname: nick });
  client.connect();
}

export default ShadowIRCClient;
