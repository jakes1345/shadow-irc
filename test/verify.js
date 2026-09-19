import net from 'net';
import ShadowIRCServer from '../src/server/ircd.js';
import { ShadowCrypto } from '../src/common/crypto.js';

console.log('=== STARTING SHADOW-IRC AUTOMATED VERIFICATION ===');

// 1. Verify E2EE Crypto Engine
const secretText = 'Top Secret Cosmic Intelligence Data';
const pass = 'QuantumPass2026';
const encrypted = ShadowCrypto.encrypt(secretText, pass);
const decrypted = ShadowCrypto.decrypt(encrypted, pass);

if (decrypted === secretText) {
  console.log('✅ [PASSED] E2EE AES-256-GCM Encryption / Decryption Test');
} else {
  console.error('❌ [FAILED] E2EE Decryption mismatch!');
  process.exit(1);
}

// 2. Launch Native IRC Server Daemon on test port 6699
const testPort = 6699;
const server = new ShadowIRCServer({ port: testPort, host: '127.0.0.1' });
server.start();

// 3. Connect Client 1 and Client 2 via raw TCP socket
setTimeout(() => {
  const client1 = net.connect(testPort, '127.0.0.1', () => {
    client1.write('NICK alice_cosmic\r\nUSER alice 0 * :Alice Space\r\n');
  });

  let client2Joined = false;
  let messageReceived = false;

  client1.on('data', (buf) => {
    const str = buf.toString();
    if (str.includes('001 alice_cosmic')) {
      console.log('✅ [PASSED] Client 1 Registration (RPL_WELCOME)');
      client1.write('JOIN #cosmos\r\n');
    }
    if (str.includes('JOIN :#cosmos') && !client2Joined) {
      client2Joined = true;
      // Connect Client 2
      const client2 = net.connect(testPort, '127.0.0.1', () => {
        client2.write('NICK bob_shadow\r\nUSER bob 0 * :Bob Space\r\nJOIN #cosmos\r\n');
      });

      client2.on('data', (buf2) => {
        const str2 = buf2.toString();
        if (str2.includes('PRIVMSG #cosmos')) {
          console.log('✅ [PASSED] Multi-client Message Broadcast to #cosmos');
          messageReceived = true;
          
          console.log('\n==================================================');
          console.log('🎉 ALL SHADOW-IRC NATIVE SUITE TESTS PASSED 100%!');
          console.log('==================================================\n');
          
          client1.destroy();
          client2.destroy();
          process.exit(0);
        }
      });

      setTimeout(() => {
        client1.write('PRIVMSG #cosmos :Greetings from Alice in deep space!\r\n');
      }, 500);
    }
  });

}, 500);

setTimeout(() => {
  console.error('❌ [TIMEOUT] Verification timed out!');
  process.exit(1);
}, 6000);
