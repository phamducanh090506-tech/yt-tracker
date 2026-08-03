# Bắt đầu từ đâu?

Đây là bản sao sạch, chưa có dữ liệu/tài khoản nào của bên bàn giao. Làm theo đúng
thứ tự các bước dưới — không cần biết lập trình, chỉ cần làm đúng theo hướng dẫn.
Chi tiết từng bước xem trong `README.md`.

- [ ] **Bước 1** — Tạo YouTube Data API key. (README mục 2)
- [ ] **Bước 2** — Đưa code này lên 1 GitHub repo **mới** dưới tài khoản của bạn. (README mục 3)
- [ ] **Bước 3** — Thêm API key vào GitHub Secrets của repo đó. (README mục 4)
- [ ] **Bước 4** — Tạo 1 GitHub Personal Access Token. (README mục 5)
- [ ] **Bước 5** — Deploy lên Vercel, nhập 3 biến môi trường (`GITHUB_TOKEN`,
      `GITHUB_OWNER`, `GITHUB_REPO`). (README mục 6)
- [ ] **Bước 6** — Vào trang web vừa deploy → bấm nút **"Quản lý kênh"** → thêm kênh
      YouTube thật của bạn (xoá kênh mẫu đi). Không cần vào GitHub, không cần sửa
      file nào cả. (README mục 7 và 9)
- [ ] **Bước 7 (tuỳ chọn)** — Đồng bộ dữ liệu sang Google Sheets bằng script
      `sync-to-google-sheets.gs.txt` (gửi kèm riêng, ngoài repo này).

Sau bước 5, **mọi việc về sau chỉ cần thao tác trên trang web** — thêm kênh, thêm
tab, xoá kênh, chạy fetch lại — không cần đụng gì tới GitHub hay code nữa.

Không có mật khẩu nào để nhớ. Không có API key nào lộ ra trình duyệt trừ Gemini key
(người dùng tự nhập, tự lưu trên máy họ, không liên quan tới server).
