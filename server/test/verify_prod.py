#!/usr/bin/env python3
"""Verify the DEPLOYED service on App Runner actually works end to end."""
import json, sys, time, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://g7mwjppb42.us-east-1.awsapprunner.com"
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


def get(path, timeout=30):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
        return r.status, r.read()


print(f"=== verifying {BASE} ===")

# 1. Health
status, body = get("/api/health")
h = json.loads(body)
ok("health returns 200", status == 200, str(status))
ok("health ok", h.get("ok") is True, json.dumps(h)[:200])
ok("all 12 modules loaded", h.get("modules") == 12, f"modules={h.get('modules')}")
ok("curriculum valid", h.get("curriculumValid") is True, json.dumps(h.get("curriculumErrors"))[:300])
ok("live model configured", h.get("models", {}).get("live", "").startswith("gemini-"), str(h.get("models")))
ok("tutor model configured", h.get("models", {}).get("tutor", "").startswith("gemini-"), str(h.get("models")))

# 2. Catalogue
status, body = get("/api/catalogue")
cat = json.loads(body)
ok("catalogue returns 200", status == 200)
ok("catalogue has 12 modules", len(cat["modules"]) == 12, f"n={len(cat['modules'])}")
ok("module detail is populated", all(m["conceptCount"] >= 5 for m in cat["modules"]),
   str([m["conceptCount"] for m in cat["modules"]]))
ok("stats present", "stats" in cat and "streak" in cat)

# 3. A full module
first = cat["modules"][0]["id"]
status, body = get(f"/api/modules/{first}")
mod = json.loads(body)
ok("module fetch returns 200", status == 200)
ok("module has concepts", len(mod["module"]["concepts"]) >= 5)
ok("module has scenarios", len(mod["module"]["scenarios"]) >= 4)
ok("module has exercises", len(mod["module"]["exercises"]) >= 5)
ok("rubric sums to 100",
   sum(r["weight"] for r in mod["module"]["assessment"]["rubric"]) == 100)
ok("every concept has an image prompt",
   all(c.get("imagePrompt") for c in mod["module"]["concepts"]))
ok("every exercise has a live coach prompt",
   all(e.get("liveCoachPrompt") for e in mod["module"]["exercises"]))

# 4. Static site
status, body = get("/")
html = body.decode("utf-8", "replace")
ok("static site returns 200", status == 200)
ok("html has the app shell", "ORATOR" in html and 'id="view"' in html, html[:200])
status, body = get("/app.js")
ok("app.js served", status == 200 and len(body) > 20000, f"len={len(body)}")
status, body = get("/styles.css")
ok("styles.css served", status == 200 and len(body) > 5000, f"len={len(body)}")

# 5. A real tutor round trip (this exercises the API key on the deployed box)
print("\n--- tutor round trip (exercises the deployed API key) ---")
req = urllib.request.Request(
    f"{BASE}/api/tutor/stream",
    data=json.dumps({"prompt": "Give me ONE drill for pausing before a key line. Three sentences."}).encode(),
    headers={"Content-Type": "application/json"},
)
text = ""
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                d = json.loads(line[5:].strip())
            except Exception:
                continue
            if d.get("text"):
                text += d["text"]
            if d.get("error"):
                ok("tutor stream had no error", False, d["error"])
except Exception as e:
    ok("tutor stream succeeded", False, f"{type(e).__name__}: {e}")

ok("tutor returned content", len(text) > 200, f"len={len(text)}")
ok("tutor is markdown-formatted", "**" in text or "\n-" in text or "\n##" in text, text[:200])
ok("tutor gives a next action", "Do this next" in text, text[-200:])
print(f"\n  tutor said ({len(text)} chars):\n  " + text[:420].replace("\n", "\n  "))

# 6. A real session analysis (exercises the metrics engine on the deployed box)
print("\n--- session analysis ---")
import math
SR = 16000
dur = 2.0
n = int(SR * dur)
pcm = bytearray()
phase = 0.0
for i in range(n):
    t = i / SR
    phase += (2 * math.pi * 120) / SR
    s = sum(math.sin(h * phase) / h for h in range(1, 5))
    pcm += int(max(-1, min(1, s * 0.3)) * 32767).to_bytes(2, "little", signed=True)
import base64
req = urllib.request.Request(
    f"{BASE}/api/sessions",
    data=json.dumps({
        "moduleId": first, "exerciseId": "e1", "kind": "test",
        "transcript": "We rebuilt the pipeline. Latency fell. Customers noticed.",
        "words": [
            {"word": "We", "start": 0.0, "end": 0.3},
            {"word": "rebuilt", "start": 0.4, "end": 0.8},
            {"word": "the", "start": 0.9, "end": 1.1},
            {"word": "pipeline", "start": 1.2, "end": 1.7},
            {"word": "Latency", "start": 2.2, "end": 2.6},
            {"word": "fell", "start": 2.7, "end": 3.0},
            {"word": "Customers", "start": 3.1, "end": 3.6},
            {"word": "noticed", "start": 3.7, "end": 4.1},
        ],
        "pcmBase64": base64.b64encode(bytes(pcm)).decode(),
        "sampleRate": SR, "durationSec": 4.1,
    }).encode(),
    headers={"Content-Type": "application/json"},
)
status, body = get.__self__ if False else (None, None)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        status = r.status
        sres = json.loads(r.read())
    ok("session analysis returns 200", status == 200)
    ok("session scored", isinstance(sres["metrics"]["scores"]["overall"], int), str(sres["metrics"]["scores"])[:200])
    ok("wpm computed", sres["metrics"]["wpm"] > 0, str(sres["metrics"]["wpm"]))
    ok("pause detected from the 0.5s gap", sres["metrics"]["pauses"]["count"] >= 1,
       json.dumps(sres["metrics"]["pauses"])[:200])
    ok("pitch detected", sres["metrics"]["pitch"]["medianF0"] > 0, str(sres["metrics"]["pitch"]))
    ok("coach notes produced", len(sres["coach"]) >= 1, str(len(sres["coach"])))
    print(f"  score={sres['metrics']['scores']['overall']} wpm={sres['metrics']['wpm']} "
          f"pitch={sres['metrics']['pitch']['medianF0']}Hz pauses={sres['metrics']['pauses']['count']}")
except Exception as e:
    ok("session analysis succeeded", False, f"{type(e).__name__}: {e}")

print("\n" + "=" * 52)
print(f"{checks - fails}/{checks} checks passed")
sys.exit(1 if fails else 0)
