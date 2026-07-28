import { Zalo } from 'zca-js';
const zalo = new Zalo();
console.log('Testing Zalo instance methods');
const api = await zalo.loginQR({}, (event) => {
  if (event.type === 0) {
    console.log("Got QR code. Need to scan it, but I just want to inspect the prototype.");
    process.exit(0);
  }
});
