const FLAG = "brunner{REDACTED}";
const START_CASH = 1000;
const SPIN_COST = 25;
const FLAG_COST = 1_000_000;
const STREAK_MULTIPLIER = 3;
const COOKIE_MAX_AGE = 2_147_483_647;
const PORT = Number(Bun.env.PORT ?? 3000);

type SymbolDef = { emoji: string; weight: number; payout: number };
type User = { cash: number; flagBought: boolean; winStreak: number };
type PreparedSpin = { userid: string; result: string[]; hash: string; win: number };
type SpinRef = { sid: string; hash: string };

const symbols: SymbolDef[] = [
  { emoji: "🍒", weight: 500, payout: 50 },
  { emoji: "🍋", weight: 260, payout: 100 },
  { emoji: "🍇", weight: 130, payout: 250 },
  { emoji: "🍉", weight: 60, payout: 1_000 },
  { emoji: "🔔", weight: 20, payout: 5_000 },
  { emoji: "⭐", weight: 5, payout: 20_000 },
  { emoji: "💎", weight: 25, payout: 100_000 },
];

const users = new Map<string, User>();
const spins = new Map<string, PreparedSpin>();
const html = Bun.file("index.html");

const json = (data: unknown) => JSON.stringify(data);
const send = (ws: ServerWebSocket<{ userid: string }>, data: unknown) => ws.send(json(data));

const id = () => crypto.randomUUID();

function discardPreparedSpins(userid: string) {
  for (const [sid, spin] of spins) {
    if (spin.userid === userid) spins.delete(sid);
  }
}

function getUser(userid: string) {
  let user = users.get(userid);
  if (!user) {
    user = { cash: START_CASH, flagBought: false, winStreak: 0 };
    users.set(userid, user);
  }
  return user;
}

function weightedPick() {
  const total = symbols.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * total;

  for (const symbol of symbols) {
    roll -= symbol.weight;
    if (roll <= 0) return symbol;
  }

  return symbols[0];
}

async function sha1(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function prepareSpin(userid: string) {
  const result = [weightedPick(), weightedPick(), weightedPick()];
  const emojis = result.map((symbol) => symbol.emoji);
  const win = emojis.every((emoji) => emoji === emojis[0]) ? result[0].payout : 0;
  const sid = id();

  const spin = { userid, result: emojis, win, hash: await sha1(emojis.join("")) };
  spins.set(sid, spin);
  return { sid, hash: spin.hash } satisfies SpinRef;
}

async function spin(ws: ServerWebSocket<{ userid: string }>, sid?: string) {
  const user = getUser(ws.data.userid);
  const current = sid ? spins.get(sid) : undefined;

  if (!current || current.userid !== ws.data.userid) {
    // An invalid SID deliberately discards a prepared result without charging the user.
    discardPreparedSpins(ws.data.userid);
    send(ws, {
      type: "spin",
      status: "discarded",
      message: "Spin expired. Prepared a replacement.",
      next: await prepareSpin(ws.data.userid),
    });
    return;
  }

  if (user.cash < SPIN_COST) {
    send(ws, {
      type: "spin",
      status: "rejected",
      message: "Not enough cash to spin.",
      next: { sid: sid!, hash: current.hash },
    });
    return;
  }

  spins.delete(sid);
  user.cash -= SPIN_COST;
  let win = current.win;
  if (win > 0) {
    user.winStreak++;
    win *= STREAK_MULTIPLIER ** (user.winStreak - 1);
  } else {
    user.winStreak = 0;
  }
  user.cash += win;
  const next = await prepareSpin(ws.data.userid);

  send(ws, {
    type: "spin",
    status: "revealed",
    result: {
      sid,
      symbols: current.result,
      hash: current.hash,
      win,
    },
    cash: user.cash,
    streak: user.winStreak,
    next,
  });
}

function redeem(ws: ServerWebSocket<{ userid: string }>) {
  const user = getUser(ws.data.userid);
  if (user.flagBought) {
    send(ws, { type: "flag", flag: FLAG, cash: user.cash });
    return;
  }

  if (user.cash < FLAG_COST) {
    send(ws, {
      type: "error",
      message: `Redeem costs $${FLAG_COST.toLocaleString()}.`,
    });
    return;
  }

  user.cash -= FLAG_COST;
  user.flagBought = true;
  send(ws, { type: "flag", flag: FLAG, cash: user.cash });
}

Bun.serve<{ userid: string }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    const cookieUserid = req.headers.get("cookie")?.match(/(?:^|; )userid=([^;]+)/)?.[1];

    if (url.pathname === "/ws") {
      const userid = cookieUserid || id();
      if (server.upgrade(req, { data: { userid } })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const userid = cookieUserid || id();
      getUser(userid);
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": `userid=${userid}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`,
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    async open(ws) {
      const user = getUser(ws.data.userid);
      send(ws, {
        type: "state",
        cash: user.cash,
        flagBought: user.flagBought,
        streak: user.winStreak,
        spinCost: SPIN_COST,
        flagCost: FLAG_COST,
        streakMultiplier: STREAK_MULTIPLIER,
        symbols,
        next: await prepareSpin(ws.data.userid),
      });
    },
    message(ws, message) {
      let data: { type?: string; sid?: string };
      try {
        data = JSON.parse(String(message));
      } catch {
        send(ws, { type: "error", message: "Bad message." });
        return;
      }

      if (data.type === "spin") spin(ws, data.sid);
      if (data.type === "redeem") redeem(ws);
    },
  },
});

console.log(`Brunnerne Inc Yearly Bonus Opportunity running at http://localhost:${PORT}`);
