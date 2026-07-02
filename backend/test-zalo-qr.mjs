import { Zalo } from 'zca-js';

async function testQR() {
  const zalo = new Zalo({ logging: true });
  console.log('Starting loginQR...');
  try {
    const api = await zalo.loginQR({}, (event) => {
      console.log('Event type:', event.type);
      if (event.type === 0) {
        console.log('Keys in event.data:', Object.keys(event.data || {}));
        process.exit(0);
      }
    });
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testQR();
