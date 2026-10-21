#!/usr/bin/env python3
"""Check App Runner service status without the aws CLI (which is misbehaving)."""
import json, os, urllib.request, boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = "orator"

try:
    sess = boto3.Session(profile_name="hermes", region_name=REGION)
    ar = sess.client("apprunner", config=Config(retries={"max_attempts": 3}))
    svc = ar.describe_service(ServiceName=NAME)["Service"]
    print("status:", svc["Status"])
    print("url:   https://" + svc["ServiceUrl"])
    for e in svc.get("RuntimeEnvironmentVariables", {}).items():
        k, v = e
        print(f"  env {k} = {(v[:10] + '...') if 'KEY' in k.upper() else v}")
    if svc.get("LatestDeployment"):
        ld = svc["LatestDeployment"]
        print("deployment status:", ld.get("Status"))
except Exception as e:
    print("boto3 path failed:", type(e).__name__, str(e)[:200])
    out = os.popen(f"aws apprunner describe-service --service-name {NAME} --region {REGION} 2>&1").read()
    print(out[:1500])
