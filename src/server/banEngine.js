/**
 * SHADOW-IRC Ban Mask Engine
 * Wildcard matching over nick!user@host. No CIDR support: a mask such as
 * *!*@10.0.0.0/8 is matched literally, so it will not ban the subnet.
 */

export class BanEngine {
  /**
   * Normalize a mask to full nick!user@host form.
   */
  static normalizeMask(mask) {
    if (!mask.includes('!')) return `${mask}!*@*`;
    if (!mask.includes('@')) return `${mask}@*`;
    return mask;
  }

  /**
   * Wildcard match supporting * and ?.
   *
   * Deliberately not a regex. Translating '*' to '.*' gives masks like
   * *a*a*a*a*b catastrophic backtracking, and any channel op can set a ban
   * mask — that would be a whole-network CPU stall on a single-process daemon.
   * This two-pointer scan has no backtracking blowup.
   */
  static globMatch(text, pattern) {
    let t = 0, p = 0, star = -1, tAtStar = 0;

    while (t < text.length) {
      if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
        t++; p++;
      } else if (p < pattern.length && pattern[p] === '*') {
        star = p++;
        tAtStar = t;
      } else if (star !== -1) {
        p = star + 1;
        t = ++tAtStar;
      } else {
        return false;
      }
    }

    while (p < pattern.length && pattern[p] === '*') p++;
    return p === pattern.length;
  }

  /**
   * Test if a client (nick!user@host) matches a given ban mask
   */
  static matches(client, banMask) {
    if (!client || !banMask || typeof banMask !== 'string') return false;
    const clientHostmask = `${client.nickname || '*'}!${client.username || '*'}@${client.hostname || client.ip || '*'}`;
    return this.globMatch(
      clientHostmask.toLowerCase(),
      this.normalizeMask(banMask).toLowerCase()
    );
  }

  /**
   * Check if client is banned in channel
   */
  static isBanned(client, channel) {
    if (!channel || !channel.bans || channel.bans.size === 0) return false;
    
    // Ops and server opers bypass channel bans
    if (channel.ops && channel.ops.has(client)) return false;
    if (client.isOper) return false;

    for (const banMask of channel.bans) {
      if (this.matches(client, banMask)) {
        return true;
      }
    }
    return false;
  }
}
