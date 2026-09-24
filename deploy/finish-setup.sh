#!/usr/bin/env bash
#
# Finishes the self-host setup: brings Tor up, backs up the onion keys, and
# wires the Cloudflare tunnel. Safe to re-run — every step checks its own
# state first and skips work already done.
#
#   sudo ./deploy/finish-setup.sh
#
set -uo pipefail

ONION_DIR=/var/lib/tor/shadow-irc
CF_CONFIG=/etc/cloudflared/config.yml
TUNNEL_NAME=shadow-irc
HOSTNAME_FQDN=app.shadowspace.space
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"

ok()   { echo "  [ok]   $*"; }
warn() { echo "  [warn] $*"; }
bad()  { echo "  [FAIL] $*"; }
step() { echo; echo "── $* ────────────────────────────────────"; }

[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 1; }

# ── 1. shadow-irc ───────────────────────────────────────────────────────────
step "Shadow IRC daemon"
if systemctl is-active --quiet shadow-irc; then
  ok "running"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8888 || echo 000)"
  [[ "$code" == "200" ]] && ok "serving locally (HTTP $code)" || bad "local check returned $code"
else
  bad "not running — check: journalctl -u shadow-irc -n 50"
  exit 1
fi

# ── 2. Tor ──────────────────────────────────────────────────────────────────
step "Tor"
if ! command -v tor >/dev/null; then
  bad "tor is not installed (apt install tor)"
  exit 1
fi

dupes="$(grep -c '^# Tor configuration for Shadow IRC\.$' /etc/tor/torrc || true)"
if (( dupes > 1 )); then
  warn "config block appears $dupes times — removing duplicates"
  cp /etc/tor/torrc "/etc/tor/torrc.bak.$(date +%s)"
  awk '/^# Tor configuration for Shadow IRC\.$/{n++} n<2' "/etc/tor/torrc" > /tmp/torrc.dedupe
  mv /tmp/torrc.dedupe /etc/tor/torrc
  ok "deduplicated"
elif (( dupes == 0 )); then
  warn "config block missing — appending"
  cat "$REPO_DIR/deploy/torrc.example" >> /etc/tor/torrc
  ok "appended"
else
  ok "config present once"
fi

# Must validate as debian-tor: as root it false-alarms on directory ownership.
if sudo -u debian-tor tor --verify-config >/tmp/torcheck 2>&1; then
  ok "config valid"
else
  bad "config invalid:"
  tail -5 /tmp/torcheck | sed 's/^/         /'
  exit 1
fi

systemctl restart tor
sleep 4
systemctl is-active --quiet tor && ok "tor running" || { bad "tor failed to start"; exit 1; }

# ── 3. onion ────────────────────────────────────────────────────────────────
step "Onion service"
if [[ -f "$ONION_DIR/hostname" ]]; then
  ONION="$(cat "$ONION_DIR/hostname")"
  ok "address: $ONION"
  BACKUP="$REAL_HOME/onion-keys-backup.tar.gz"
  if [[ ! -f "$BACKUP" ]]; then
    tar czf "$BACKUP" -C /var/lib/tor shadow-irc && chown "$REAL_USER" "$BACKUP"
    chmod 600 "$BACKUP"
    ok "keys backed up to $BACKUP"
  else
    ok "key backup already exists at $BACKUP"
  fi
else
  bad "no hostname file yet — tor may still be bootstrapping, re-run in a minute"
fi

# ── 4. outbound ─────────────────────────────────────────────────────────────
step "Outbound traffic"
ok "moderation runs locally — the daemon makes no outbound calls"

# ── 5. Cloudflare tunnel ────────────────────────────────────────────────────
step "Cloudflare tunnel"
if ! command -v cloudflared >/dev/null; then
  bad "cloudflared not installed"
  exit 1
fi

if [[ ! -f "$REAL_HOME/.cloudflared/cert.pem" ]]; then
  cat <<EOF
  [todo] Not logged in to Cloudflare yet. This step needs your account and a
         browser, so it cannot be automated. Run as yourself (no sudo):

             cloudflared tunnel login

         Then re-run this script and it will do the rest.
EOF
  exit 0
fi
ok "cloudflare login present"

# Parse the JSON properly rather than grepping it: cloudflared does not
# guarantee field order, and a tunnel that already exists must be found rather
# than recreated.
lookup_tunnel() {
  sudo -u "$REAL_USER" cloudflared tunnel list --output json 2>/dev/null \
    | /usr/bin/node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
          try {
            const hit = JSON.parse(s).find(t => t.name === process.argv[1]);
            if (hit) console.log(hit.id);
          } catch {}
        });
      ' "$TUNNEL_NAME"
}

TUNNEL_ID="$(lookup_tunnel)"

if [[ -z "$TUNNEL_ID" ]]; then
  sudo -u "$REAL_USER" cloudflared tunnel create "$TUNNEL_NAME" >/dev/null 2>&1
  TUNNEL_ID="$(lookup_tunnel)"
fi

if [[ -z "$TUNNEL_ID" ]]; then
  bad "could not determine the id for tunnel '$TUNNEL_NAME'"
  warn "list them with: cloudflared tunnel list"
  exit 1
fi
ok "tunnel $TUNNEL_NAME ($TUNNEL_ID)"

mkdir -p /etc/cloudflared
CRED_SRC="$REAL_HOME/.cloudflared/$TUNNEL_ID.json"
[[ -f "$CRED_SRC" ]] && install -m 600 "$CRED_SRC" "/etc/cloudflared/$TUNNEL_ID.json"

sed -e "s|TUNNEL_ID|$TUNNEL_ID|g" \
    "$REPO_DIR/deploy/cloudflared-config.yml.example" > "$CF_CONFIG"
chmod 644 "$CF_CONFIG"
ok "wrote $CF_CONFIG"

sudo -u "$REAL_USER" cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME_FQDN" 2>&1 \
  | tail -1 | sed 's/^/         /' || warn "DNS route may already exist"

# An existing unit is not necessarily ours. A token-based service (installed
# from the dashboard) takes its config remotely and ignores config.yml
# entirely, so it silently serves a different tunnel and the hostname 530s.
NEEDS_INSTALL=0
if ! systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
  NEEDS_INSTALL=1
elif systemctl cat cloudflared 2>/dev/null | grep -q -- '--token'; then
  warn "existing cloudflared service runs a token-based tunnel and ignores config.yml"
  warn "replacing it so this machine serves tunnel $TUNNEL_NAME"
  cloudflared service uninstall >/dev/null 2>&1
  NEEDS_INSTALL=1
elif ! systemctl cat cloudflared 2>/dev/null | grep -q "$CF_CONFIG"; then
  warn "existing cloudflared service does not reference $CF_CONFIG — reinstalling"
  cloudflared service uninstall >/dev/null 2>&1
  NEEDS_INSTALL=1
fi
(( NEEDS_INSTALL )) && cloudflared service install

systemctl restart cloudflared
sleep 4
systemctl is-active --quiet cloudflared && ok "cloudflared running" || bad "cloudflared failed — journalctl -u cloudflared -n 50"

# ── done ────────────────────────────────────────────────────────────────────
step "Done"
echo "  Public:  https://$HOSTNAME_FQDN"
[[ -n "${ONION:-}" ]] && echo "  Onion:   http://$ONION"
echo
echo "  Give it a minute for DNS, then check from another network."
echo "  Logs: journalctl -u shadow-irc -u cloudflared -u tor -f"
