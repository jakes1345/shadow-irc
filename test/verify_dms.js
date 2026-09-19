import net from 'net';
import ShadowIRCServer from '../src/server/ircd.js';

async function testDirectMessages() {
  console.log("=== TESTING DIRECT 1-ON-1 MESSAGING (DMs) ===");
  const server = new ShadowIRCServer({ port: 6698, webPort: 8098 });
  server.start();

  await new Promise(r => setTimeout(r, 300));

  let aliceRecv = [];
  let bobRecv = [];

  const alice = net.connect(6698, '127.0.0.1');
  alice.on('connect', () => {
    alice.write('NICK Alice\r\nUSER Alice 0 * :Alice User\r\n');
  });
  alice.on('data', d => aliceRecv.push(d.toString()));

  const bob = net.connect(6698, '127.0.0.1');
  bob.on('connect', () => {
    bob.write('NICK Bob\r\nUSER Bob 0 * :Bob User\r\n');
  });
  bob.on('data', d => bobRecv.push(d.toString()));

  await new Promise(r => setTimeout(r, 500));

  console.log("Alice sending 1-on-1 DM to Bob...");
  alice.write('PRIVMSG Bob :Hello Bob this is a private 1-on-1 DM!\r\n');

  await new Promise(r => setTimeout(r, 500));

  const bobGotMessage = bobRecv.some(l => l.includes('PRIVMSG Bob :Hello Bob this is a private 1-on-1 DM!'));

  if (bobGotMessage) {
    console.log("✅ [PASSED] Direct 1-on-1 DM delivered from Alice to Bob!");
  } else {
    console.error("❌ [FAILED] Direct DM failed delivery!");
    process.exit(1);
  }

  process.exit(0);
}

testDirectMessages();
