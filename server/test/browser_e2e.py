#!/usr/bin/env python3
"""
ORATOR browser test harness driven directly over CDP.

Verifies the real UI end-to-end:
  1. dashboard renders with live data
  2. module page loads and expands a concept
  3. image generation produces a real diagram
  4. scenario option reveal + grading
  5. tutor SSE streams a response
  6. live coach WS connects and receives coach audio
  7. progress persists across reload
"""
import json
import os
import sys
import time
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:
    print("need websocket-client: pip install websocket-client")
    sys.exit(2)

CDP_URL = "http://localhost:9222"
APP = os.environ.get("ORATOR_URL", "http://localhost:4173")

failures = []
checks = 0


def ok(name, cond, detail=""):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {name}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}  {detail}")


class CDP:
    def __init__(self):
        req = urllib.request.Request(
            f"{CDP_URL}/json/new?about:blank", method="PUT"
        )
        with urllib.request.urlopen(req) as r:
            self.target = json.load(r)
        self.ws = websocket.create_connection(
            self.target["webSocketDebuggerUrl"], timeout=40, max_size=64 * 1024 * 1024
        )
        self.id = 0
        self.console = []
        self.errors = []

    def send(self, method, **params):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("method") == "Runtime.consoleAPICalled":
                args = msg["params"].get("args", [])
                text = " ".join(str(a.get("value", a.get("description", ""))) for a in args)
                self.console.append((msg["params"].get("type"), text))
            elif msg.get("method") == "Runtime.exceptionThrown":
                det = msg["params"].get("exceptionDetails", {})
                self.errors.append(det.get("text", "") + " " + str(det.get("exception", {}).get("description", ""))[:300])
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def eval(self, expr, await_promise=True):
        r = self.send(
            "Runtime.evaluate",
            expression=expr,
            returnByValue=True,
            awaitPromise=await_promise,
        )
        if r.get("exceptionDetails"):
            raise RuntimeError(str(r["exceptionDetails"])[:400])
        return r.get("result", {}).get("value")

    def goto(self, url):
        self.send("Page.navigate", url=url)
        time.sleep(2.5)

    def wait(self, expr, timeout=25, interval=0.5):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.eval(expr):
                    return True
            except Exception:
                pass
            time.sleep(interval)
        return False

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            urllib.request.urlopen(f"{CDP_URL}/json/close/{self.target['id']}")
        except Exception:
            pass


print(f"\n=== ORATOR browser E2E ===\nAPP: {APP}\n")

c = CDP()
c.send("Page.enable")
c.send("Runtime.enable")

try:
    # ---------- 1. DASHBOARD ----------
    print("\n--- 1. Dashboard ---")
    c.goto(APP + "/")
    ok("app shell loaded", c.wait("!!document.querySelector('#view') && document.querySelector('#view').innerHTML.length > 500", 25))
    ok("no JS exceptions on boot", len(c.errors) == 0, str(c.errors[:2]))
    ok("streak badge populated", c.eval("document.querySelector('#streakVal')?.textContent") is not None)
    # The chrome shows a human label, not the raw model id.
    ok("live coach status shown", "live coach" in (c.eval("document.querySelector('#modelVal')?.textContent") or "").lower(),
       c.eval("document.querySelector('#modelVal')?.textContent"))
    ok("no raw model id leaked into the UI",
       "gemini-" not in (c.eval("document.body.innerText") or ""),
       (c.eval("document.body.innerText") or "")[:200])
    nrows = c.eval("document.querySelectorAll('table tbody tr').length")
    ok("curriculum table has rows", (nrows or 0) > 0, f"rows={nrows}")
    ok("nav lists modules", c.eval("document.querySelectorAll('.nav-item').length") >= 4)
    tiles = c.eval("Array.from(document.querySelectorAll('.stat .v')).map(e=>e.textContent)")
    ok("stat tiles rendered", bool(tiles) and len(tiles) >= 4, str(tiles))

    # ---------- 2. MODULE PAGE ----------
    print("\n--- 2. Module player ---")
    c.eval("document.querySelectorAll('.nav-item')[3].click()")  # first module
    ok("module page rendered", c.wait("!!document.querySelector('.concept')", 20))
    title = c.eval("document.querySelector('.card h2')?.textContent")
    ok("module title present", bool(title), str(title))
    ok("objectives listed", c.eval("document.querySelectorAll('.criteria li').length") > 0)

    # expand a concept
    c.eval("document.querySelector('.concept-head').click()")
    time.sleep(0.6)
    ok("concept expands", c.eval("getComputedStyle(document.querySelector('.concept-body')).display") != "none")
    detail_words = c.eval("document.querySelector('.concept-body .principles')?.children.length || 0")
    ok("concept has principles", (detail_words or 0) > 0, f"n={detail_words}")

    # tabs
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Frameworks')).click()")
    time.sleep(0.6)
    ok("frameworks tab renders", c.eval("!!document.querySelector('.frame-step')"))
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Scenarios')).click()")
    time.sleep(0.6)
    ok("scenarios tab renders", c.eval("document.querySelectorAll('.scenario').length > 0"))
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Assessment')).click()")
    time.sleep(0.6)
    ok("assessment rubric renders", c.eval("!!document.querySelector('table') && document.querySelectorAll('table tbody tr').length > 0"))

    # ---------- 3. IMAGE GENERATION ----------
    print("\n--- 3. Concept diagram generation ---")
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Concepts')).click()")
    time.sleep(0.5)
    c.eval("document.querySelector('.concept-head').click()")
    time.sleep(0.5)
    c.eval("document.querySelector('.gen-btn').click()")
    generated = c.wait(
        "(()=>{const i=document.querySelector('.diagram'); return i && i.src && i.src.includes('/assets/generated/') && i.naturalWidth>50})()",
        90, 2.0,
    )
    ok("diagram image generated and rendered", bool(generated),
       c.eval("document.querySelector('.diagram')?.src?.slice(0,120)"))

    # ---------- 4. SCENARIO REVEAL ----------
    print("\n--- 4. Scenario reveal + grading ---")
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Scenarios')).click()")
    time.sleep(0.5)
    c.eval("document.querySelector('.scenario .option').click()")
    ok("option reveals with rating", c.wait(
        "!!document.querySelector('.scenario .option.excellent, .scenario .option.good, .scenario .option.fair, .scenario .option.poor')",
        20))
    ok("coach feedback shown", c.eval("document.querySelector('.scenario').innerText.includes('Coach feedback')"))

    # ---------- 5. TUTOR SSE ----------
    print("\n--- 5. Tutor streaming ---")
    c.eval("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Tutor')).click()")
    time.sleep(1.2)
    ok("tutor view rendered", c.eval("!!document.querySelector('#chatInput')"))
    c.eval("""(()=>{const t=document.querySelector('#chatInput'); t.value='Why do my talks lose the room in the first 90 seconds? Give me one drill.';})()""")
    c.eval("document.querySelector('#chatSend').click()")
    # Wait for the stream to COMPLETE, not just to be long - the tutor always
    # ends with a "Do this next:" action and we want to assert on the full text.
    streamed = c.wait(
        "(()=>{const b=document.querySelector('#streamBubble'); if(!b) return false;"
        " if(b.dataset.streaming!=='false') return false; return (b.textContent||'').length > 250})()",
        90, 1.0,
    )
    txt = c.eval("document.querySelector('#streamBubble')?.innerText || ''")
    ok("tutor streamed a real answer", bool(streamed), f"len={len(txt)}")
    ok("tutor answer is substantive", len(txt) > 200, f"len={len(txt)}")
    # The tutor ends with a "Do this next:" action. In the rendered DOM the
    # markdown ** ** becomes <strong>, so the text may be split across nodes -
    # check the raw text content, not innerText of a single node.
    ok("tutor gives a next action",
       "Do this next" in (c.eval("document.querySelector('#streamBubble')?.textContent") or ""),
       (c.eval("document.querySelector('#streamBubble')?.textContent") or "")[-160:])

    # ---------- 6. PROGRESS PERSISTENCE ----------
    print("\n--- 6. Progress tracking ---")
    c.goto(APP + "/")
    time.sleep(2.5)
    c.eval("document.querySelectorAll('.nav-item')[3].click()")
    time.sleep(1.8)
    c.eval("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Concepts')).click()")
    time.sleep(0.5)
    c.eval("document.querySelector('.concept-head').click()")
    time.sleep(0.8)

    # The module completion percentage is the big number in the "Your progress"
    # card, not a .stat tile.
    PCT = "(()=>{const s=document.querySelector('.player').lastElementChild; const n=s.querySelector('div[style*=\"font-size: 30px\"]'); return n?n.textContent.trim():null})()"
    before = c.eval(PCT)
    ok("progress percentage visible", before is not None, str(before))

    # Toggle the first concept's complete button, whatever its current state.
    clicked = c.eval("""(()=>{
      const h = document.querySelector('.concept');
      const btn = h.querySelector('.btn');
      if (!btn) return false;
      btn.click();
      return true;
    })()""")
    ok("concept toggle button present", bool(clicked))
    time.sleep(2.2)
    after = c.eval(PCT)
    ok("concept completion updates progress", before != after, f"{before} -> {after}")

    # Reload and confirm the progress survived (it lives in SQLite, not the DOM).
    c.goto(APP + "/")
    time.sleep(2.5)
    c.eval("document.querySelectorAll('.nav-item')[3].click()")
    time.sleep(2.2)
    persisted = c.eval(PCT)
    ok("progress persisted across reload", persisted == after, f"{after} -> {persisted}")
    ok("progress is a valid percentage", str(persisted).endswith("%"), str(persisted))

    # ---------- 7. LIVE COACH (real WS session in the browser) ----------
    print("\n--- 7. Live coach studio ---")
    c.eval("Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.includes('Studio')).click()")
    time.sleep(1.4)
    ok("studio renders", c.eval("!!document.querySelector('#btnConnect')"))
    ok("voice selector populated", c.eval("document.querySelector('#studioVoice')?.options.length > 0"))

    # Start the session. The headless browser has no microphone, so getUserMedia
    # will fail - that is expected and must not break the coach session.
    c.eval("document.querySelector('#btnConnect').click()")
    live_up = c.wait(
        "(()=>{const s=document.querySelector('#studioStatus'); return s && /Live|Speak now/i.test(s.textContent)})()",
        45, 1.0,
    )
    ok("live session reaches Live state", bool(live_up),
       c.eval("document.querySelector('#studioStatus')?.textContent"))

    # The coach must actually speak: transcript lines and audio bytes.
    got_transcript = c.wait(
        "(()=>{const t=document.querySelector('#transcript'); return t && t.innerText.length > 120})()",
        45, 1.0,
    )
    ttxt = c.eval("document.querySelector('#transcript')?.innerText || ''")
    ok("coach transcript appears", bool(got_transcript), f"len={len(ttxt)}")
    ok("coach spoke substantive content", len(ttxt) > 100, ttxt[:150])

    # The client must have received PCM audio frames to play back.
    got_audio = c.wait("(()=>window.__oratorAudioChunks > 0)()", 30, 0.7)
    nchunks = c.eval("window.__oratorAudioChunks || 0")
    ok("coach audio frames delivered to client", bool(got_audio), f"chunks={nchunks}")

    c.eval("document.querySelector('#btnStop').click()")
    time.sleep(1.0)
    ok("session stops cleanly", c.eval("document.querySelector('#studioStatus')?.textContent").lower().find("end") >= 0,
       c.eval("document.querySelector('#studioStatus')?.textContent"))

except Exception as e:
    print(f"\n  EXCEPTION during test: {e}")
    import traceback
    traceback.print_exc()
    failures.append("exception")

print("\n--- console errors ---")
for t, m in c.console:
    if t in ("error", "warning"):
        print(f"  [{t}] {m[:200]}")
for e in c.errors[:8]:
    print(f"  [exception] {e[:200]}")

c.close()

print("\n" + "=" * 52)
print(f"{checks - len(failures)}/{checks} checks passed")
if failures:
    print("FAILED: " + ", ".join(failures))
    sys.exit(1)
print("ALL BROWSER E2E CHECKS PASSED")
