#!/usr/bin/env python3
"""Check tutor stream completeness across several runs."""
import json, urllib.request

APP = "http://localhost:4173"
for i in range(4):
    req = urllib.request.Request(
        f"{APP}/api/tutor/stream",
        data=json.dumps({"prompt": "Why do my talks lose the room in the first 90 seconds? Give me one drill."}).encode(),
        headers={"Content-Type": "application/json"},
    )
    out = ""
    with urllib.request.urlopen(req, timeout=90) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                d = json.loads(line[5:].strip())
            except Exception:
                continue
            if d.get("text"):
                out += d["text"]
            if d.get("error"):
                print("  STREAM ERROR:", d["error"])
    print(f"run {i}: len={len(out)}  hasNextAction={'Do this next' in out}  tail={out[-60:]!r}")
