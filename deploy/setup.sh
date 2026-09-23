#!/usr/bin/env bash
#
# Installs Shadow IRC as a systemd service on this machine.
#
# The daemon binds to loopback only. Nothing is exposed to the internet by this
# script — a Cloudflare tunnel does that, and the steps to set it up are printed
# at the end. Re-running this script is the upgrade path; it will not overwrite
# the env file or the services database.
#
#   sudo ./deploy/setup.sh
#
set -euo pipefail

APP_DIR=/opt/shadow-irc
ENV_DIR=/etc/shadow-irc
ENV_FILE="$ENV_DIR/env"
SERVICE_USER=shadowirc
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "run with sudo"
command -v node >/dev/null || die "node is not installed"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "node 20+ required, found $(node --version)"

# ---- service account -------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  say "creating $SERVICE_USER system user"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ---- application files -----------------------------------------------------
say "installing application to $APP_DIR"
mkdir -p "$APP_DIR"
# Deliberately excludes data/ so an existing services database is never
# clobbered by an upgrade.
rsync -a --delete \
  --exclude data/ \
  --exclude .git/ \
  --exclude node_modules/ \
  --exclude src-tauri/target/ \
  "$REPO_DIR"/ "$APP_DIR"/

say "installing production dependencies"
( cd "$APP_DIR" && npm ci --omit=dev --silent )

mkdir -p "$APP_DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 700 "$APP_DIR/data"

# ---- secrets ---------------------------------------------------------------
mkdir -p "$ENV_DIR"
if [[ -f "$ENV_FILE" ]]; then
  say "keeping existing $ENV_FILE"
else
  say "writing $ENV_FILE template"
  cat > "$ENV_FILE" <<'EOF'
NODE_ENV=production

# Loopback only. The tunnel reaches the daemon locally; nothing should be
# reachable from the LAN or the internet directly.
HOST=127.0.0.1
PORT=6667
WEB_PORT=8888

# Decrypts data/services_db.json. If this is wrong the daemon refuses to write
# rather than overwriting accounts, so a typo is recoverable — but a lost key
# means the database cannot be read at all. Keep a copy somewhere safe.
SERVICES_DB_KEY=

# Password for the master account.
MASTER_PASSWORD=

# Optional. Without it the JEV moderation calls are skipped entirely.
JEV_API_KEY=

# Routes JEV's outbound calls through Tor's HTTP CONNECT port so they do not
# expose this machine's IP to the API. Requires HTTPTunnelPort in torrc.
# Leave blank to call the API directly.
TOR_PROXY=127.0.0.1:9080
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
fi

# ---- existing database -----------------------------------------------------
if [[ -f "$REPO_DIR/services_db.json" && ! -f "$APP_DIR/data/services_db.json" ]]; then
  say "importing services_db.json from repo root"
  install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 600 \
    "$REPO_DIR/services_db.json" "$APP_DIR/data/services_db.json"
fi

# ---- service ---------------------------------------------------------------
say "installing systemd unit"
install -m 644 "$REPO_DIR/deploy/shadow-irc.service" /etc/systemd/system/shadow-irc.service
systemctl daemon-reload
systemctl enable shadow-irc >/dev/null

if [[ -s "$ENV_FILE" ]] && grep -q '^SERVICES_DB_KEY=.\+' "$ENV_FILE"; then
  say "restarting shadow-irc"
  systemctl restart shadow-irc
  sleep 2
  systemctl is-active --quiet shadow-irc \
    && say "shadow-irc is running" \
    || die "shadow-irc failed to start — check: journalctl -u shadow-irc -n 50"
else
  cat <<EOF

Not starting yet: $ENV_FILE still needs SERVICES_DB_KEY and MASTER_PASSWORD.

  sudo nano $ENV_FILE
  sudo systemctl start shadow-irc
EOF
fi

# ---- tunnel ----------------------------------------------------------------
cat <<'EOF'

Next, expose it with a Cloudflare tunnel. These steps need your Cloudflare
login, so they are not automated here:

  cloudflared tunnel login
  cloudflared tunnel create shadow-irc
  cloudflared tunnel route dns shadow-irc app.shadowspace.space

Then copy deploy/cloudflared-config.yml.example to /etc/cloudflared/config.yml,
replace TUNNEL_ID with the id that `tunnel create` printed, and run:

  sudo cloudflared service install
  sudo systemctl restart cloudflared

For the onion address and to keep JEV from leaking this machine's IP:

  sudo apt install tor
  cat deploy/torrc.example | sudo tee -a /etc/tor/torrc
  sudo systemctl restart tor
  sudo cat /var/lib/tor/shadow-irc/hostname     # your .onion address

Back up /var/lib/tor/shadow-irc/ — those keys are the address itself, and
losing them loses the address for good.

Useful afterwards:
  journalctl -u shadow-irc -f
  systemctl status shadow-irc cloudflared tor
EOF
