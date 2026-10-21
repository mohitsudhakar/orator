#!/usr/bin/env python3
"""
UI regression checks for issues found during visual review.
Each check corresponds to a real defect that was fixed.
"""
import base64, json, time, urllib.request, websocket, os

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"
OUT = "/tmp/orator_shots2"
os.makedirs(OUT, exist_ok=True)

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


def shot(name):
    r = send("Page.captureScreenshot", format="png")
    open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(r["data"]))


send("Page.enable"); send("Runtime.enable")
send("Emulation.setDeviceMetricsOverride", width=1500, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url=APP + "/")
time.sleep(4)

print("=== A. No raw model id in the chrome ===")
ok("model id not rendered", "gemini-" not in (ev("document.body.innerText") or ""),
   (ev("document.body.innerText") or "")[:160])
ok("human label shown instead", "live coach" in (ev("document.querySelector('#modelVal')?.textContent") or "").lower(),
   ev("document.querySelector('#modelVal')?.textContent"))

print("\n=== B. Module count is dynamic, not hardcoded ===")
# The dashboard has two tables (curriculum + recent practice). Scope the row
# count to the curriculum table specifically.
cats = ev("""(()=>{
  const cards = Array.from(document.querySelectorAll('.card'));
  const card = cards.find(c => c.querySelector('h3')?.textContent === 'Curriculum progress');
  return card ? card.querySelectorAll('table tbody tr').length : 0;
})()""")
tile = ev("Array.from(document.querySelectorAll('.stat')).map(s=>s.querySelector('.d')?.textContent).find(t=>t&&t.includes('module program'))")
ok("stat subtitle uses live count", (tile or "").startswith("of the ") and "-module program" in (tile or ""), str(tile))
ok("curriculum row count matches subtitle", str(cats) in (tile or ""), f"rows={cats} tile={tile}")

print("\n=== C. Sidebar module labels are not truncated ===")
labels = ev("Array.from(document.querySelectorAll('.nav-label')).map(e=>e.textContent)")
trunc = ev("""(()=>{
  const out=[];
  for (const e of document.querySelectorAll('.nav-label')) {
    if (e.scrollWidth > e.clientWidth + 2) out.push(e.textContent);
  }
  return out;
})()""")
ok("no sidebar label is visually truncated", not trunc, json.dumps(trunc))
ok("every module has a sidebar label", len(labels or []) == cats, f"labels={len(labels or [])} rows={cats}")

print("\n=== D. Diagram does not overflow its container ===")
ev("document.querySelectorAll('.nav-item')[3].click()")
time.sleep(2.5)
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Concepts')).click()")
time.sleep(0.6)
ev("document.querySelector('.concept-head').click()")
time.sleep(2.0)
over = ev("""(()=>{
  const img = document.querySelector('.diagram');
  if (!img || !img.src || img.style.display==='none') return null;
  const p = img.parentElement;
  return { imgW: img.getBoundingClientRect().width, parentW: p.getBoundingClientRect().width,
           overflowX: img.scrollWidth > img.clientWidth + 2,
           naturalW: img.naturalWidth, loaded: img.complete && img.naturalWidth > 50 };
})()""")
ok("diagram element found", over is not None, str(over))
if over:
    ok("diagram loaded", over["loaded"], str(over))
    ok("diagram fits its container", not over["overflowX"], str(over))
    ok("diagram width <= parent width", over["imgW"] <= over["parentW"] + 2, str(over))

print("\n=== E. Live studio control state is coherent ===")
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Studio')).click()")
time.sleep(2.0)
ev("document.querySelector('#btnConnect').click()")
time.sleep(12)
status = ev("document.querySelector('#studioStatus')?.textContent") or ""
btn = ev("document.querySelector('#btnConnect')?.textContent") or ""
ok("status says live", "live" in status.lower(), status)
ok("connect button reflects live state", "live" in btn.lower() or btn.strip() == "", btn)
ok("connect button disabled while live", ev("document.querySelector('#btnConnect')?.disabled") is True, btn)
ok("stop button enabled while live", ev("document.querySelector('#btnStop')?.disabled") is False)
ok("record button enabled while live", ev("document.querySelector('#btnRecord')?.disabled") is False)

# Transcript should not be a wall of empty space.
tr_h = ev("document.querySelector('#transcript')?.getBoundingClientRect().height")
ok("transcript is not excessively tall", (tr_h or 999) <= 470, f"h={tr_h}")

ev("document.querySelector('#btnStop').click()")
time.sleep(1.5)
ok("controls reset after stop", "start live session" in (ev("document.querySelector('#btnConnect')?.textContent") or "").lower(),
   ev("document.querySelector('#btnConnect')?.textContent"))
ok("connect re-enabled after stop", ev("document.querySelector('#btnConnect')?.disabled") is False)

shot("final_dashboard")

ws.close()
print("\n" + "=" * 50)
print(f"{checks - fails}/{checks} checks passed")
if fails:
    print("FAILED")
    raise SystemExit(1)
print("UI REGRESSION CHECKS PASSED")
