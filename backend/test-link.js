import crypto from 'node:crypto';

async function main() {
  // BƯỚC 1: Lấy erp_decrypt_key từ DB của CRM (Bảng AppSetting) và dán vào đây
  const key = 'ERPCRMZALO123456';

  if (key === '1212313212231231231231321') {
    console.log('Vui lòng thay thế chuỗi key dòng số 5 trước khi chạy!');
    return;
  }

  // BƯỚC 2: Nhập số điện thoại thật của bạn để test (nhớ bỏ số 0 ở đầu nếu cần thiết tùy hệ thống, nhưng Zalo thường nhận 09...)
  const phone = '0966990354';

  const keyBuf = Buffer.from(key.substring(0, 16), 'utf8');
  const iv = Buffer.from(key.substring(0, 16), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', keyBuf, iv);
  const encrypted = cipher.update(phone, 'utf8', 'base64') + cipher.final('base64');

  // Các thông số giả định từ ERP
  const cid = '28113412374956';
  const sid = '23052908464277';

  // Bạn có thể sửa URL này thành domain thật của server test của bạn (VD: https://crm-zalo.dev.web360.vn)
  const url = `https://crm-zalo.dev.web360.vn/chat?cid=${cid}&sid=${sid}&phone=${encodeURIComponent(encrypted)}`;

  console.log('--- KẾT QUẢ TEST LINK ---');
  console.log('Key mã hóa:', key);
  console.log('SĐT gốc:', phone);
  console.log('Test URL:', url);
  console.log('---------------------------------');
  console.log('=> BƯỚC TIẾP THEO: Hãy copy Test URL trên và dán vào trình duyệt (nhớ đăng nhập CRM trước nhé)!');
}

main().catch(console.error);
