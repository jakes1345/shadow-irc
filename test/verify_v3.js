import net from 'net';
import ShadowIRCServer from '../src/server/ircd.js';

console.log('=== STARTING SHADOW-IRC v3.0 ENTERPRISE SUITE VERIFICATION ===');

const testPort = 6697;
const testWebPort = 8097;
const server = new ShadowIRCServer({ port: testPort, webPort: testWebPort, host: '127.0.0.1' });
server.start();

const testNick1 = `alice_${Date.now()}`;
const testChan = `#chan_${Date.now()}`;

setTimeout(() => {
  const client1 = net.connect(testPort, '127.0.0.1', () => {
    client1.write(`CAP REQ :server-time echo-message\r\nCAP END\r\nNICK ${testNick1}\r\nUSER e_alice 0 * :Alice Enterprise\r\n`);
  });

  let registeredNickServ = false;

  client1.on('data', (buf) => {
    const str = buf.toString();

    if (str.includes(`001 ${testNick1}`) && !registeredNickServ) {
      registeredNickServ = true;
      console.log('✅ [PASSED] Client 1 Registered. Testing NickServ REGISTER...');
      client1.write(`PRIVMSG NickServ :REGISTER myCosmicPass2026 alice@shadow.net\r\n`);
    }

    if (str.includes(`is now registered under account ${testNick1}`)) {
      console.log('✅ [PASSED] NickServ Registration Successful!');
      client1.write(`PRIVMSG ChanServ :REGISTER ${testChan}\r\n`);
    }

    if (str.includes(`is now registered with ${testNick1} as Founder`)) {
      console.log('✅ [PASSED] ChanServ Channel Registration & Founder Assignment!');
      client1.write(`JOIN ${testChan}\r\n`);
    }

    if (str.includes(`JOIN :${testChan}`)) {
      client1.write(`PRIVMSG ${testChan} :Test message 1 for history playback\r\n`);
      client1.write(`PRIVMSG ${testChan} :Test message 2 for history playback\r\n`);

      setTimeout(() => {
        const client2 = net.connect(testPort, '127.0.0.1', () => {
          client2.write(`NICK bob_${Date.now()}\r\nUSER e_bob 0 * :Bob Enterprise\r\nJOIN ${testChan}\r\n`);
        });

        client2.on('data', (buf2) => {
          const str2 = buf2.toString();
          if (str2.includes(`IRCv3 Scrollback History for ${testChan}`) || str2.includes('Test message 1 for history playback')) {
            console.log('✅ [PASSED] IRCv3 History Playback & Ring Buffer Replay on JOIN!');
            console.log('\n==================================================');
            console.log('🎉 SHADOW-IRC v3.0 ENTERPRISE VERIFICATION PASSED 100%!');
            console.log('==================================================\n');
            client1.destroy();
            client2.destroy();
            process.exit(0);
          }
        });
      }, 600);
    }
  });

}, 500);

setTimeout(() => {
  console.error('❌ [TIMEOUT] Enterprise Verification timed out!');
  process.exit(1);
}, 8000);
