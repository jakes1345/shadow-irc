<p align="center">
  <img src="assets/logo.png" alt="SHADOW-IRC logo" width="120">
</p>

<h1 align="center">SHADOW-IRC</h1>

<p align="center">
  An IRC server with built-in services, plus a desktop app and a terminal client.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/server-Node.js%2020-339933?style=flat-square" alt="Node.js 20">
  <img src="https://img.shields.io/badge/desktop-Tauri%20v2-24c8db?style=flat-square" alt="Tauri v2">
</p>

<p align="center">
  <a href="https://shadowspace.space">shadowspace.space</a> · <a href="https://app.shadowspace.space">Web client</a> · <a href="https://github.com/jakes1345/shadow-irc/releases">Downloads</a>
</p>

---

SHADOW-IRC is a self-hosted IRC network in one Node.js process. It speaks standard IRC (RFC 1459/2812) over TCP and WebSocket, so ordinary IRC clients work. It also adds the things a small network normally gets from a separate services package and a bouncer: nickname and channel registration, offline memos, vhosts, session persistence and channel history.

It is built for a small community that wants to own its chat. The server makes no outbound requests, moderation runs in-process, and it can be published as a Tor onion service as well as on a domain.

## What's in the repo

| Part | What it is | Where |
|---|---|---|
| Server | The IRC daemon: TCP on 6667, HTTP and WebSocket on 8888 | [`src/server/`](src/server/) |
| Web and desktop client | A single-page client. The daemon serves it on port 8888, and Tauri packages the same files as the desktop app | [`src-desktop/`](src-desktop/), [`src-tauri/`](src-tauri/) |
| Terminal client | A full-screen TUI client with tabs, a user list and channel encryption | [`src/client/tui.js`](src/client/tui.js) |
| Landing page | A Cloudflare Worker that serves shadowspace.space | [`src/worker.js`](src/worker.js), [`website/`](website/) |
| Self-hosting | A systemd unit, an env setup script, and Cloudflare Tunnel and Tor configs | [`deploy/`](deploy/) |

## Features

**IRC**

- Channels with ops (`+o`), voice (`+v`), topics, `KICK` and `INVITE`. Channel modes: `+m` moderated, `+i` invite only, `+k` key, `+n` no outside messages, `+t` ops set the topic, `+s` secret and `+b` ban.
- `WHO`, `WHOIS`, `NAMES`, `LIST`, `AWAY`, `USERHOST`, `ISON`, CTCP (`VERSION`, `TIME`, `PING`) and `/me`.
- Ban masks use `nick!user@host` wildcards (`*!*@*.example.net`). CIDR ranges are not supported: a mask such as `*!*@10.0.0.0/8` is matched literally.
- Hosts are cloaked by default as a SHA-256 hash of the IP. Only operators can see real addresses, using `REALIP`.

**IRCv3**

- Capabilities: `server-time`, `echo-message`, `message-tags`, `chathistory`, `account-notify`, `extended-join`.
- Each channel keeps its last 500 messages in memory. When you join, the last 40 are replayed with their original timestamps.

**Services**

| Service | Commands |
|---|---|
| NickServ | `REGISTERKEY`, `CHALLENGE`, `AUTH`, `ADDKEY`, `DELKEY`, `LISTKEYS`, `REGISTER`, `IDENTIFY`, `GHOST` |
| ChanServ | `REGISTER #channel`, `OP #channel [nick]` |
| MemoServ | `SEND <nick> <message>`, `READ`, `DELETE <n\|ALL>` |
| HostServ | `REQUEST <vhost>` |

- **Accounts are device keys, not passwords.** Each device has an ECDSA P-256 key pair, and you log in by signing a one-time challenge. The desktop app creates its key with WebCrypto as non-extractable, so the private key can't be exported, even by the app. Up to 10 devices can be linked to one nickname. Passwords (PBKDF2 with a salt per account) are an optional fallback.
- **The services database is encrypted at rest.** It is stored as AES-256-GCM, keyed from `SERVICES_DB_KEY` in the process environment, never on disk. If the key is missing or wrong, the server runs without saving rather than overwriting the database.

**Bouncer**

- Turn it on with `/bouncer enable`. When an identified user disconnects, their session stays in their channels, and channel messages and DMs are queued. Everything queued is played back when they reconnect and identify.
- Bouncer sessions are kept in memory, so they don't survive a server restart.

**Channel encryption**

- `/encrypt <passphrase>` encrypts your messages in a channel with AES-256-GCM. The key is derived with PBKDF2-SHA256 (600,000 iterations, a random 16-byte salt). Everyone who should read the channel uses the same passphrase. The server only relays ciphertext.
- This is a shared-key scheme with no forward secrecy: anyone who learns the passphrase can read past messages they captured.

**Moderation**

- A local, rule-based moderator catches flooding, repeated messages, join floods, link spam, mass highlights, all-caps shouting and impersonation of reserved nicknames. It warns first, kicks after 3 offences and bans after 5. Offences stop counting after 5 minutes.
- No message content leaves the server for this. Operators can inspect it with `MODCHECK <nick>` and `MODLIST`.

**Operator tools**

- The network has one operator account, `Shadow`. Its password comes only from `MASTER_PASSWORD` and is never stored. After identifying as `Shadow`, `OPER` gives operator status.
- `INVITELINK [hours]` creates a web-client invite link (1 to 168 hours, up to 10 uses). Operators also have `KILL`, `WALLOPS`, `REALIP`, `MODCHECK` and `MODLIST`.
- `PANIC` (alias `NUKE`) wipes every history buffer and bouncer queue from memory, overwrites the services database with random data and deletes it, then disconnects everyone.

## Quick start

Requires Node.js 20 or later.

```bash
git clone https://github.com/jakes1345/shadow-irc.git
cd shadow-irc
npm install
npm start
```

The server listens on TCP 6667 for IRC clients and on http://localhost:8888 for the web client and WebSocket.

Connect with the terminal client:

```bash
./bin/shadow-irc localhost 6667 yournick
```

`bin/shadow-irc` takes `host port nick`. It uses TLS for any host other than `localhost` and `127.0.0.1`, so for the public network use port 6697:

```bash
./bin/shadow-irc app.shadowspace.space 6697 yournick
```

Any standard IRC client works too: point it at `app.shadowspace.space`, port 6697, with TLS on.

### Desktop app

Download an installer from [Releases](https://github.com/jakes1345/shadow-irc/releases): `.msi` for Windows, `.dmg` for macOS (Intel and Apple Silicon) and `.AppImage` for Linux. To run it from source (needs Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
npm run desktop          # development
npm run build:desktop    # installers in src-tauri/target/release/bundle/
```

The app connects to `wss://app.shadowspace.space` by default. You can point it at any SHADOW-IRC server, including one on your LAN.

## Configuration

All settings come from environment variables.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `6667` | IRC over TCP |
| `WEB_PORT` | `8888` | Web client, WebSocket and invite API |
| `HOST` | all interfaces | Set to `127.0.0.1` when the server sits behind a tunnel |
| `SERVICES_DB_KEY` | none | Encrypts `data/services_db.json`. **Without it, registrations aren't saved.** Keep a copy: losing it loses every account |
| `MASTER_PASSWORD` | none | Password for the `Shadow` operator account |

## Deploying

**Fly.io.** `fly.toml` runs one machine with a volume at `/app/data`. HTTPS and WebSocket are on 443, and IRC on 6697 with TLS terminated by Fly. Set the two secrets first:

```bash
fly secrets set SERVICES_DB_KEY="$(openssl rand -hex 32)" MASTER_PASSWORD="$(openssl rand -base64 24)"
fly deploy
```

**Docker.**

```bash
docker build -t shadow-irc .
docker run -p 6667:6667 -p 8888:8888 -v shadow-data:/app/data \
  -e SERVICES_DB_KEY=... -e MASTER_PASSWORD=... shadow-irc
```

**Your own Linux machine.** The daemon binds to loopback only, and a Cloudflare Tunnel and a Tor onion service publish it:

```bash
sudo ./deploy/setup.sh            # installs to /opt/shadow-irc as a systemd service
sudo ./deploy/configure-env.sh    # writes /etc/shadow-irc/env
sudo ./deploy/finish-setup.sh     # brings up Tor, backs up the onion keys, wires the tunnel
```

The onion service serves the same web client. The client sees the `.onion` hostname and uses `ws://` there, because Tor already encrypts the connection. Example configs are in [`deploy/cloudflared-config.yml.example`](deploy/cloudflared-config.yml.example) and [`deploy/torrc.example`](deploy/torrc.example).

## Releases

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It builds the desktop app on Linux, Windows and macOS and attaches the installers to a GitHub release.

## Tests

Each test is a script that starts a server on its own local port, connects real clients and checks the replies. Run them from a fresh checkout, not from a server's install directory: `verify_panic.js` deletes `data/services_db.json` in the current directory.

```bash
node test/verify.js               # registration, channel broadcast, channel encryption
node test/verify_v3.js            # NickServ, ChanServ, IRCv3 history replay on join
node test/verify_dms.js           # private messages
node test/verify_moderation.js    # flood, repeat and impersonation rules
node test/verify_panic.js         # PANIC purge
```

## License

[MIT](LICENSE)
