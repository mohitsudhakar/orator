#!/usr/bin/env python3
"""Capture the tutor's RAW markdown and run it through the client renderer."""
import json, re, time, urllib.request, websocket, subprocess, sys

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"

req = urllib.request.Request(f"{CDP_URL}/json/new?about:blank", method="PUT")
target = json.load(urllib.request.urlopen(req))
ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=60, max_size=64*1024*1024)
_id = [0]


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
        raise RuntimeError(str(r["exceptionDetails"])[:400])
    return r.get("result", {}).get("value")


send("Page.enable"); send("Runtime.enable")
send("Page.navigate", url=APP + "/")
time.sleep(4)
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Tutor')).click()")
time.sleep(1.5)
ev("(()=>{const t=document.querySelector('#chatInput'); t.value='How do I open a board presentation so they lean in instead of checking email?';})()")
ev("document.querySelector('#chatSend').click()")
for _ in range(60):
    if ev("document.querySelector('#streamBubble')?.dataset.streaming === 'false'"):
        break
    time.sleep(1.5)
time.sleep(1)

# Pull the RAW model text (not the rendered HTML - rendering is what we are
# trying to verify).
raw = ev("window.__oratorLastRaw || ''")
if not raw:
    print("NO RAW TEXT CAPTURED")
    ws.close()
    sys.exit(1)

print("=== RAW MARKDOWN (first 2600 chars) ===")
print(raw[:2600])
print("\n=== HINTS ===")
print("has ## heading:", "##" in raw)
print("has > quote:", any(l.strip().startswith(">") for l in raw.split("\n")))
print("has - bullet:", any(l.strip().startswith("- ") for l in raw.split("\n")))
print("newline count:", raw.count("\n"))
for i, line in enumerate(raw.split("\n")[:20]):
    if line.strip().startswith(">") or line.strip().startswith("#") or line.strip().startswith("- "):
        print(f"  line {i}: {line[:100]!r}")

# Save for offline testing.
open("/tmp/tutor_raw.md", "w").write(raw)
print("\nsaved to /tmp/tutor_raw.md")
ws.close()
