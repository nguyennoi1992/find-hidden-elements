# Hidden Elements Scanner (Chrome / Edge Extension)

## 📌 Giới thiệu
Extension này giúp bạn:
- Quét (scan) tất cả **các phần tử bị ẩn** (`display: none`) trên trang web
- Nhận diện các **popup / dialog** ẩn
- Dọn nhanh popup che nội dung đọc truyện, gồm các lớp phủ kiểu `#google_vignette`
- Gỡ blur / khóa scroll sau khi popup bị chèn vào trang
- Hiển thị danh sách kết quả trong popup
- Cho phép **Toggle (ẩn/hiện)** từng phần tử
- Cho phép **Remove link (<a>)** bên trong các phần tử ẩn
- Hỗ trợ **Show / Hide All** và **Remove Popups**

Phù hợp để:
- Debug web
- Phát hiện nội dung ẩn
- Kiểm tra link ẩn, tracking, ads

---

## 🚀 Tính năng chính

### 🔍 Scan Page
- Quét toàn bộ DOM
- Lấy các phần tử:
  - `display: none`
  - Có `id` hoặc `class`
  - Popup / dialog (`popup`, `dialog` trong id/class)

### Clean Reader Popups
- Xóa popup quảng cáo / vignette đang che nội dung
- Xóa `#google_vignette` khỏi URL bằng History API
- Mở lại scroll nếu trang bị khóa `overflow: hidden`
- Tắt blur trên vùng nội dung truyện
- Theo dõi DOM trong thời gian ngắn để dọn popup được chèn lại sau khi bấm nút

### 👁 Toggle Element
- Hiện / Ẩn lại phần tử đã bị `display:none`
- Tự động scroll đến vị trí phần tử
- Highlight viền đỏ khi hiển thị

### ❌ Remove Links
- Xóa tất cả thẻ `<a href>` bên trong phần tử được chọn
- Dùng viền cam nét đứt để đánh dấu

### 👁 Show / Hide All
- Hiện hoặc ẩn toàn bộ hidden / popup elements

### 🗑 Remove Popups
- Dọn các phần tử giống popup / quảng cáo che màn hình
- Giữ lại link điều hướng và link trong nội dung truyện

---

## 🧠 Cách hoạt động (Quan trọng)

### ❗ Vì sao KHÔNG dùng index?
- Khi scan và khi toggle, DOM có thể thay đổi
- Index dễ bị lệch → toggle sai element

### ✅ Giải pháp
- Mỗi element được lưu kèm **CSS selector**
- Khi toggle/remove → query lại element bằng selector
- Đảm bảo thao tác đúng phần tử gốc

Ví dụ selector:
```js
#myHiddenDiv
div.popup-container
section.hidden-content
````

---

## 🧩 Cấu trúc file

```
extension/
│
├── manifest.json
├── popup.html
├── popup.js
├── icon.png
└── Readme.md
```

---

## 🧪 Ví dụ logic scan

```js
if (
    window.getComputedStyle(el).display === "none" &&
    (el.id !== "" || el.className !== "")
) {
    found.push({
        id: el.id,
        class: el.className,
        selector: getSelector(el),
        type: "hidden"
    });
}
```

---

## ⚠️ Hạn chế

* Không scan được các trang:

    * `chrome://`
    * `edge://`
    * `about:`
    * `chrome-extension://`
* Không override được mọi CSS `!important`
* Popup được tạo trong iframe cross-origin có thể cần bấm nút dọn lại sau khi trang chèn mới

---

## 🛠 Gợi ý mở rộng

* Checkbox lọc:

    * Chỉ element có `<p>`
    * Chỉ popup
* Export kết quả ra JSON
* Highlight bằng overlay
* Detect `visibility:hidden`, `opacity:0`

---

## 📄 License

MIT License – dùng tự do cho mục đích cá nhân & học tập.

---

## 👨‍💻 Author

Built for debugging & DOM inspection
Powered by JavaScript + Chrome Extension API
