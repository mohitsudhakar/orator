#!/usr/bin/env python3
"""Wait for the orator-app service to finish deploying, then verify it serves."""
import json, sys, time, urllib.request
import boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = "orator-app"

ar = boto3.Session(profile_name="hermes", region_name=REGION).client(
    "apprunner", config=Config(retries={"max_attempts": 3}))

svc = next((s for s in ar.list_services()["ServiceSummaryList"] if s["ServiceName"] == NAME), None)
if not svc:
    print("service not found"); sys.exit(1)
arn = svc["ServiceArn"]
print("waiting for", NAME, svc["Status"], flush=True)

deadline = time.time() + 900
last = None
while time.time() < deadline:
    s = ar.describe_service(ServiceArn=arn)["Service"]
    ld = s.get("LatestDeployment") or {}
    cur = (s["Status"], ld.get("Status"))
    if cur != last:
        print(f"  service={cur[0]}  deployment={cur[1]}", flush=True)
        last = cur
    if cur[0] == "RUNNING" and cur[1] in ("SUCCEEDED", None):
        base = "https://" + s["ServiceUrl"]
        print("\nRUNNING:", base, flush=True)
        for _ in range(8):
            try:
                with urllib.request.urlopen(f"{base}/api/health", timeout=25) as r:
                    h = json.load(r)
                print(f"  health: ok={h.get('ok')} modules={h.get('modules')} valid={h.get('curriculumValid')}")
                break
            except Exception as e:
                print(f"  waiting for traffic... ({type(e).__name__})", flush=True)
                time.sleep(8)
        json.dump({"url": base, "arn": arn}, open("/tmp/orator_deploy.json", "w"))
        sys.exit(0)
    if cur[0] in ("FAILED", "DELETED") or cur[1] == "FAILED":
        print(f"\nFAILED: {cur}")
        sys.exit(1)
    time.sleep(15)
print("\nTIMED OUT")
sys.exit(1)
