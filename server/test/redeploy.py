#!/usr/bin/env python3
"""Trigger a deployment of the existing App Runner service and wait for it."""
import json, os, sys, time
import boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = "orator-app"

sess = boto3.Session(profile_name="hermes", region_name=REGION)
ar = sess.client("apprunner", config=Config(retries={"max_attempts": 3}))

svc = None
for s in ar.list_services()["ServiceSummaryList"]:
    if s["ServiceName"] == NAME:
        svc = s
        break
if not svc:
    print("service not found")
    sys.exit(1)
arn = svc["ServiceArn"]
print("service:", NAME, svc["Status"])

# start_deployment only accepts ServiceArn when the service already has its
# source configuration - the configuration is reused from the service.
d = ar.start_deployment(ServiceArn=arn)["Deployment"]
print("deployment started:", d["Status"], d["DeploymentId"])

deadline = time.time() + 900
last = None
while time.time() < deadline:
    s = ar.describe_service(ServiceArn=arn)["Service"]
    ld = s.get("LatestDeployment") or {}
    st, ds = s["Status"], ld.get("Status")
    if (st, ds) != last:
        print(f"  service={st} deployment={ds}", flush=True)
        last = (st, ds)
    if st == "RUNNING" and ds in ("SUCCEEDED", None):
        print("\nURL: https://" + s["ServiceUrl"])
        json.dump({"url": "https://" + s["ServiceUrl"], "arn": arn},
                  open("/tmp/orator_deploy.json", "w"))
        sys.exit(0)
    if st in ("FAILED", "DELETED") or ds == "FAILED":
        print(f"\nFAILED: service={st} deployment={ds}")
        sys.exit(1)
    time.sleep(15)
print("\nTIMED OUT")
sys.exit(1)
