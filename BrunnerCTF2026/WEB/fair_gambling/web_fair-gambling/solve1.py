import hashlib
import json
import sys
from websocket import create_connection

URL = "wss://fair-gambling-532d158a90f2deed-global.challs.brunnerne.xyz/ws"
def sha1(s):
    return hashlib.sha1(s.encode()).hexdigest()

def send(ws,data):
    ws.send(json.dumps(data))
    
def recv(ws):
    return json.loads(ws.recv())

ws = create_connection(URL)
state = recv(ws)

symbols = [s["emoji"] for s in state["symbols"]]
payouts = {s["emoji"]: s["payout"] for s in state["symbols"]}

known = {
    sha1(a+b+c):[a,b,c]
    for a in symbols
    for b in symbols
    for c in symbols
}
cash = state["cash"]
streak = state["streak"]
spin = state["next"]

while cash < 1000000:
    rest = known[spin["hash"]]
    win = 0
    if rest[0]==rest[1]==rest[2]:
        win = payouts[rest[0]]
    if win == 0:
        send(ws,{"type":"spin","sid":"no"})
        spin = recv(ws)["next"]
        continue
    
    send(ws,{"type":"spin","sid":spin["sid"]})
    msg = recv(ws)
    
    cash = msg["cash"]
    streak = msg["streak"]
    spin = msg["next"]
    print(cash)
    
send(ws,{"type":"redeem"})
print(recv(ws))