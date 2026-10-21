#!/usr/bin/env python3
"""Diagnose the App Runner deployment via boto3 (the AWS CLI here is missing commands)."""
import json, sys
import boto3
from botocore.config import Config

REGION = "us-east-1"
ARN = "arn:aws:apprunner:us-east-1:530751794826:service/orator/be0d9796e30248feb6d962b4a7bf671f"

sess = boto3.Session(profile_name="hermes", region_name=REGION)
ar = sess.client("apprunner", config=Config(retries={"max_attempts": 3}))

s = ar.describe_service(ServiceArn=ARN)["Service"]
print("status: ", s["Status"])
print("url:    https://" + s["ServiceUrl"])
print("health: ", s.get("HealthCheckStatus"))
ld = s.get("LatestDeployment") or {}
print("deploy: ", ld.get("Status"), ld.get("DeploymentId"))
print("env:    ", {k: (v[:8] + "..." if "KEY" in k.upper() else v) for k, v in (s.get("RuntimeEnvironmentVariables") or {}).items()})

print("\n=== DEPLOYMENT EVENTS ===")
try:
    for e in ar.list_deployment_events(ServiceArn=ARN, MaxResults=30).get("DeploymentEvents", []):
        print(f"  {str(e.get('EventDate'))[:19]}  {e.get('Status'):12} {str(e.get('Description',''))[:170]}")
except Exception as e:
    print("  events error:", str(e)[:200])

print("\n=== OPERATIONS ===")
try:
    for o in ar.list_operations(ServiceArn=ARN).get("Operations", [])[:6]:
        print(f"  {str(o.get('StartedAt'))[:19]} {o.get('Type')} {o.get('Status')} {str(o.get('ErrorMessage',''))[:200]}")
except Exception as e:
    print("  ops error:", str(e)[:200])
