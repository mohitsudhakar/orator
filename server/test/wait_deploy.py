#!/usr/bin/env python3
"""Poll an App Runner service until it is RUNNING, then verify it serves."""
import json, subprocess, sys, time, urllib.request

REGION = "us-east-1"
NAME = "orator"


def aws(*args):
    out = subprocess.run(["aws", *args, "--region", REGION], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    try:
        return json.loads(out.stdout)
    except Exception:
        return None


def status():
    d = aws("apprunner", "describe-service", "--service-name", NAME)
    if not d:
        return None, None
    s = d.get("Service", {})
    return s.get("Status"), s.get("ServiceUrl")


print(f"polling App Runner service '{NAME}' in {REGION}...")
deadline = time.time() + 600
last = None
while time.time() < deadline:
    st, url = status()
    if st != last:
        print(f"  status: {st}")
        last = st
    if st == "RUNNING":
        print(f"\nSERVICE RUNNING: https://{url}")
        # Verify the app actually serves and the curriculum loaded.
        base = f"https://{url}"
        for attempt in range(6):
            try:
                with urllib.request.urlopen(f"{base}/api/health", timeout=20) as r:
                    health = json.load(r)
                print(f"  health: ok={health.get('ok')} modules={health.get('modules')} valid={health.get('curriculumValid')}")
                if not health.get("ok"):
                    print("  !! health not ok")
                break
            except Exception as e:
                print(f"  waiting for the service to accept traffic... ({e.__class__.__name__})")
                time.sleep(8)
        with urllib.request.urlopen(f"{base}/api/catalogue", timeout=20) as r:
            cat = json.load(r)
        print(f"  catalogue: {len(cat['modules'])} modules")
        for m in cat["modules"][:3]:
            print(f"    {m['id']} {m['title'][:48]}")
        # Check the static site serves.
        with urllib.request.urlopen(base, timeout=20) as r:
            html = r.read().decode("utf-8", "replace")
        print(f"  html: {len(html)} bytes, title present={'ORATOR' in html}")
        sys.exit(0)
    if st in ("FAILED", "DELETED"):
        print(f"\nSERVICE {st}")
        logs = aws("apprunner", "describe-service", "--service-name", NAME)
        sys.exit(1)
    time.sleep(15)

print("\nTIMED OUT waiting for the service")
sys.exit(1)
