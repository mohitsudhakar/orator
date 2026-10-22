#!/usr/bin/env python3
"""Verify table rendering against the DEPLOYED service."""
import base64, json, os, sys, time, urllib.request, websocket

CDP_URL = "http://localhost:9222"
APP = sys.argv[1] if len(sys.argv) > 1 else "https://g7mwjppb42.us-east-1.awsapprunner.com"

req = urllib.request.Request(f"{CDP_URL}/json/new?about:blank", method="PUT")
target = json.load(urllib.request.urlopen(req))
ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=60, max_size=64*1024*1024)
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
# The deployed app.js must not be cached: a stale copy silently breaks new
# frontend features. Disable the cache for this test and assert the headers.
send("Network.enable")
send("Network.setCacheDisabled", cacheDisabled=True)
send("Emulation.setDeviceMetricsOverride", width=1500, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url=APP + "/?nocache=" + str(int(time.time())))
time.sleep(6)

print(f"=== production table check: {APP} ===")
ok("app loaded", ev("!!document.querySelector('#view')"))

# Assert the cache headers, not the stylesheet rules (a cross-origin
# stylesheet cannot be introspected for cssRules from a different origin).
headers = {}
for path in ("/app.js", "/styles.css", "/index.html"):
    req = urllib.request.Request(f"{APP}{path}", method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            headers[path] = r.headers.get("Cache-Control", "")
    except Exception as e:
        headers[path] = f"ERROR {e}"
ok("app.js is not cached", "no-cache" in headers["/app.js"], headers["/app.js"])
ok("styles.css is not cached", "no-cache" in headers["/styles.css"], headers["/styles.css"])
ok("index.html is not cached", "no-cache" in headers["/index.html"], headers["/index.html"])

# Curriculum table
ev("document.querySelectorAll('.nav-item')[3].click()")
time.sleep(2.0)
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Concepts')).click()")
time.sleep(0.6)
ev("""(()=>{
  for (const h of document.querySelectorAll('.concept')) {
    h.querySelector('.concept-head').click();
    if (h.querySelector('.concept-body table.md-table')) return true;
    h.querySelector('.concept-head').click();
  }
  return false;
})()""")
time.sleep(1.2)
ok("curriculum table rendered", ev("document.querySelectorAll('.concept-body table.md-table').length") >= 1,
   str(ev("document.querySelectorAll('.concept-body table.md-table').length")))
ok("curriculum table has styled header",
   ev("getComputedStyle(document.querySelector('.concept-body table.md-table th')).textTransform") == "uppercase")
ok("curriculum table no raw pipes",
   not ev("(()=>{const t=document.querySelector('.concept-body table.md-table');return t?t.innerText.includes('|'):false})()"))

# Tutor table
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Tutor')).click()")
time.sleep(1.2)
ev("""(()=>{const t=document.querySelector('#chatInput');
 t.value='Show me a table of the 5 opening archetypes with columns Archetype, When to use, Risk.';})()""")
ev("document.querySelector('#chatSend').click()")
for _ in range(70):
    if ev("document.querySelector('#streamBubble')?.dataset.streaming === 'false'"):
        break
    time.sleep(1.5)
time.sleep(0.8)

n = ev("document.querySelectorAll('#streamBubble table.md-table').length")
ok("tutor table rendered", (n or 0) >= 1, f"tables={n}")
if n:
    ok("tutor table has 3 columns", ev("document.querySelectorAll('#streamBubble table.md-table thead th').length") == 3)
    ok("tutor table body rows", ev("document.querySelectorAll('#streamBubble table.md-table tbody tr').length") >= 4)
    ok("tutor table no raw pipes",
       not ev("(()=>{const t=document.querySelector('#streamBubble');return t?t.innerText.includes('|'):false})()"))
    ok("tutor table has a scroll wrapper", ev("!!document.querySelector('#streamBubble .table-wrap')"))

os.makedirs("/tmp/prod_table", exist_ok=True)
# Scroll the table into view so the screenshot actually shows it.
ev("(()=>{const t=document.querySelector('#streamBubble table.md-table'); if(t) t.scrollIntoView({block:'center'});})()")
time.sleep(0.8)
r = send("Page.captureScreenshot", format="png")
open("/tmp/prod_table/prod_table.png", "wb").write(base64.b64decode(r["data"]))
print("  screenshot: /tmp/prod_table/prod_table.png")

ws.close()
print("\n" + "=" * 50)
print(f"{checks - fails}/{checks} checks passed")
sys.exit(1 if fails else 0)
