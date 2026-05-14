# Hướng dẫn Phát triển & Triển khai ZaloCRM

Tài liệu này hướng dẫn cách làm việc trên máy Local và quy trình đẩy mã nguồn lên Server (Production).

## I. Môi trường Local (Phát triển)

### 1. Cấu hình Backend (.env)
File `.env` tại máy nhà bạn nên trỏ về database local:
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/zalo_crm"
PORT=3000
JWT_SECRET="save_at_local_secret"
```

### 2. Cấu hình Frontend (.env.development)
File này dùng khi bạn chạy `npm run dev` ở máy nhà:
```env
VITE_API_URL=http://localhost:3000
```

### 3. Lệnh chạy hàng ngày
- **Backend**: `npm run dev` (Sử dụng tsx watch để tự cập nhật khi sửa code).
- **Frontend**: `npm run dev` (Vite dev server).

---

## II. Quy trình Triển khai (Deployment)

Mỗi khi hoàn thành một tính năng mới, hãy thực hiện theo thứ tự sau:

### Bước 1: Đồng bộ Backend (aaPanel)
1. **Upload Code**: Upload các file trong thư mục `src` lên aaPanel (Ghi đè file cũ).
2. **Migration (Nếu có)**: Nếu bạn sửa file `prisma/schema.prisma`, hãy chạy lệnh sau trên Terminal của aaPanel:
   ```bash
   npx prisma migrate deploy
   ```
3. **Restart Service**: Restart dự án trong mục Node Project của aaPanel.

### Bước 2: Triển khai Frontend (DirectAdmin)
1. **Kiểm tra Prod Env**: Đảm bảo file `frontend/.env.production` trỏ về URL API thật:
   `VITE_API_URL=https://crm-zalo-api.dev.web360.vn`
2. **Build**: 
   `cd frontend && npm run build`
3. **Upload**: Upload nội dung thư mục `dist` lên DirectAdmin.

### Bước 3: Kiểm tra & Xóa Cache
- Luôn kiểm tra bằng **Tab ẩn danh** trước.
- Nếu không thấy thay đổi, hãy xóa cache trình duyệt (`Ctrl + F5`) hoặc xóa cache CDN (Cloudflare) nếu có.

---
*Tài liệu này được biên soạn để hỗ trợ quy trình vận hành ZaloCRM.*
