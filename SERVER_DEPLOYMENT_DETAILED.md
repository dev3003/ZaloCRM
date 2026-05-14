# Hướng dẫn Triển khai ZaloCRM: Từ Máy cục bộ lên Server (Chi tiết)

Tài liệu này hướng dẫn cách đóng gói dự án từ máy tính của bạn, đẩy lên Server qua tệp nén (Zip), và cấu hình chạy thực tế.

---

## PHẦN 1: CHUẨN BỊ TRÊN SERVER (Làm 1 lần duy nhất)

Trước khi đẩy code lên, Server của bạn cần cài đặt sẵn:
1. **Node.js (v20+)**: Để chạy code JavaScript.
2. **PostgreSQL**: Hệ quản trị cơ sở dữ liệu.
3. **FFmpeg**: Bắt buộc để xử lý video (Gửi/nhận video).
4. **PM2**: Công cụ giữ cho ứng dụng luôn chạy ngầm (Cài bằng lệnh: `npm install -g pm2`).
5. **Nginx**: Để làm cổng chào và cấu hình tên miền.

---

## PHẦN 2: CẤU HÌNH VÀ ĐÓNG GÓI TẠI MÁY CỦA BẠN

### 1. Đối với Frontend (Giao diện)
*   **File cần cấu hình**: `frontend/.env` (hoặc tệp cấu hình API). Đảm bảo `VITE_API_URL` trỏ về địa chỉ IP hoặc tên miền của Server.
*   **Lệnh build**:
    ```bash
    cd frontend
    npm install
    npm run build
    ```
*   **Đóng gói**: Sau khi build xong, thư mục `dist` sẽ xuất hiện. Bạn **chỉ cần nén thư mục `dist` này** thành tệp `frontend.zip`.

### 2. Đối với Backend (Xử lý)
*   **File cần cấu hình**: `backend/.env.example` -> Đổi tên thành `.env` và điền:
    *   `DATABASE_URL`: Thông tin kết nối DB trên Server.
    *   `PORT`: Ví dụ 3000.
    *   `GEMINI_API_KEY` hoặc `ANTHROPIC_API_KEY`: Bắt buộc để dùng tính năng AI.
*   **Lệnh build**:
    ```bash
    cd backend
    npm install
    npm run build
    ```
*   **Đóng gói**: Bạn nén các thư mục/tệp sau thành `backend.zip`:
    *   Thư mục `dist` (sau khi build).
    *   Thư mục `prisma`.
    *   File `package.json` và `package-lock.json`.
    *   File `.env`.
    *   **LƯU Ý**: KHÔNG nén thư mục `node_modules` (vì nó rất nặng, ta sẽ cài lại trên server).

---

## PHẦN 3: ĐẨY LÊN SERVER VÀ GIẢI NÉN

1. Sử dụng FileZilla hoặc lệnh `scp` để đẩy `frontend.zip` và `backend.zip` lên Server.
2. Giải nén trên Server:
   ```bash
   unzip frontend.zip -d /var/www/zalocrm/frontend
   unzip backend.zip -d /var/www/zalocrm/backend
   ```

---

## PHẦN 4: THIẾT LẬP TRÊN SERVER (SAU KHI GIẢI NÉN)

### 0. Cài đặt FFmpeg (Bắt buộc để xử lý Video)
Nếu server chưa có FFmpeg, hãy chạy lệnh tương ứng với hệ điều hành:

**Cho Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install ffmpeg -y
```

**Cho CentOS/AlmaLinux/RHEL:**
```bash
sudo yum install epel-release -y
sudo yum install ffmpeg ffmpeg-devel -y
```
*(Nếu không được, hãy kiểm tra OS bằng lệnh `cat /etc/os-release` để tìm hướng dẫn cài FFmpeg phù hợp).*

### 1. Cấu hình Database (Lần đầu tiên)
Truy cập vào thư mục backend trên server và chạy:
```bash
cd /var/www/zalocrm/backend
npm install --production  # Cài đặt thư viện (nhanh vì không cài dev)
npx prisma generate       # Khởi tạo bộ máy Prisma
npx prisma migrate deploy # Đẩy cấu trúc bảng vào Database của Server
```

### 2. Chạy Backend bằng PM2
```bash
pm2 start dist/app.js --name "zalocrm-api"
pm2 save                  # Lưu lại để tự khởi động khi server restart
```

### 3. Cấu hình Frontend (Nginx)
Vì Frontend đã build ra tệp tĩnh (`index.html`, `js`, `css`), ta không cần chạy lệnh gì cho nó. Chỉ cần trỏ Nginx vào thư mục `dist` đã giải nén:

Mở file cấu hình Nginx: `sudo nano /etc/nginx/sites-available/zalocrm`
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /var/www/zalocrm/frontend/dist; # Trỏ vào đây
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000; # Trỏ về Backend đang chạy PM2
        # ... các cấu hình header khác
    }
}
```
Sau đó khởi động lại Nginx: `sudo systemctl restart nginx`

---

## TÓM TẮT CÁC LỆNH CẦN NHỚ TRÊN SERVER

| Mục đích | Lệnh |
|----------|------|
| Kiểm tra ứng dụng | `pm2 status` |
| Xem lỗi Backend | `pm2 logs zalocrm-api` |
| Khởi động lại | `pm2 restart zalocrm-api` |
| Sửa cấu hình DB | `nano .env` (trong thư mục backend) |

---
*Hướng dẫn này giúp bạn triển khai một cách chuyên nghiệp, tiết kiệm dung lượng truyền tải và dễ dàng quản lý lỗi.*
