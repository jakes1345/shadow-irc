/**
 * JEV (TypeSafe AI System One) — Decision engine for Shadow IRC
 * POST https://api.typesafe.ai/v1/systemone
 *
 * Covers the full IRC lifecycle:
 *   - Connection screening (IP/host pattern check)
 *   - Nick validation (impersonation/admin-name check)
 *   - Channel join gate (per-user trust check)
 *   - Message auto-mod (spam/abuse/flood)
 *   - Kick escalation (should kick become a ban?)
 *   - Periodic sweep (5-min background scan of all users)
 *   - Oper commands: JEVCHECK, JEVASK
 */

import https from 'https';
import net from 'net';
import tls from 'tls';

const API_URL = new URL('https://api.typesafe.ai/v1/systemone');
const TIMEOUT_MS = 4000;

/**
 * Tunnels requests through Tor's HTTP CONNECT port (HTTPTunnelPort in torrc)
 * when TOR_PROXY is set.
 *
 * Without it these calls leave the machine directly, which hands the API the
 * server's IP on every message it screens. That is fine on a cloud host and
 * very much not fine when self-hosting from home behind a tunnel, since it
 * leaks the origin the tunnel exists to hide.
 *
 * Uses https.request rather than fetch because Node's fetch cannot be given a
 * proxy agent without pulling in undici.
 */
class TorConnectAgent extends https.Agent {
  constructor(proxyHost, proxyPort) {
    super({ keepAlive: true });
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
  }

  createConnection(options, callback) {
    const target = `${options.host}:${options.port || 443}`;
    const proxy = net.connect(this.proxyPort, this.proxyHost);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      proxy.destroy();
      callback(err);
    };

    proxy.once('error', fail);
    proxy.setTimeout(TIMEOUT_MS, () => fail(new Error('tor proxy timeout')));

    proxy.once('connect', () => {
      proxy.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });

    // The CONNECT response can in principle arrive split, so buffer until the
    // header terminator. Nothing follows it: the peer cannot speak before we
    // send a TLS ClientHello, so there is no early data to preserve here.
    let buf = '';
    const onData = (chunk) => {
      if (settled) return;
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;

      proxy.removeListener('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf)) return fail(new Error('tor CONNECT rejected'));

      settled = true;
      proxy.setTimeout(0);
      proxy.removeListener('error', fail);

      const socket = tls.connect({ socket: proxy, servername: options.host }, () => callback(null, socket));
      socket.once('error', (err) => callback(err));
    };
    proxy.on('data', onData);
  }
}

let cachedAgent;
function torAgent() {
  if (cachedAgent !== undefined) return cachedAgent;
  const proxy = process.env.TOR_PROXY;
  if (!proxy) {
    cachedAgent = null;
  } else {
    const [host, port] = proxy.split(':');
    cachedAgent = new TorConnectAgent(host || '127.0.0.1', parseInt(port || '9080', 10));
  }
  return cachedAgent;
}

function query(state, questions) {
  const key = process.env.JEV_API_KEY;
  if (!key) return Promise.resolve(null);

  const body = JSON.stringify({ state, model: 'jev-latest', questions });

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = https.request({
      hostname: API_URL.hostname,
      port: 443,
      path: API_URL.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      agent: torAgent() || undefined,
      timeout: TIMEOUT_MS
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return done(null); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { done(JSON.parse(data)); } catch { done(null); }
      });
    });

    req.on('error', () => done(null));
    req.on('timeout', () => { req.destroy(); done(null); });
    req.end(body);
  });
}

// ─── Connection screening ─────────────────────────────────────────────────────

/**
 * Called on every new TCP/WS connection before the user registers.
 * Returns { block: bool, confidence: 0-1 } — block = true means drop immediately.
 */
export async function screenConnection(ip, host) {
  const result = await query(
    `New connection attempt.\nIP: ${ip}\nHostname: ${host || ip}`,
    {
      is_threat: {
        type: 'noul',
        instructions: 'Does this IP or hostname pattern strongly suggest a known attack source, mass-scanner, or bot farm? (Tor exit nodes and VPNs alone are NOT enough — look for obvious attack patterns.)'
      }
    }
  );

  const threat = result?.answers?.is_threat?.noul ?? 0;
  return { block: threat >= 0.95, confidence: threat };
}

// ─── Nick validation ──────────────────────────────────────────────────────────

/**
 * Check if a nick looks like an impersonation of staff/services/admin.
 * Returns { suspicious: bool, confidence: 0-1 }
 */
export async function validateNick(nick) {
  const result = await query(
    `User is trying to register or use the nick: "${nick}"`,
    {
      impersonation: {
        type: 'noul',
        instructions: 'Does this nick look like an attempt to impersonate IRC staff, server admin, services (NickServ, ChanServ, etc.), or the network owner ("shadow")? Minor similarities are not enough — it must be a clear impersonation attempt.'
      }
    }
  );

  const score = result?.answers?.impersonation?.noul ?? 0;
  return { suspicious: score >= 0.9, confidence: score };
}

// ─── Channel join gate ────────────────────────────────────────────────────────

/**
 * Decide whether to let a user join a channel based on their profile.
 * Returns { allow: bool, reason: string }
 */
export async function evaluateJoin(nick, host, channelName, channelTopic, userMsgCount, joinAge) {
  const state = [
    `Nick: ${nick}`,
    `Host: ${host}`,
    `Channel: ${channelName}`,
    channelTopic ? `Channel topic: ${channelTopic}` : '',
    `Messages sent so far this session: ${userMsgCount}`,
    `Account age (minutes since connect): ${joinAge}`
  ].filter(Boolean).join('\n');

  const result = await query(state, {
    allow_join: {
      type: 'noul',
      instructions: 'Based on the user profile, is there a strong reason to deny this channel join? (Only deny for clearly suspicious patterns — new connections with zero history joining private channels, etc.)'
    }
  });

  const deny = result?.answers?.allow_join?.noul ?? 0;
  if (deny >= 0.9) {
    return { allow: false, reason: 'JEV: suspicious join pattern' };
  }
  return { allow: true, reason: '' };
}

// ─── Message auto-mod ─────────────────────────────────────────────────────────

/**
 * Evaluate a channel message for spam/abuse.
 * Returns { spam: 0-1, abuse: 0-1, action: 'ignore'|'warn'|'kick'|'ban', confidence: 0-1 }
 */
export async function evaluateMessage(nick, host, channel, message, recentMessages = []) {
  const state = [
    `Nick: ${nick}`,
    `Host: ${host}`,
    `Channel: ${channel}`,
    `Message: ${message}`,
    recentMessages.length ? `Recent from same user:\n${recentMessages.slice(-5).join('\n')}` : ''
  ].filter(Boolean).join('\n');

  const result = await query(state, {
    spam: {
      type: 'noul',
      instructions: 'Is this message spam, an advertisement, or a repeated flood message?'
    },
    abuse: {
      type: 'noul',
      instructions: 'Does this message contain harassment, slurs, or targeted abuse?'
    },
    action: {
      type: 'choice',
      instructions: 'What moderation action should be taken, if any?',
      criteria: {
        ignore: 'Message is fine, no action needed',
        warn:   'Message is borderline — send a warning to the user',
        kick:   'Message violates rules — kick the user from the channel',
        ban:    'Message is severe — ban the user from the channel'
      }
    }
  });

  if (!result?.answers) return null;
  return {
    spam:       result.answers.spam?.noul   ?? 0,
    abuse:      result.answers.abuse?.noul  ?? 0,
    action:     result.answers.action?.choice ?? 'ignore',
    confidence: result.answers.action?.confidence ?? 0
  };
}

// ─── Kick escalation ──────────────────────────────────────────────────────────

/**
 * After a kick, ask JEV if a channel ban should also be applied.
 * Returns { ban: bool, confidence: 0-1 }
 */
export async function evaluateKickEscalation(nick, host, channel, kickReason, msgHistory = []) {
  const state = [
    `Nick ${nick} (${host}) was kicked from ${channel}.`,
    `Kick reason: ${kickReason}`,
    msgHistory.length ? `Their recent messages:\n${msgHistory.slice(-8).join('\n')}` : 'No message history.'
  ].join('\n');

  const result = await query(state, {
    should_ban: {
      type: 'noul',
      instructions: 'Given the kick reason and message history, should this user also be banned from the channel to prevent them from immediately rejoining and continuing the behavior?'
    }
  });

  const ban = result?.answers?.should_ban?.noul ?? 0;
  return { ban: ban >= 0.8, confidence: ban };
}

// ─── Full user assessment (JEVCHECK command) ──────────────────────────────────

/**
 * Full threat/bot/ban-worthy assessment of a connected user.
 * Returns a formatted string for the oper.
 */
export async function assessUser(nick, host, ip, messageHistory = [], channelCount = 0, joinAge = 0) {
  const state = [
    `Nick: ${nick}`,
    `Host: ${host}`,
    `IP: ${ip || 'unknown'}`,
    `Active channels: ${channelCount}`,
    `Connected (minutes): ${joinAge}`,
    messageHistory.length
      ? `Recent messages:\n${messageHistory.slice(-10).map(m => `  [${m.channel}] ${m.text}`).join('\n')}`
      : 'No message history'
  ].join('\n');

  const result = await query(state, {
    threat_level: {
      type: 'score',
      instructions: 'How much of a threat is this user to network stability?',
      criteria: [
        'Normal user, no concern',
        'Slightly suspicious, worth watching',
        'Likely problematic — spammer, bot, or abuser',
        'Clear threat — act immediately'
      ]
    },
    is_bot: {
      type: 'noul',
      instructions: 'Is this user likely an automated bot rather than a human?'
    },
    is_ban_worthy: {
      type: 'noul',
      instructions: 'Does the evidence justify a network ban?'
    },
    recommendation: {
      type: 'choice',
      instructions: 'What should the oper do?',
      criteria: {
        nothing: 'Everything looks normal',
        watch:   'Keep monitoring, no action yet',
        warn:    'Send a warning message to the user',
        kill:    'Disconnect them now with a message',
        kline:   'Ban their host/IP from the network'
      }
    }
  });

  if (!result?.answers) return 'JEV unavailable.';

  const a = result.answers;
  const threatNames = ['No concern', 'Worth watching', 'Likely problematic', 'Act immediately'];
  const threat = a.threat_level?.score ?? 0;
  const threatLabel = threatNames[Math.round(threat)] ?? 'Unknown';

  return [
    `[JEV: ${nick}]`,
    `Threat: ${threatLabel} (${(threat * 100).toFixed(0)}%)`,
    `Bot: ${((a.is_bot?.noul ?? 0) * 100).toFixed(0)}%`,
    `Ban-worthy: ${((a.is_ban_worthy?.noul ?? 0) * 100).toFixed(0)}%`,
    `Rec: ${a.recommendation?.choice ?? 'nothing'} (${((a.recommendation?.confidence ?? 0) * 100).toFixed(0)}% conf)`
  ].join(' | ');
}

// ─── Periodic sweep ───────────────────────────────────────────────────────────

/**
 * Scan all connected users for threats. Returns array of { nick, report } for
 * any user whose threat score is >= 0.5 (worth flagging to oper).
 */
export async function sweepUsers(users) {
  const results = [];
  for (const u of users) {
    const result = await query(
      [
        `Nick: ${u.nick}`,
        `Host: ${u.host}`,
        `Connected minutes: ${u.ageMin}`,
        `Channels: ${u.channelCount}`,
        `Messages sent: ${u.msgCount}`,
        u.recentMsgs?.length ? `Sample messages:\n${u.recentMsgs.slice(-5).join('\n')}` : ''
      ].filter(Boolean).join('\n'),
      {
        threat: {
          type: 'noul',
          instructions: 'Is this user a potential threat to the IRC network? (spammer, bot, abuser, attacker)'
        }
      }
    );
    const score = result?.answers?.threat?.noul ?? 0;
    if (score >= 0.5) {
      results.push({ nick: u.nick, score, flag: score >= 0.8 ? 'HIGH' : 'WATCH' });
    }
  }
  return results;
}

// ─── Open decision (JEVASK command) ──────────────────────────────────────────

/**
 * Ask JEV an open-ended question about the network.
 */
export async function askDecision(state, question) {
  const result = await query(state, {
    decision: {
      type: 'choice',
      instructions: question,
      criteria: {
        yes:    'Yes, do it',
        no:     'No, do not do it',
        maybe:  'Uncertain — gather more information first',
        urgent: 'Yes, and do it immediately'
      }
    },
    context_ok: {
      type: 'noul',
      instructions: 'Is there enough context here to make a confident decision?'
    }
  });

  if (!result?.answers) return 'JEV unavailable.';

  const a = result.answers;
  const decision = a.decision?.choice ?? 'maybe';
  const conf = ((a.decision?.confidence ?? 0) * 100).toFixed(0);
  const ctx = ((a.context_ok?.noul ?? 0) * 100).toFixed(0);
  return `[JEV] ${decision} (${conf}% conf) | context sufficient: ${ctx}%`;
}
