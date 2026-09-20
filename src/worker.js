/**
 * Cloudflare Worker — serves the Shadow IRC landing page at shadowspace.space
 * and proxies WebSocket connections to the IRC server on app.shadowspace.space
 */

import HTML from '../website/index.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve logo
    if (url.pathname === '/logo.png') {
      return fetch('https://app.shadowspace.space/logo.png');
    }

    // Serve landing page
    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
};
