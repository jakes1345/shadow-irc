/**
 * SHADOW-IRC ZNC-Style Bouncer & Session Persistence Engine
 * Keeps sessions connected 24/7 and buffers unread messages while offline
 */

export class BouncerEngine {
  constructor() {
    this.detachedSessions = new Map(); // nickLower -> DetachedSessionState
  }

  detachSession(client, reason = 'Client Detached (Bouncer Active)') {
    if (!client || !client.nickname || !client.registered || !client.account) {
      return false;
    }

    const nickLower = client.nickname.toLowerCase();
    
    const session = {
      id: client.id,
      account: client.account,
      nickname: client.nickname,
      username: client.username,
      realname: client.realname,
      hostname: client.hostname,
      channels: new Set(client.channels),
      isOper: client.isOper,
      detachedAt: Date.now(),
      offlineBuffer: [] // Array of PRIVMSG / NOTICE lines received while offline
    };

    this.detachedSessions.set(nickLower, session);
    return true;
  }

  isDetached(nickname) {
    if (!nickname) return false;
    return this.detachedSessions.has(nickname.toLowerCase());
  }

  clearAllBouncerData() {
    for (const session of this.detachedSessions.values()) {
      if (session.offlineBuffer) {
        for (const item of session.offlineBuffer) {
          item.line = '';
        }
        session.offlineBuffer.length = 0;
      }
    }
    this.detachedSessions.clear();
  }

  bufferMessage(targetNick, messageLine) {
    const session = this.detachedSessions.get(targetNick.toLowerCase());
    if (session) {
      session.offlineBuffer.push({
        time: new Date().toISOString(),
        line: messageLine
      });
      // Cap offline buffer at 200 items per user
      if (session.offlineBuffer.length > 200) {
        session.offlineBuffer.shift();
      }
    }
  }

  reattachSession(client, newSocket, sendFunc) {
    const nickLower = client.nickname.toLowerCase();
    const session = this.detachedSessions.get(nickLower);
    if (!session) return null;

    // Restore channels
    client.channels = new Set(session.channels);
    client.isOper = session.isOper;

    // Send playback of offline messages
    if (session.offlineBuffer.length > 0) {
      sendFunc(`:shadow.cosmos.net NOTICE ${client.nickname} :*** BOUNCER PLAYBACK: Flushing ${session.offlineBuffer.length} offline messages ***`);
      for (const item of session.offlineBuffer) {
        sendFunc(`@time=${item.time} ${item.line}`);
      }
      sendFunc(`:shadow.cosmos.net NOTICE ${client.nickname} :*** BOUNCER PLAYBACK COMPLETE ***`);
    }

    this.detachedSessions.delete(nickLower);
    return session;
  }
}
