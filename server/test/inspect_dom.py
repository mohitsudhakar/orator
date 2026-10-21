#!/usr/bin/env python3
"""Inspect the module page DOM structure to find the right progress selectors."""
import json, time, urllib.request, websocket

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"

req = urllib.request.Request(f"{CDP_URL}/json/new?about:blank", method="PUT")
target = json.load(urllib.request.urlopen(req))
ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=40)
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
    return r.get("result", {}).get("value")


send("Page.enable"); send("Runtime.enable")
send("Page.navigate", url=APP + "/")
time.sleep(3)
ev("document.querySelectorAll('.nav-item')[3].click()")
time.sleep(2.5)

print("=== .player children ===")
print(ev("Array.from(document.querySelector('.player').children).map(c=>c.className)"))
print("\n=== side panel (last child) .stat elements ===")
print(ev("""
(()=>{
  const side = document.querySelector('.player').lastElementChild;
  return Array.from(side.querySelectorAll('.stat')).map(s => ({
    k: s.querySelector('.k')?.textContent,
    v: s.querySelector('.v')?.textContent
  }));
})()
"""))
print("\n=== all .stat on page ===")
print(ev("Array.from(document.querySelectorAll('.stat')).map(s=>(s.querySelector('.k')?.textContent||'')+'='+(s.querySelector('.v')?.textContent||''))"))
print("\n=== concept buttons ===")
print(ev("Array.from(document.querySelectorAll('.concept .btn')).map(b=>b.textContent.trim())"))
print("\n=== first concept btn exists? ===")
print(ev("!!document.querySelector('.concept .btn')"))
print("\n=== progressCard html head ===")
print(ev("document.querySelector('.player').lastElementChild.innerHTML.slice(0,700)"))
ws.close()
