# 🌌 SHADOW-IRC: Native Cosmic Cyber IRC Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Protocol](https://img.shields.io/badge/Protocol-RFC_1459%2F2812%2FIRCv3-magenta.svg)](#protocol)
[![Security](https://img.shields.io/badge/E2EE-AES--256--GCM-brightgreen.svg)](#e2ee)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS%20%7C%20Web-orange.svg)](#cross-platform)

**SHADOW-IRC** is a 100% free and open-source (MIT) cross-platform IRC suite featuring a dual-engine server (`shadow-ircd`) and terminal/web clients. It allows seamless communication between **Linux**, **Windows**, **macOS**, and mobile users.

---

## 💻 Communicating Across Windows, macOS, & Linux

`SHADOW-IRC` provides **three zero-cost options** for people on Windows and macOS to connect and talk with you:

### Option 1: Embedded Web Client (Zero Setup for Windows/macOS)
People on Windows or Mac can simply open their browser (Chrome, Edge, Safari, Firefox) and go to:
```text
http://<your-server-ip>:8888
```
They will instantly load the embedded HTML5 cosmic cyber chat client with animated space canvas graphics, zero installation required!

### Option 2: Native Terminal TUI (`shadow-irc`) on Windows & macOS
People on Windows (PowerShell / Windows Terminal / WSL) or macOS (Terminal / iTerm2) can run `shadow-irc` natively:
```bash
git clone https://github.com/your-repo/shadow-irc.git
cd shadow-irc
npm install
./bin/shadow-irc <your-server-ip> 6667 <nickname>
```

### Option 3: ANY Desktop / Mobile IRC App
Because `shadow-ircd` speaks standard RFC 1459/2812 TCP IRC protocol on port `6667`, users on any operating system can use their favorite native IRC app:
- **Windows**: HexChat, mIRC, AdiIRC, Irssi, Textual.
- **macOS**: Textual, LimeChat, Colloquy, HexChat, WeeChat.
- **iOS / Android**: IRCCloud, Amber, Revolution IRC, Palaver.

---

## 🚀 Server Quick Start

Start the dual-engine server daemon listening on TCP port `6667` and Web port `8888`:

```bash
./bin/shadow-ircd
```

*Output:*
```text
[SHADOW-IRCD] Native TCP Engine on 0.0.0.0:6667 (Terminal & Desktop Apps)
[SHADOW-IRCD] Web Gateway & Embedded Client on http://0.0.0.0:8888 (Windows/macOS/Browser)
```

---

## 🔒 End-to-End Encryption (E2EE)

SHADOW-IRC supports zero-knowledge client-side encryption with **AES-256-GCM**:
- Activate room encryption: `/encrypt <passphrase>`
- Deactivate: `/decrypt`

---

## 📄 License

MIT License - 100% Free and Open Source.
