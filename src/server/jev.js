/**
 * JEV (TypeSafe AI System One) — Decision engine for Shadow IRC
 * POST https://api.typesafe.ai/v1/systemone
 *
 * Used for: spam detection, ban decisions, user trust scoring, network health.
 * All calls are async and non-blocking — never hold up message routing.
 */

const API_URL = 'https://api.typesafe.ai/v1/systemone';

async function query(state, questions) {
  const key = process.env.JEV_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Evaluate a channel message for spam/abuse.
 * Returns { spam: 0-1, abuse: 0-1, action: 'ignore'|'warn'|'kick'|'ban' }
 * or null if JEV is unavailable.
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
    spam:   result.answers.spam?.noul   ?? 0,
    abuse:  result.answers.abuse?.noul  ?? 0,
    action: result.answers.action?.choice ?? 'ignore',
    confidence: result.answers.action?.confidence ?? 0
  };
}

/**
 * Run a full decision matrix on a user.
 * Used by the JEVCHECK oper command.
 * Returns a structured assessment string to send back to the oper.
 */
export async function assessUser(nick, host, ip, messageHistory = [], joinCount = 0, joinAge = 0) {
  const state = [
    `Nick: ${nick}`,
    `Host: ${host}`,
    `IP: ${ip || 'unknown'}`,
    `Channel joins (last hour): ${joinCount}`,
    `Account age (minutes): ${joinAge}`,
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
        'Clear threat — ban immediately'
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
        watch:   'Keep monitoring, no action yet',
        warn:    'Send a warning message to the user',
        kill:    'Disconnect them now with a message',
        kline:   'Ban their host/IP from the network',
        nothing: 'Everything looks normal'
      }
    }
  });

  if (!result?.answers) return 'JEV unavailable.';

  const a = result.answers;
  const threatNames = ['No concern', 'Worth watching', 'Likely problematic', 'Clear threat'];
  const threat = a.threat_level?.score ?? 0;
  const threatLabel = threatNames[Math.round(threat)] ?? 'Unknown';

  return [
    `[JEV Assessment: ${nick}]`,
    `Threat level: ${threatLabel} (${(threat * 100).toFixed(0)}%)`,
    `Bot probability: ${((a.is_bot?.noul ?? 0) * 100).toFixed(0)}%`,
    `Ban-worthy: ${((a.is_ban_worthy?.noul ?? 0) * 100).toFixed(0)}%`,
    `Recommendation: ${a.recommendation?.choice ?? 'nothing'} (confidence ${((a.recommendation?.confidence ?? 0) * 100).toFixed(0)}%)`
  ].join(' | ');
}

/**
 * Ask JEV an open-ended decision question about the network.
 * Used by the JEVASK oper command.
 * state: freeform context string the oper provides
 * question: the question to ask
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
    confidence_note: {
      type: 'noul',
      instructions: 'Is there enough context to make a confident decision?'
    }
  });

  if (!result?.answers) return 'JEV unavailable.';

  const a = result.answers;
  const decision = a.decision?.choice ?? 'maybe';
  const conf = ((a.decision?.confidence ?? 0) * 100).toFixed(0);
  const enough = ((a.confidence_note?.noul ?? 0) * 100).toFixed(0);
  return `[JEV] Decision: ${decision} (${conf}% confident) | Context sufficient: ${enough}%`;
}
