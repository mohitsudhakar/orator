#!/usr/bin/env python3
"""Wait for the App Runner service to go RUNNING, then verify it serves."""
import json, subprocess, sys, time, urllib.request

REGION = "us-east-1"
NAME = "orator"
ARN = "arn:aws:apprunner:us-east-1:530751794826:service/orator/be0d9796e30248feb6d962b4a7bf671f"


def aws_json(*args):
    out = subprocess.run(["aws", *args, "--region", REGION], capture_output=True, text=True)
    if out.returncode != 0:
        return None, (out.stderr or out.stdout)[:300]
    try:
        return json.loads(out.stdout), None
    except Exception as e:
        return None, str(e)[:200]


def describe():
    d, err = aws_json("apprunner", "describe-service", "--service-arn", ARN)
    if not d:
        return None, None, err
    s = d.get("Service", {})
    return s.get("Status"), s.get("ServiceUrl"), s


def main():
    print("polling App Runner service 'orator'...", flush=True)
    deadline = time.time() + 600
    last = None
    while time.time() < deadline:
        st, url, svc = describe()
        if st is None:
            print("  describe failed:", svc, flush=True)
        elif st != last:
            print(f"  status: {st}", flush=True)
            last = st
        if st == "RUNNING":
            base = f"https://{url}"
            print(f"\nSERVICE RUNNING: {base}", flush=True)
            for _ in range(8):
                try:
                    with urllib.request.urlopen(f"{base}/api/health", timeout=25) as r:
                        h = json.load(r)
                    print(f"  health: ok={h.get('ok')} modules={h.get('modules')} curriculumValid={h.get('curriculumValid')}")
                    if h.get("curriculumValid") is False:
                        print("  !! curriculum invalid:", h.get("curriculumErrors"))
                    break
                except Exception as e:
                    print(f"  waiting for traffic... ({type(e).__name__})", flush=True)
                    time.sleep(8)
            try:
                with urllib.request.urlopen(f"{base}/api/catalogue", timeout=25) as r:
                    cat = json.load(r)
                print(f"  catalogue: {len(cat['modules'])} modules")
                for m in cat["modules"]:
                    print(f"    {m['id']} {m['title'][:52]}")
            except Exception as e:
                print("  catalogue failed:", e)
            try:
                with urllib.request.urlopen(base, timeout=25) as r:
                    html = r.read().decode("utf-8", "replace")
                print(f"  html: {len(html)} bytes, ORATOR present={'ORATOR' in html}")
            except Exception as e:
                print("  static failed:", e)
            return 0
        if st in ("FAILED", "DELETED"):
            print(f"\nSERVICE {st}")
            return 1
        time.sleep(15)
    print("\nTIMED OUT")
    return 1


sys.exit(main())
