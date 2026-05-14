# Hướng dẫn Triển khai ZaloCRM trên Server (Ubuntu/Linux)

Tài liệu này hướng dẫn chi tiết cách cài đặt và chạy dự án ZaloCRM trên môi trường Production.

## 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 20 trở lên.
- **Cơ sở dữ liệu**: PostgreSQL.
- **Quản lý quy trình**: PM2 (khuyên dùng).
- **Web Server**: Nginx (để làm Reverse Proxy).

---

## 2. Chuẩn bị môi trường

### Cài đặt Node.js & NPM (Sử dụng NVM)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v # Kiểm tra phiên bản
```

### Cài đặt PM2
```bash
npm install -g pm2
```

---

## 3. Cài đặt Backend

Di chuyển vào thư mục backend:
```bash
cd backend
npm install
```

### Cấu hình biến môi trường
Sao chép file mẫu và chỉnh sửa:
```bash
cp .env.example .env
nano .env
```
Cần lưu ý các thông số quan trọng:
- `DATABASE_URL`: Đường dẫn kết nối PostgreSQL.
- `JWT_SECRET`: Chuỗi bảo mật JWT.
- `UPLOAD_DIR`: Thư mục lưu trữ file (đảm bảo thư mục này tồn tại và có quyền ghi).

### Khởi tạo Database (Prisma)
```bash
npx prisma generate
npx prisma migrate deploy
```

### Build dự án
```bash
npm run build
```

---

## 4. Cài đặt Frontend

Di chuyển vào thư mục frontend:
```bash
cd ../frontend
npm install
```

### Build dự án
Dự án sử dụng Vite, khi build sẽ tạo ra thư mục `dist`.
```bash
npm run build
```

---

## 5. Chạy ứng dụng với PM2

### Chạy Backend
Quay lại thư mục backend và khởi chạy:
```bash
cd ../backend
pm2 start dist/app.js --name "zalocrm-backend"
```

---

## 6. Cấu hình Nginx (Reverse Proxy)

Tạo file cấu hình mới:
```bash
sudo nano /etc/nginx/sites-available/zalocrm
```

Cấu hình mẫu:
```nginx
server {
    listen 80;
    server_name your-domain.com; # Thay bằng tên miền của bạn

    # Frontend (Serve tệp tĩnh từ thư mục dist)
    location / {
        root /path/to/your/project/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000; # Cổng chạy backend
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io support
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

Kích hoạt cấu hình và restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/zalocrm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 7. Các lệnh bảo trì thường dùng

- Xem log backend: `pm2 logs zalocrm-backend`
- Restart backend: `pm2 restart zalocrm-backend`
- Xem trạng thái: `pm2 status`
