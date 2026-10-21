#!/usr/bin/env python3
"""Verify the dashboard trends section renders sparklines from real data."""
import json, time, urllib.request, websocket

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"

req = urllib.request.Request(f"{CDP_URL}/json/new?about:blank", method="PUT")
target = json.load(urllib.request.urlopen(req))
ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=40)
_id = [0]
fails = 0
checks = 0


def ok(name, cond, detail=""):
    global checks, fails
    checks += 1
    if cond:
        print(f"  PASS  {name}")
    else:
        fails += 1
        print(f"  FAIL  {name}  {detail}")


def send(method, **params):
    _id[0] += 1
    mid = _id[0]
    ws.send(json.dumps({"id": mid, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            return m.get("result", {})


def ev(expr):
    r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
    if r.get("exceptionDetails"):
        raise RuntimeError(str(r["exceptionDetails"])[:300])
    return r.get("result", {}).get("value")


send("Page.enable"); send("Runtime.enable")
send("Page.navigate", url=APP + "/")
time.sleep(4)

print("=== Dashboard trends ===")
ok("trends card present", ev("document.querySelectorAll('.card').length >= 3"))
spark = ev("document.querySelectorAll('svg path[stroke]').length")
ok("sparklines rendered as SVG", spark >= 4, f"paths={spark}")
circles = ev("document.querySelectorAll('svg circle').length")
ok("sparkline end-points drawn", circles >= 4, f"circles={circles}")
labels = ev("Array.from(document.querySelectorAll('.card')).map(c=>c.querySelector('h3')?.textContent)")
ok("Dimension trends card exists", "Dimension trends" in (labels or []), str(labels))
deltas = ev("Array.from(document.querySelectorAll('.card')).find(c=>c.querySelector('h3')?.textContent==='Dimension trends')?.querySelectorAll('span[style*=\"font-weight: 700\"]').length")
ok("per-dimension deltas shown", (deltas or 0) >= 4, f"n={deltas}")

print("\n=== Session history ===")
rows = ev("document.querySelectorAll('table tbody tr').length")
ok("session rows present", (rows or 0) >= 3, f"rows={rows}")
ok("stat tiles show session count", ev("document.querySelectorAll('.stat').length >= 4"))

ws.close()
print("\n" + "=" * 46)
print(f"{checks - fails}/{checks} checks passed")
if fails:
    print("FAILED")
    raise SystemExit(1)
print("DASHBOARD TRENDS OK")
