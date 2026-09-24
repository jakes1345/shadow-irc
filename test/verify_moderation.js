import { LocalModerator } from '../src/server/moderation.js';

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`); }
};

console.log('=== LOCAL MODERATION ===\n');

// ── nick impersonation ──────────────────────────────────────────────────────
// The false-positive cases matter more than the true positives here: wrongly
// rejecting a nick blocks registration entirely.
{
  const m = new LocalModerator();
  const flagged = n => m.validateNick(n).suspicious;

  ok('flags exact reserved name',        flagged('nickserv'));
  ok('flags decorated reserved name',    flagged('__admin__'));
  ok('flags leetspeak reserved name',    flagged('ch4nserv'));
  ok('flags trailing-digit variant',     flagged('shadow123'));

  ok('allows reserved word inside nick', !flagged('bob_shadow'));
  ok('allows compound nick',             !flagged('shadowhunter'));
  ok('allows ordinary nick',             !flagged('alice_cosmic'));
  ok('allows short nick',                !flagged('jak'));
}

// ── message flooding ────────────────────────────────────────────────────────
{
  const m = new LocalModerator();
  let last;
  for (let i = 0; i < 12; i++) {
    last = m.evaluateMessage('spammer', 'host', '#chan', `unique message ${i}`);
  }
  ok('flags raw flooding', last.action !== 'ignore');
}

{
  const m = new LocalModerator();
  let last;
  for (let i = 0; i < 4; i++) {
    last = m.evaluateMessage('repeater', 'host', '#chan', 'buy my product now');
  }
  ok('flags repeated message', last.action !== 'ignore');
}

{
  const m = new LocalModerator();
  // Short interjections repeat legitimately and must not trip the check.
  let last;
  for (let i = 0; i < 4; i++) {
    last = m.evaluateMessage('chatty', 'host', '#chan', 'lol');
  }
  ok('allows repeated short words', last.action === 'ignore');
}

{
  const m = new LocalModerator();
  const v = m.evaluateMessage('linker', 'host', '#chan',
    'http://a.com http://b.com http://c.com http://d.com');
  ok('flags link spam', v.action !== 'ignore');
}

{
  const m = new LocalModerator();
  const v = m.evaluateMessage('normal', 'host', '#chan', 'hey has anyone seen the docs for this');
  ok('allows ordinary message', v.action === 'ignore');
}

// ── escalation ──────────────────────────────────────────────────────────────
{
  const m = new LocalModerator();
  const actions = [];
  for (let i = 0; i < 30; i++) {
    const v = m.evaluateMessage('escalator', 'host', '#chan', 'same spam text here');
    if (v.action !== 'ignore') actions.push(v.action);
  }
  ok('escalates warn -> kick -> ban',
    actions.includes('warn') && actions.includes('kick') && actions.includes('ban'));
  ok('repeat offender bans after kick', m.shouldBanAfterKick('escalator'));
  ok('clean user does not ban after kick', !m.shouldBanAfterKick('someoneelse'));
}

// ── join flooding ───────────────────────────────────────────────────────────
{
  const m = new LocalModerator();
  let denied = false;
  for (let i = 0; i < 8; i++) {
    if (!m.evaluateJoin('hopper').allow) denied = true;
  }
  ok('flags join flooding', denied);

  const m2 = new LocalModerator();
  ok('allows normal joins',
    m2.evaluateJoin('user').allow && m2.evaluateJoin('user').allow);
}

// ── state cleanup ───────────────────────────────────────────────────────────
{
  const m = new LocalModerator();
  m.evaluateMessage('temp', 'host', '#chan', 'hello there friends');
  m.forget('temp');
  ok('forget clears per-nick state', m.report('temp').includes('msgs/15s: 0'));
}

// ── no network ──────────────────────────────────────────────────────────────
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/server/moderation.js', import.meta.url), 'utf8');
  const reachesOut = /\bfetch\s*\(|https?\.request\s*\(|net\.connect\s*\(/.test(src);
  ok('makes no outbound calls', !reachesOut);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
