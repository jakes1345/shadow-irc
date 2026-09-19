# 🌌 SHADOW-IRC v3.0 Enterprise Architecture

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/Protocol-RFC_1459%2F2812%2FIRCv3-magenta.svg)](#protocol)
[![Security](https://img.shields.io/badge/E2EE-AES--256--GCM-brightgreen.svg)](#e2ee)
[![Services](https://img.shields.io/badge/Services-NickServ%20%7C%20ChanServ%20%7C%20MemoServ%20%7C%20HostServ-purple.svg)](#services)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS%20%7C%20Web-orange.svg)](#cross-platform)

**SHADOW-IRC v3.0 Enterprise Edition** is a 100% free and open-source (MIT) production-grade IRC suite featuring built-in IRC Services (`NickServ`, `ChanServ`, `MemoServ`, `HostServ`), IRCv3 Capability Negotiation & History Replay (`server-time`, `chathistory`), ZNC-style 24/7 Bouncer Session Persistence, and Wildcard/CIDR Ban Mask Filtering (`+b`).

---

## 🌟 SHADOW-IRC v3.0 Enterprise Features

1. **IRC Services Subsystem**:
   - **`NickServ`**: Password registration (`/ns REGISTER <pass> [email]`), identification (`/ns IDENTIFY <pass>`), and ghosting (`/ns GHOST <nick>`).
   - **`ChanServ`**: Channel registration (`/cs REGISTER #channel`), founder ownership rights, persistent topic lock, and auto-op access lists.
   - **`MemoServ`**: Offline private memo storage & delivery (`/ms SEND <nick> <msg>`, `/ms READ`).
   - **`HostServ`**: IP cloaking and vHost assignments (`/hs REQUEST <vhost>`).

2. **IRCv3 Specifications & Scrollback History Engine**:
   - Capabilities: `server-time`, `echo-message`, `message-tags`, `chathistory`, `sasl`, `account-notify`, `extended-join`.
   - **Ring Buffer History Engine**: Per-channel 500-item circular buffer with ISO-8601 UTC server timestamps. Replays missed scrollback when users join channels.

3. **ZNC-Style 24/7 Bouncer Session Engine**:
   - Persists user sessions when disconnected (`/bouncer enable`).
   - Buffers unread channel messages & DMs while offline, and automatically flushes playback upon reconnect and identification.

4. **Wildcard & CIDR Ban Mask Engine (`+b`)**:
   - Supports `nick!user@host` wildcard patterns (e.g. `*!*@192.168.1.*` or `troll*!*@*.vpn`).
   - Set channel ban: `/mode #channel +b <mask`
   - View ban list: `/mode #channel b`

---

## 🚀 Server Quick Start

Start the v3.0 dual-engine server daemon listening on TCP port `6667` and Web port `8888`:

```bash
./bin/shadow-ircd
```

*Output:*
```text
[SERVICES] Loaded registered accounts & channels.
[SHADOW-IRCD v3.0] Native TCP Engine on 0.0.0.0:6667 (Terminal & Desktop Apps)
[SHADOW-IRCD v3.0] Web Gateway & Embedded Client on http://0.0.0.0:8888 (Windows/macOS/Browser)
```

---

## ⌨️ Command Reference & Keyboard Shortcuts

### Supported IRC Commands
| Command | Description | Example |
|---|---|---|
| `/ns REGISTER <pass> [email]` | Register nickname with NickServ | `/ns REGISTER cosmicPass2026 me@shadow.net` |
| `/ns IDENTIFY <pass>` | Authenticate password | `/ns IDENTIFY cosmicPass2026` |
| `/cs REGISTER #channel` | Register channel with ChanServ | `/cs REGISTER #cosmos` |
| `/ms SEND <nick> <text>` | Send offline memo | `/ms SEND captain_jack Check logs` |
| `/ms READ` | Read offline memos | `/ms READ` |
| `/hs REQUEST <vhost>` | Request custom vHost | `/hs REQUEST shadow.cyber.cosmos` |
| `/bouncer enable` | Toggle 24/7 Bouncer persistence | `/bouncer enable` |
| `/encrypt <passphrase>` | Enable AES-256 E2EE for room | `/encrypt nebulaKey123` |
| `/mode #channel +b <mask>` | Ban wildcard mask | `/mode #cosmos +b *!*@192.168.1.*` |

---

## 📄 License

MIT License - 100% Free and Open Source.
