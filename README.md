# 🌌 SHADOW-IRC: Native Cosmic Cyber IRC Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/Protocol-RFC_1459%2F2812%2FIRCv3-magenta.svg)](#protocol)
[![Security](https://img.shields.io/badge/E2EE-AES--256--GCM-brightgreen.svg)](#e2ee)

**SHADOW-IRC** is a 100% free and open-source (MIT), zero-bloat, native TCP IRC platform with a deep-space cosmic nebula hacker aesthetic. Designed for terminal purists and security-minded operators, it features a native high-performance RFC 1459/2812 IRC Server Daemon (`shadow-ircd`) and a 24-bit TrueColor Terminal TUI Client (`shadow-irc`) complete with ASCII/ANSI cosmic particle animations, End-to-End Encryption (E2EE), sound cues, and multi-window channel management.

---

## 🌟 Key Features

- **100% Pure Native Execution**: Zero web browser overhead, zero electron bloat. Runs directly in Linux shell environments (`bash`, `zsh`, `tmux`, `kitty`, `alacritty`, `gnome-terminal`).
- **RFC 1459 / 2812 / IRCv3 Server Daemon (`shadow-ircd`)**:
  - Native TCP socket handling on standard IRC port `6667` (and TLS/SSL `6697`).
  - Supports `NICK`, `USER`, `JOIN`, `PART`, `PRIVMSG`, `NOTICE`, `TOPIC`, `MODE`, `WHOIS`, `NAMES`, `LIST`, `OPER`, `KICK`, `BAN`, `PING`, `PONG`, `QUIT`, `MOTD`.
  - Channel Modes: `+o` (ops), `+v` (voice), `+m` (moderated), `+i` (invite-only), `+k` (key lock), `+t` (topic lock), `+n` (no external msgs), `+s` (secret).
  - Built-in flood protection rate limiting & memory exhaustion safeguards.
  - Linear-time ReDoS-safe IRC message parser.
- **Cosmic Cyber Terminal TUI Client (`shadow-irc`)**:
  - **24-bit TrueColor Cosmic Space Engine**: Live animated ASCII starfields and nebula particle dust rendering in terminal headers.
  - **AES-256-GCM End-to-End Encryption (E2EE)**: Room-level key management (`/encrypt <passphrase>`) using Node WebCrypto PBKDF2 derivation.
  - **Multi-Window Navigation**: Tabbed channel windows (`Alt+1..9`), unread message count badges, active nicklist sidebar with status symbols (`@`, `+`).
  - **Interactive CLI & Command Autocomplete**: `Tab` completion for nicks, up/down command history memory, custom scrollback (`PageUp`/`PageDown`).
  - **Terminal Audio Cues**: Native terminal audio bell notifications on mentions and joins.

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18.0.0 or higher
- Terminal supporting ANSI 256 or 24-bit TrueColor colors.

### 1. Installation

```bash
git clone https://github.com/your-repo/shadow-irc.git
cd shadow-irc
npm install
```

### 2. Start the IRC Server Daemon (`shadow-ircd`)

Launch the native IRC server daemon listening on TCP port 6667:

```bash
./bin/shadow-ircd
# or via npm
npm run server
```

*Output:*
```text
[SHADOW-IRCD] Server active on 0.0.0.0:6667
[SHADOW-IRCD] Server Name: shadow.cosmos.net
```

### 3. Launch the Terminal TUI Client (`shadow-irc`)

Open a new terminal window or tmux pane and connect:

```bash
./bin/shadow-irc localhost 6667 my_cosmic_nick
# or via npm
npm run client
```

---

## 🔒 End-to-End Encryption (E2EE) Guide

SHADOW-IRC supports zero-knowledge client-side encryption. Messages sent in an encrypted channel are encrypted with **AES-256-GCM** before touching the network wire. The server only sees encrypted ciphertext.

1. In any channel (e.g. `#cosmos`), set a secret room key:
   ```irc
   /encrypt mySecretQuantumPassphrase
   ```
2. Send messages as usual. Outgoing messages will carry the `[E2EE🔒]` badge.
3. Other users in `#cosmos` setting the same key with `/encrypt mySecretQuantumPassphrase` will automatically decrypt and read your messages. Users without the key will only see locked ciphertext payloads.
4. Disable encryption anytime with:
   ```irc
   /decrypt
   ```

---

## ⌨️ Command Reference & Keyboard Shortcuts

### Keyboard Shortcuts
| Key Combo | Action |
|---|---|
| `Alt+1` .. `Alt+9` | Switch between Channel Tabs |
| `Tab` | Auto-complete Nickname / Command |
| `Up` / `Down` | Browse Command History |
| `PageUp` / `PageDown` | Scroll Chat Log |
| `Ctrl+C` / `Ctrl+D` | Exit Client |

### Supported IRC Commands
| Command | Description | Example |
|---|---|---|
| `/server <host> [port]` | Connect to an IRC Server | `/server localhost 6667` |
| `/join #channel [key]` | Join a channel | `/join #cosmos` |
| `/part [#channel] [reason]`| Leave current channel | `/part #cosmos Goodbye` |
| `/nick <new_nick>` | Change nickname | `/nick cyber_ghost` |
| `/msg <nick> <message>` | Send private message | `/msg retro_guy Hello` |
| `/encrypt <passphrase>` | Enable AES-256 E2EE for current window | `/encrypt nebulaKey123` |
| `/decrypt` | Disable E2EE for current window | `/decrypt` |
| `/topic [new_topic]` | View or set channel topic | `/topic Cyber Security Base` |
| `/op <nick>` | Grant Channel Operator status (`@`) | `/op shadow_friend` |
| `/deop <nick>` | Remove Operator status | `/deop shadow_friend` |
| `/voice <nick>` | Grant Voice status (`+`) | `/voice shadow_user` |
| `/kick <nick> [reason]` | Kick user from channel | `/kick intruder Spammer` |
| `/oper <user> <pass>` | Authenticate as IRC Server Operator | `/oper admin cosmicsecret` |
| `/whois <nick>` | Query user details & channels | `/whois cyber_ghost` |
| `/clear` | Clear scrollback log in active window | `/clear` |
| `/help` | Print manual in client | `/help` |
| `/quit` | Exit IRC client | `/quit` |

---

## 🛡️ Security Audit & Hardening

1. **ReDoS Immunity**: Parser uses linear string segmentation rather than backtracking regular expressions.
2. **Buffer Limits**: Strict 512-byte per-line IRC spec truncation and 64KB max connection buffer limits prevent memory exhaustion.
3. **Flood Control**: Integrated message rate-limiting prevents channel flooding and socket spam.
4. **Input Sanitization**: Terminal ANSI control code injection filters prevent arbitrary terminal code execution.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - 100% Free and Open Source.
