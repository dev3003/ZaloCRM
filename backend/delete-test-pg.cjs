const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Đã kết nối Database!');

    const res = await client.query(`
      DELETE FROM contacts 
      WHERE phone = '0969363713' 
         OR full_name = 'Ngo xuan thuy' 
         OR admin_customer_id = '23112409477987'
    `);
    
    console.log(`Đã xóa thành công ${res.rowCount} khách hàng rác!`);
    console.log('Bây giờ bạn có thể test lại từ đầu.');
  } catch (err) {
    console.error('Lỗi khi xóa:', err.message);
  } finally {
    await client.end();
  }
}

main();
