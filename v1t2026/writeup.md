# WRITEUP - V1T CTF 2026

## Web:

### HVL

Bài này giống câu cho điểm, flag hiện lên trên video, ghép lại là được:

![1782721486720](image/writeup/1782721486720.png)

> FLAG:v1t{g04t_mck_hvl}

### B1tsy Ducky

#### Mô tả

Challenge cho một game Bitsy chạy trong HTML. Mở source thấy phần game data có gợi ý:

```
Welcome, adventurer!
Talk to the duck to find the flag.
```

Trong game có nhiều NPC vịt, nhưng các dialog đầu chỉ đánh lạc hướng:

```
But i do not have the flag
You could ask the other duck
```

Điểm đáng chú ý nằm ở cuối file HTML, có đoạn JavaScript load WASM:

<script s<wbr>

+...

return fetch("main.wasm")
Sau khi load main.wasm, script đợi export:
window.duckWasmReveal
và khi trigger thành công sẽ gọi:
var flag_decrypt = window.duckWasmReveal(referrer, room3Block, picked32);
window.flag = flag_decrypt;
window.close();
Vậy flag không nằm plaintext trong HTML, mà được decrypt trong WASM.
Trigger
Trong HTML có custom dialog tag:
function duck(environment, parameters) {
  if (typeof window.__bdx_17a === "function") {
    window.__bdx_17a();
  }
}

addDualDialogTag('duck', duck);
Dialog của con vịt ẩn là:
DLG 5
"""
How you find me quack quack
(duck)
"""
Sprite đặc biệt:
SPR c
DLG 5
POS 3 14,1
Tức con vịt thật là sprite c, ở room 3, tọa độ 14,1.
Hàm __bdx_17a() kiểm tra người chơi có thật sự đang nói chuyện với vịt này không:
function isPlayerTalkingToSpecialDuck() {
  if (!lastSpriteDialog || lastSpriteDialog.spriteId !== specialDuckSpriteId) return false;
  if (Date.now() - lastSpriteDialog.startedAt > 2000) return false;
  if (!dialogBuffer || !dialogBuffer.IsActive || !dialogBuffer.IsActive()) return false;

  var duckSprite = sprite[specialDuckSpriteId];
  if (player().room !== duckSprite.room) return false;

  var manhattan = Math.abs(player().x - duckSprite.x) + Math.abs(player().y - duckSprite.y);
  return manhattan === 1;
}
Nếu fail thì chỉ hiện:
quack
Ba input cho WASM
Trước khi gọi WASM, script chuẩn bị 3 input:
var room3Block = serializeRoomBlock("3");
var referrer = document.referrer || "";
var picked32 = pick32();

var flag_decrypt = window.duckWasmReveal(referrer, room3Block, picked32);
Trong đó:
referrer = "https://b1tsy.v1t.site/"
picked32 = "797084dac2504482bcfaec15adc048bb"
room3Block là serialize của room 3:
ROOM 3
0,0,0,f,0,g,g,f,0,0,0,0,0,0,0,0
...
NAME example room copy 2
EXT 4,0 2 4,15
PAL 0
TUNE 2
Reverse WASM
Dùng strings trên main.wasm thấy các symbol và hằng quan trọng:
main.deriveKey
main.decryptHex
main.duckWasmReveal
main.isValidFlag
crypto/aes
crypto/cipher
crypto/sha256
crypto/hmac
b1tsy-ducky-aesgcm
9e8c2b395bbf6bd7434230ab998c6e86f3228c503324c8660715ccd0bc74deb7d6346dfcc4a9614e58cb
some thing go wrong go to start again
cipher: message authentication failed
Điều này cho thấy WASM dùng AES-GCM để decrypt flag.
Sau khi disassemble WAT, logic chính được dựng lại như sau:
keySource = referrer + "|" + room3Block + "|" + picked32

key = HMAC_SHA256(
  "b1tsy-ducky-aesgcm",
  keySource
)

nonce = SHA256("nonce|" + keySource).slice(0, 12)

flag = AES_256_GCM_DECRYPT(ciphertext, key, nonce)
Ciphertext hardcoded:
9e8c2b395bbf6bd7434230ab998c6e86f3228c503324c8660715ccd0bc74deb7d6346dfcc4a9614e58cb
WASM còn check flag format:
length == 28
starts with v1t{
ends with }
allowed chars: lowercase, digit, underscore