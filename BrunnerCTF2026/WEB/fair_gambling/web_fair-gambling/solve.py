#!/usr/bin/env python3
import hashlib
import json
import sys

try:
    from websocket import create_connection
except ImportError:
    print("Install dependency first: pip install websocket-client", file=sys.stderr)
    raise


URL = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:3000/ws"
TARGET = 1_000_000


def sha1(s):
    return hashlib.sha1(s.encode()).hexdigest()


def send(ws, data):
    ws.send(json.dumps(data))


def recv(ws):
    return json.loads(ws.recv())


ws = create_connection(URL)
state = recv(ws)

symbols = [s["emoji"] for s in state["symbols"]]
payouts = {s["emoji"]: s["payout"] for s in state["symbols"]}

# Server sends SHA1(result) before reveal. There are only 7^3 possible results.
known = {
    sha1(a + b + c): [a, b, c]
    for a in symbols
    for b in symbols
    for c in symbols
}

cash = state["cash"]
streak = state["streak"]
spin = state["next"]

print(f"[+] start cash={cash}, streak={streak}")

while cash < TARGET:
    result = known[spin["hash"]]
    base_win = payouts[result[0]] if result[0] == result[1] == result[2] else 0

    if base_win == 0:
        send(ws, {"type": "spin", "sid": "nope"})
        spin = recv(ws)["next"]
        continue

    print(f"[+] take {''.join(result)} for about ${base_win * 3 ** streak:,}")
    send(ws, {"type": "spin", "sid": spin["sid"]})
    msg = recv(ws)

    cash = msg["cash"]
    streak = msg["streak"]
    spin = msg["next"]
    print(f"    cash=${cash:,}, streak={streak}")

send(ws, {"type": "redeem"})
print(recv(ws))
