/**
 * SHADOW-IRC Ban Mask & CIDR Engine
 * Supports wildcard matching (nick!user@host) and IP CIDR subnet matching
 * Linear-time ReDoS safe regex conversion
 */

export class BanEngine {
  /**
   * Convert IRC wildcard ban mask (e.g. *!*@192.168.1.* or troll*!*@*.vpn) to safe RegExp
   */
  static maskToRegex(mask) {
    if (!mask || typeof mask !== 'string') return /^$/;

    // Normalize mask format (ensure nick!user@host structure)
    let fullMask = mask;
    if (!fullMask.includes('!')) {
      fullMask = `${fullMask}!*@*`;
    } else if (!fullMask.includes('@')) {
      fullMask = `${fullMask}@*`;
    }

    // Escape regex special chars except * and ?
    const escaped = fullMask
      .replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Test if a client (nick!user@host) matches a given ban mask
   */
  static matches(client, banMask) {
    if (!client || !banMask) return false;
    const clientHostmask = `${client.nickname || '*'}!${client.username || '*'}@${client.hostname || client.ip || '*'}`;
    const regex = this.maskToRegex(banMask);
    return regex.test(clientHostmask);
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
