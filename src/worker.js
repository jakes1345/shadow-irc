/**
 * Cloudflare Worker Adapter for SHADOW-IRC 4.0 Space Edition
 * 24/7 Serverless Edge Bridge for WebSockets & Landing Page
 */

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    
    // Handle WebSocket Connections
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      server.accept();
      
      server.addEventListener('message', event => {
        const msg = event.data;
        if (typeof msg === 'string') {
          // Echo / PING pong for health check
          if (msg.startsWith('PING')) {
            server.send('PONG :shadowspace.space\r\n');
          } else {
            // Echo back or process commands
            server.send(`:shadowspace.space NOTICE * :*** Connected to Cloudflare 24/7 Edge Node for shadowspace.space\r\n`);
          }
        }
      });
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Serve 403 Forbidden for non-WS HTTP requests to enforce privacy
    return new Response('403 Forbidden: SHADOW-IRC Private Node (Tauri Desktop App & Terminal Only)', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
