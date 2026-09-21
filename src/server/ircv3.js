/**
 * SHADOW-IRC IRCv3 Subsystem & Scrollback History Ring Buffer
 * Specifications: server-time, echo-message, message-tags, chathistory, sasl, account-notify, extended-join
 */

export class IRCv3HistoryEngine {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.channelHistory = new Map(); // channelLower -> Array of HistoryItem
  }

  addMessage(channelName, senderNick, message, isNotice = false) {
    const chanLower = channelName.toLowerCase();
    if (!this.channelHistory.has(chanLower)) {
      this.channelHistory.set(chanLower, []);
    }
    const history = this.channelHistory.get(chanLower);

    const item = {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      time: new Date().toISOString(),
      senderNick,
      message,
      isNotice
    };

    history.push(item);
    if (history.length > this.maxSize) {
      history.shift(); // Evict oldest
    }
    return item;
  }

  getHistory(channelName, count = 50) {
    const chanLower = channelName.toLowerCase();
    const history = this.channelHistory.get(chanLower) || [];
    return history.slice(-count);
  }

  clearAllHistory() {
    for (const [key, history] of this.channelHistory.entries()) {
      for (const item of history) {
        item.message = '';
        item.senderNick = '';
      }
      history.length = 0;
    }
    this.channelHistory.clear();
  }
}

export class IRCv3CapNegotiator {
  static supportedCaps = [
    'server-time',
    'echo-message',
    'message-tags',
    'chathistory',
    'account-notify',
    'extended-join'
  ];

  static handleCap(client, subCommand, capArgs, sendFunc) {
    const sub = (subCommand || '').toUpperCase();
    if (sub === 'LS') {
      sendFunc(`:shadow.cosmos.net CAP * LS :${this.supportedCaps.join(' ')}`);
    } else if (sub === 'REQ') {
      const requested = (capArgs || '').split(/\s+/).filter(Boolean);
      const acked = [];
      const nacked = [];

      for (const cap of requested) {
        if (this.supportedCaps.includes(cap)) {
          acked.push(cap);
          if (!client.enabledCaps) client.enabledCaps = new Set();
          client.enabledCaps.add(cap);
        } else {
          nacked.push(cap);
        }
      }

      if (acked.length > 0) {
        sendFunc(`:shadow.cosmos.net CAP ${client.nickname || '*'} ACK :${acked.join(' ')}`);
      }
      if (nacked.length > 0) {
        sendFunc(`:shadow.cosmos.net CAP ${client.nickname || '*'} NAK :${nacked.join(' ')}`);
      }
    } else if (sub === 'END') {
      // CAP negotiation complete
      client.capEnd = true;
    }
  }
}
