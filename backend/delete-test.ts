import 'dotenv/config';
import { prisma } from './src/shared/database/prisma-client.js';

async function main() {
  const phone = '0969363713'; 
  const name = 'Ngo xuan thuy'; 

  console.log('Đang tìm kiếm các bản ghi rác...');

  const result = await prisma.contact.deleteMany({
    where: {
      OR: [
        { phone: phone },
        { fullName: name },
        { adminCustomerId: '23112409477987' } 
      ]
    }
  });

  console.log(`Đã xóa thành công ${result.count} khách hàng test!`);
  console.log('Bây giờ bạn có thể chạy lại file test-link.js để kiểm tra luồng mới.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
