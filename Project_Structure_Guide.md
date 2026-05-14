# Hướng dẫn Cấu trúc Dự án ZaloCRM (Node.js & Vue.js)

Tài liệu này dành cho người mới bắt đầu để hiểu cách tổ chức một dự án thực tế.

## 1. Backend (The Logic)
Nén sức mạnh của Server vào các thành phần chính:

- **src/app.ts**: Trái tim của Server. Nơi cấu hình CORS, kết nối Database và gọi các Route.
- **src/modules**: Chia dự án thành các khối độc lập. Nếu bạn muốn thêm tính năng "Quản lý Đơn hàng", hãy tạo thư mục `src/modules/orders`.
    - `*-routes.ts`: Định nghĩa các đường link API (URL).
    - `*-service.ts`: Nơi viết code xử lý logic "xương thịt" (tổng hợp dữ liệu, tính toán).
- **prisma/schema.prisma**: Bản vẽ của toàn bộ Database. Muốn thêm một trường thông tin cho khách hàng (ví dụ: Ngày sinh), bạn phải vào đây thêm và chạy `npx prisma migrate dev`.

## 2. Frontend (The Interface)
Giao diện người dùng được xây dựng từ các thành phần:

- **src/pages**: Mỗi file đại diện cho một màn hình lớn người dùng nhìn thấy.
- **src/components**: Các thành phần giao diện nhỏ (như cái ô nhập tin nhắn, cái ảnh đại diện). Hãy giữ chúng nhỏ và sạch sẽ để dùng lại nhiều nơi.
- **src/api**: Thay vì viết code gọi server rải rác khắp nơi, hãy viết tập trung ở đây để khi backend đổi link, bạn chỉ cần sửa 1 chỗ.
- **src/stores**: Nơi lưu trữ thông tin "tạm thời" nhưng quan trọng (như thông tin user hiện tại, danh sách tin nhắn mới nhất).

## 3. Quy tắc "Bất di bất dịch" khi phát triển
1. **DRY (Don't Repeat Yourself)**: Nếu một đoạn code dùng 2 lần, hãy tách nó ra thành hàm hoặc component dùng chung.
2. **Environment Variables**: KHÔNG BAO GIỜ viết cứng mật khẩu hay địa chỉ server vào code. Luôn dùng `.env`.
3. **Async/Await**: Luôn dùng cơ chế này khi làm việc với Database hoặc API để đảm bảo ứng dụng không bị "đơ" khi đang chờ dữ liệu.

---
*Bản hướng dẫn này giúp bạn tự tin hơn khi mở rộng ZaloCRM hoặc bắt đầu dự án thứ 2 của riêng mình.*
