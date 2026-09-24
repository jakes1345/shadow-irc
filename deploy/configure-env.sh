#!/usr/bin/env bash
#
# Fills in /etc/shadow-irc/env interactively.
#
# Asks for the one secret that cannot be regenerated (SERVICES_DB_KEY, which
# decrypts the existing accounts database) and generates the rest.
#
#   sudo ./deploy/configure-env.sh
#
set -euo pipefail

ENV_FILE=/etc/shadow-irc/env
DATA_DB=/opt/shadow-irc/data/services_db.json

die() { echo "error: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -d /etc/shadow-irc ]] || die "run deploy/setup.sh first"

echo
echo "─────────────────────────────────────────────────────────────"
echo " Shadow IRC — configure /etc/shadow-irc/env"
echo "─────────────────────────────────────────────────────────────"
echo

# ---- SERVICES_DB_KEY -------------------------------------------------------
if [[ -f "$DATA_DB" ]]; then
  echo "An existing accounts database was found ($(stat -c%s "$DATA_DB") bytes)."
  echo "It is encrypted. Without the matching key it cannot be read, and every"
  echo "registered nick and device key in it is lost."
else
  echo "No existing database found — a new empty one will be created."
  echo "If you meant to migrate, stop now and place services_db.json first."
fi
echo
echo "Retrieve the key with:"
echo "    flyctl ssh console --app shadow-irc -C \"printenv SERVICES_DB_KEY\""
echo "(or scroll back — you have printed it before)"
echo

read -r -p "SERVICES_DB_KEY: " DB_KEY
[[ -n "$DB_KEY" ]] || die "SERVICES_DB_KEY cannot be empty"

# The key is hashed to 32 bytes by the server, so any length works, but the
# real one is 64 hex chars — warn on anything that does not look like it.
if [[ ! "$DB_KEY" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo
  echo "warning: that does not look like the usual 64-character hex key."
  read -r -p "Use it anyway? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || die "aborted"
fi

# ---- MASTER_PASSWORD -------------------------------------------------------
MASTER_PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

# ---- write -----------------------------------------------------------------
[[ -f "$ENV_FILE" ]] && cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"

umask 077
cat > "$ENV_FILE" <<EOF
NODE_ENV=production

# Loopback only — the tunnel reaches the daemon locally.
HOST=127.0.0.1
PORT=6667
WEB_PORT=8888

# Decrypts data/services_db.json. Losing this means losing every account.
SERVICES_DB_KEY=$DB_KEY

MASTER_PASSWORD=$MASTER_PW
EOF

chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"
say "wrote $ENV_FILE (mode 600)"

echo
echo "─────────────────────────────────────────────────────────────"
echo " Master account password — save this now, it is not shown again:"
echo
echo "     $MASTER_PW"
echo
echo "─────────────────────────────────────────────────────────────"
echo
read -r -p "Saved it? Press enter to start the service. "

systemctl restart shadow-irc
sleep 2

if systemctl is-active --quiet shadow-irc; then
  say "shadow-irc is running"
  echo
  echo "Verify the database actually decrypted — this must NOT appear:"
  echo "    journalctl -u shadow-irc -n 20 | grep 'refusing to overwrite'"
  echo
  echo "If it does, the key is wrong. Your data is still intact; the server"
  echo "refuses to write rather than clobbering it. Re-run this script."
else
  echo
  die "failed to start. Check: journalctl -u shadow-irc -n 50"
fi
