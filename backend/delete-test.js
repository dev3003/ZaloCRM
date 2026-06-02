import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = '0969363713'; // Số điện thoại Khách ERP
  const name = 'Ngo xuan thuy'; // Tên khách hàng thứ 2

  console.log('Đang tìm kiếm các bản ghi rác...');

  // Xóa các khách hàng có SĐT này hoặc có tên này
  const result = await prisma.contact.deleteMany({
    where: {
      OR: [
        { phone: phone },
        { fullName: name },
        { adminCustomerId: '23112409477987' } // Mã cid test của bạn
      ]
    }
  });

  console.log(`Đã xóa thành công ${result.count} khách hàng test!`);
  console.log('Bây giờ bạn có thể chạy lại file test-link.js để kiểm tra luồng mới.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
