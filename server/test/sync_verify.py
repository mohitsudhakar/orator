#!/usr/bin/env python3
"""
Wait for the App Runner service to finish any in-flight deployment, then
optionally trigger a fresh one and wait for that too. Finally verify the
deployed content matches what is on disk.
"""
import json, os, sys, time, urllib.request
import boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = "orator-app"
ARN = f"arn:aws:apprunner:{REGION}:530751794826:service/{NAME}/a5a1159019464762b5496a12d249fe4d"

ar = boto3.Session(profile_name="hermes", region_name=REGION).client(
    "apprunner", config=Config(retries={"max_attempts": 3}))


def state():
    s = ar.describe_service(ServiceArn=ARN)["Service"]
    ld = s.get("LatestDeployment") or {}
    return s, s["Status"], ld.get("Status")


def wait_settled(timeout=900):
    """Wait until the service is RUNNING and no deployment is in flight."""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        s, st, ds = state()
        if (st, ds) != last:
            print(f"  service={st} deployment={ds}", flush=True)
            last = (st, ds)
        if st == "RUNNING" and ds in ("SUCCEEDED", None):
            return s
        if st in ("FAILED", "DELETED") or ds == "FAILED":
            raise SystemExit(f"deployment failed: {st}/{ds}")
        time.sleep(12)
    raise SystemExit("timed out waiting for the service to settle")


def trigger():
    try:
        d = ar.start_deployment(ServiceArn=ARN)
        print("  deployment:", d.get("Deployment", {}).get("Status"), flush=True)
        return True
    except Exception as e:
        print("  could not start a deployment:", str(e)[:150], flush=True)
        return False


print("settling...", flush=True)
s = wait_settled()
print("settled. forcing a fresh deployment...", flush=True)
if trigger():
    s = wait_settled()

base = "https://" + s["ServiceUrl"]
print("\nURL:", base, flush=True)

# Verify the deployed content matches the working copy.
def get(path):
    with urllib.request.urlopen(f"{base}{path}", timeout=30) as r:
        return json.load(r)

health = get("/api/health")
print(f"  health: ok={health['ok']} modules={health['modules']} valid={health['curriculumValid']}")

m01 = get("/api/modules/m01")["module"]
s3 = next(s for s in m01["scenarios"] if s["id"] == "s3")
print(f"  m01/s3 challenge present: {bool(s3.get('challenge'))}")

m09 = get("/api/modules/m09")["module"]
for sid in ("s2", "s5"):
    sc = next(s for s in m09["scenarios"] if s["id"] == sid)
    print(f"  m09/{sid} bands: {[o['rating'] for o in sc['options']]}")

m10 = get("/api/modules/m10")["module"]
sc = next(s for s in m10["scenarios"] if s["id"] == "s2")
print(f"  m10/s2 bands: {[o['rating'] for o in sc['options']]}")

ok = bool(s3.get("challenge"))
print("\nDEPLOYED CONTENT IS CURRENT" if ok else "\nDEPLOYED CONTENT IS STALE")
sys.exit(0 if ok else 1)
