/**
 * Local moderation for Shadow IRC.
 *
 * Replaces the third-party JEV calls. Everything here runs in-process: no
 * message content, nickname, or host ever leaves the machine. That is the
 * point — an anonymous network cannot ship its messages to someone else's API
 * for grading, however good the grading is.
 *
 * The tradeoff is honest: these are heuristics, not judgement. They catch
 * flooding, repetition, link spam and impersonation, which is the large
 * majority of real abuse. They will not catch subtle harassment, and they are
 * deliberately tuned to under-react rather than punish false positives.
 */

const WINDOW_MS = 15_000;       // rolling window for rate/repeat checks
const IDLE_EVICT_MS = 600_000;  // drop per-nick state after 10m of silence

const MAX_MSGS_IN_WINDOW = 10;  // beyond this in WINDOW_MS is flooding
const MAX_EXACT_REPEATS = 3;    // identical message this many times
const MAX_JOINS_IN_WINDOW = 5;  // channel joins in WINDOW_MS
const MAX_URLS_PER_MSG = 3;
const MAX_HIGHLIGHTS = 6;       // nicks addressed in a single message
const CAPS_MIN_LEN = 24;
const CAPS_RATIO = 0.75;

// Escalation: how many offenses before each action.
const WARN_AT = 1;
const KICK_AT = 3;
const BAN_AT = 5;
const OFFENSE_DECAY_MS = 300_000; // an offense stops counting after 5m

const URL_RE = /\bhttps?:\/\/\S+/gi;
const RESERVED_NICKS = [
  'nickserv', 'chanserv', 'memoserv', 'hostserv', 'operserv', 'botserv',
  'shadow', 'admin', 'administrator', 'root', 'operator', 'staff', 'system',
  'security', 'server', 'moderator'
];

function normalize(text) {
  return String(text).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export class LocalModerator {
  constructor() {
    this.messages = new Map(); // nickLower -> [{ at, norm, channel }]
    this.joins = new Map();    // nickLower -> [at]
    this.offenses = new Map(); // nickLower -> [at]
    this.lastSeen = new Map(); // nickLower -> at
  }

  // ─── bookkeeping ──────────────────────────────────────────────────────────

  _touch(key) {
    this.lastSeen.set(key, Date.now());
  }

  _recent(map, key, windowMs = WINDOW_MS) {
    const cutoff = Date.now() - windowMs;
    const list = (map.get(key) || []).filter(e => (e.at ?? e) > cutoff);
    if (list.length) map.set(key, list); else map.delete(key);
    return list;
  }

  /** Drop state for nicks that have gone quiet. Call periodically. */
  sweep() {
    const cutoff = Date.now() - IDLE_EVICT_MS;
    for (const [key, at] of this.lastSeen) {
      if (at > cutoff) continue;
      this.lastSeen.delete(key);
      this.messages.delete(key);
      this.joins.delete(key);
      this.offenses.delete(key);
    }
  }

  /** Forget a nick entirely (on quit, or rename). */
  forget(nick) {
    if (!nick) return;
    const key = nick.toLowerCase();
    this.messages.delete(key);
    this.joins.delete(key);
    this.offenses.delete(key);
    this.lastSeen.delete(key);
  }

  // ─── nick impersonation ───────────────────────────────────────────────────

  /**
   * Catches attempts to pass as services or staff. Exact reserved names are
   * already taken, so this is about lookalikes: NickServ_, ChanS3rv, sh4dow.
   */
  validateNick(nick) {
    const folded = String(nick || '')
      .toLowerCase()
      .replace(/[0-9]+$/, '')            // trailing digits: shadow123 -> shadow
      .replace(/[_\-.\[\]{}^`|\\]/g, '') // IRC decoration: __admin__ -> admin
      // Leetspeak, so ch4nserv collapses to chanserv.
      .replace(/[0@]/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
      .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
      .replace(/[^a-z]/g, '');

    // Exact match only, never substring: bob_shadow folds to "bobshadow",
    // which is somebody's nickname, not an attempt to be "shadow".
    if (RESERVED_NICKS.includes(folded)) {
      return { suspicious: true, reason: `reserved name "${folded}"` };
    }
    return { suspicious: false, reason: '' };
  }

  // ─── join gate ────────────────────────────────────────────────────────────

  /** Rate-limits channel hopping, which is how join floods manifest. */
  evaluateJoin(nick) {
    const key = String(nick || '').toLowerCase();
    this._touch(key);

    const recent = this._recent(this.joins, key);
    recent.push({ at: Date.now() });
    this.joins.set(key, recent);

    if (recent.length > MAX_JOINS_IN_WINDOW) {
      return { allow: false, reason: 'joining channels too quickly' };
    }
    return { allow: true, reason: '' };
  }

  // ─── message screening ────────────────────────────────────────────────────

  /**
   * Returns the same shape the JEV path used, so call sites are unchanged:
   *   { spam, abuse, action: 'ignore'|'warn'|'kick'|'ban', confidence, reason }
   *
   * `members` is optional and only used for the mass-highlight check.
   */
  evaluateMessage(nick, host, channel, message, members = null) {
    const key = String(nick || '').toLowerCase();
    const text = String(message || '');
    this._touch(key);

    const history = this._recent(this.messages, key);
    const norm = normalize(text);
    history.push({ at: Date.now(), norm, channel });
    this.messages.set(key, history);

    const reasons = [];

    // 1. Raw flooding.
    if (history.length > MAX_MSGS_IN_WINDOW) {
      reasons.push(`${history.length} messages in ${WINDOW_MS / 1000}s`);
    }

    // 2. Saying the same thing over and over. Ignore very short messages so
    //    "yes", "lol" and "+1" are not treated as spam.
    if (norm.length >= 8) {
      const repeats = history.filter(h => h.norm === norm).length;
      if (repeats >= MAX_EXACT_REPEATS) {
        reasons.push(`repeated the same message ${repeats}x`);
      }
    }

    // 3. Same message sprayed across several channels.
    if (norm.length >= 8) {
      const channels = new Set(history.filter(h => h.norm === norm).map(h => h.channel));
      if (channels.size >= 3) {
        reasons.push(`same message across ${channels.size} channels`);
      }
    }

    // 4. Link spam.
    const urls = text.match(URL_RE) || [];
    if (urls.length > MAX_URLS_PER_MSG) {
      reasons.push(`${urls.length} links in one message`);
    }

    // 5. Mass highlight — addressing half the channel at once.
    if (members && members.size > 3) {
      const lower = text.toLowerCase();
      let hits = 0;
      for (const member of members) {
        const memberNick = String(member?.nickname || member).replace(/^[@+]/, '').toLowerCase();
        if (memberNick.length >= 3 && lower.includes(memberNick)) hits++;
        if (hits > MAX_HIGHLIGHTS) break;
      }
      if (hits > MAX_HIGHLIGHTS) reasons.push(`highlighted ${hits}+ users at once`);
    }

    if (!reasons.length) {
      // Shouting is annoying but not actionable on its own.
      const letters = text.replace(/[^a-zA-Z]/g, '');
      const caps = text.replace(/[^A-Z]/g, '');
      const shouting = letters.length >= CAPS_MIN_LEN && caps.length / letters.length >= CAPS_RATIO;
      return { spam: 0, abuse: 0, action: 'ignore', confidence: 1, reason: shouting ? 'shouting' : '' };
    }

    const action = this._escalate(key);
    return {
      spam: 1,
      abuse: 0,
      action,
      confidence: 1,
      reason: reasons.join('; ')
    };
  }

  // ─── escalation ───────────────────────────────────────────────────────────

  _escalate(key) {
    const recent = this._recent(this.offenses, key, OFFENSE_DECAY_MS);
    recent.push({ at: Date.now() });
    this.offenses.set(key, recent);

    const n = recent.length;
    if (n >= BAN_AT) return 'ban';
    if (n >= KICK_AT) return 'kick';
    if (n >= WARN_AT) return 'warn';
    return 'ignore';
  }

  /** After a kick: should it become a ban? True for repeat offenders. */
  shouldBanAfterKick(nick) {
    const key = String(nick || '').toLowerCase();
    return this._recent(this.offenses, key, OFFENSE_DECAY_MS).length >= BAN_AT;
  }

  // ─── oper reporting ───────────────────────────────────────────────────────

  /** Plain counters for the CHECK command. No inference, just what was seen. */
  report(nick) {
    const key = String(nick || '').toLowerCase();
    const msgs = this._recent(this.messages, key);
    const offenses = this._recent(this.offenses, key, OFFENSE_DECAY_MS);
    const joins = this._recent(this.joins, key);
    const channels = new Set(msgs.map(m => m.channel).filter(Boolean));

    return [
      `[${nick}]`,
      `msgs/${WINDOW_MS / 1000}s: ${msgs.length}`,
      `joins/${WINDOW_MS / 1000}s: ${joins.length}`,
      `channels: ${channels.size}`,
      `offenses/5m: ${offenses.length}`,
      offenses.length >= KICK_AT ? 'FLAGGED' : 'ok'
    ].join(' | ');
  }

  /** Nicks currently over the warning threshold. */
  flagged() {
    const out = [];
    for (const key of this.offenses.keys()) {
      const n = this._recent(this.offenses, key, OFFENSE_DECAY_MS).length;
      if (n >= KICK_AT) out.push({ nick: key, offenses: n });
    }
    return out.sort((a, b) => b.offenses - a.offenses);
  }
}
