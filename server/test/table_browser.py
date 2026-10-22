#!/usr/bin/env python3
"""
Verify that markdown tables render as real HTML tables in the browser -
both in the tutor's streamed output and in the curriculum concept bodies.
"""
import json, time, urllib.request, websocket, sys

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"

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
send("Emulation.setDeviceMetricsOverride", width=1500, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url=APP + "/")
time.sleep(4)

print("=== A. Curriculum concept with a table (m01 c1) ===")
ev("document.querySelectorAll('.nav-item')[3].click()")
time.sleep(2.0)
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Concepts')).click()")
time.sleep(0.6)
# Expand the concept that contains a table.
ev("""(()=>{
  const heads = Array.from(document.querySelectorAll('.concept'));
  for (const h of heads) {
    h.querySelector('.concept-head').click();
    const body = h.querySelector('.concept-body');
    if (body && body.innerText.includes('|')) { return true; }
    h.querySelector('.concept-head').click();
  }
  return false;
})()""")
time.sleep(1.2)

tables = ev("document.querySelectorAll('.concept-body table.md-table').length")
ok("curriculum table rendered as HTML", (tables or 0) >= 1, f"tables={tables}")
if tables:
    ok("table has a header row", ev("!!document.querySelector('.concept-body table.md-table thead th')"))
    ok("table has body rows", ev("document.querySelectorAll('.concept-body table.md-table tbody tr').length") >= 1)
    ok("no raw pipes in the rendered text",
       not ev("(()=>{const t=document.querySelector('.concept-body table.md-table'); return t?t.innerText.includes('|'):false})()"))
    ok("header cells are styled",
       ev("getComputedStyle(document.querySelector('.concept-body table.md-table th')).textTransform") == "uppercase",
       ev("getComputedStyle(document.querySelector('.concept-body table.md-table th')).textTransform"))
    ok("table scrolls horizontally on overflow",
       ev("getComputedStyle(document.querySelector('.concept-body .table-wrap')).overflowX") == "auto")

print("\n=== B. Tutor table output ===")
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Tutor')).click()")
time.sleep(1.2)
ev("""(()=>{
  const t=document.querySelector('#chatInput');
  t.value='Show me a table of the 4 voice registers with columns Register, Range, How it sounds, When to use it.';
})()""")
ev("document.querySelector('#chatSend').click()")
for _ in range(60):
    if ev("document.querySelector('#streamBubble')?.dataset.streaming === 'false'"):
        break
    time.sleep(1.5)
time.sleep(0.8)

tut_tables = ev("document.querySelectorAll('#streamBubble table.md-table').length")
ok("tutor table rendered as HTML", (tut_tables or 0) >= 1, f"tables={tut_tables}")
if tut_tables:
    ok("tutor table has 4 columns",
       ev("document.querySelectorAll('#streamBubble table.md-table thead th').length") == 4,
       str(ev("document.querySelectorAll('#streamBubble table.md-table thead th').length")))
    ok("tutor table has body rows",
       ev("document.querySelectorAll('#streamBubble table.md-table tbody tr').length") >= 3)
    ok("no raw pipes in the tutor answer",
       not ev("(()=>{const t=document.querySelector('#streamBubble'); return t?t.innerText.includes('|'):false})()"),
       ev("document.querySelector('#streamBubble')?.innerText.slice(0,200)"))
    # The model picks its own register names (chest/mouth/mask/head, or
    # vocal fry/modal/falsetto depending on how it frames the question), so
    # assert on the table's own content rather than a hardcoded word.
    cell_text = ev("document.querySelector('#streamBubble table.md-table')?.innerText || ''")
    ok("tutor table cells contain the content", len(cell_text) > 80, repr(cell_text[:120]))
    ok("tutor table has 4 populated body rows",
       ev("""(()=>Array.from(document.querySelectorAll('#streamBubble table.md-table tbody tr'))
              .filter(r=>r.innerText.trim().length>10).length)()""") == 4,
       str(ev("document.querySelectorAll('#streamBubble table.md-table tbody tr').length")))
    ok("tutor table is inside a scroll wrapper",
       ev("!!document.querySelector('#streamBubble .table-wrap')"))

print("\n=== C. Screenshot ===")
r = send("Page.captureScreenshot", format="png")
import base64, os
os.makedirs("/tmp/orator_shots3", exist_ok=True)
open("/tmp/orator_shots3/tutor_table.png", "wb").write(base64.b64decode(r["data"]))
print("  saved /tmp/orator_shots3/tutor_table.png")

ws.close()
print("\n" + "=" * 50)
print(f"{checks - fails}/{checks} checks passed")
sys.exit(1 if fails else 0)
