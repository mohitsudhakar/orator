#!/usr/bin/env python3
"""Capture screenshots of the ORATOR UI for visual review."""
import base64, json, time, urllib.request, websocket, os

CDP_URL = "http://localhost:9222"
APP = "http://localhost:4173"
OUT = "/tmp/orator_shots"
os.makedirs(OUT, exist_ok=True)

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
    return r.get("result", {}).get("value")


def shot(name, w=1500, h=1000):
    send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=False)
    time.sleep(0.8)
    r = send("Page.captureScreenshot", format="png")
    data = base64.b64decode(r["data"])
    path = f"{OUT}/{name}.png"
    open(path, "wb").write(data)
    print(f"  {path}  ({len(data)//1024} KB)")


send("Page.enable"); send("Runtime.enable")
send("Emulation.setDeviceMetricsOverride", width=1500, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url=APP + "/")
time.sleep(4)

print("capturing:")
shot("01_dashboard")

# Module page
ev("document.querySelectorAll('.nav-item')[3].click()")
time.sleep(2.5)
shot("02_module_concepts")

# Expand a concept and scroll to it
ev("document.querySelector('.concept-head').click()")
time.sleep(1.0)
ev("window.scrollTo(0, 520)")
time.sleep(0.5)
shot("03_concept_expanded")

# Frameworks tab
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Frameworks')).click()")
time.sleep(1.0)
shot("04_frameworks")

# Scenarios
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Scenarios')).click()")
time.sleep(1.0)
ev("document.querySelector('.scenario .option').click()")
time.sleep(2.5)
shot("05_scenario_revealed")

# Assessment
ev("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Assessment')).click()")
time.sleep(1.0)
shot("06_assessment")

# Tutor
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Tutor')).click()")
time.sleep(1.5)
ev("(()=>{const t=document.querySelector('#chatInput'); t.value='How do I open a board presentation so they lean in instead of checking email?';})()")
ev("document.querySelector('#chatSend').click()")
time.sleep(9)
shot("07_tutor")

# Studio
ev("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Studio')).click()")
time.sleep(2.0)
ev("document.querySelector('#btnConnect').click()")
time.sleep(12)
shot("08_live_studio")

ws.close()
print("done")
