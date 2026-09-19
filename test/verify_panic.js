import net from 'net';
import ShadowIRCServer from '../src/server/ircd.js';
import fs from 'fs';

async function testPanic() {
  console.log("=== TESTING ANTI-FORENSIC /panic PURGE ===");
  const server = new ShadowIRCServer({ port: 6699, webPort: 8099 });
  server.start();

  await new Promise(r => setTimeout(r, 300));

  const client = net.connect(6699, '127.0.0.1');

  client.on('connect', () => {
    client.write('NICK operuser\r\nUSER operuser 0 * :Oper User\r\nOPER admin cosmicsecret\r\n');
    setTimeout(() => {
      console.log("Triggering /panic...");
      client.write('PANIC\r\n');
    }, 400);
  });

  client.on('data', (data) => {
    const str = data.toString();
    console.log("RECV:", str.trim());
  });

  await new Promise(r => setTimeout(r, 1200));
  
  if (server.history.channelHistory.size === 0 && server.clients.size === 0) {
    console.log("✅ [PASSED] /panic Purged all in-memory buffers and disconnected socket links cleanly!");
  } else {
    console.error("❌ [FAILED] Panic purge left artifacts in memory!");
    process.exit(1);
  }

  process.exit(0);
}

testPanic();
