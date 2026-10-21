#!/usr/bin/env python3
"""Create the App Runner service fresh, with the API key, and wait for it."""
import json, os, sys, time
import boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = os.environ.get("ORATOR_SERVICE_NAME", "orator-app")
REPO = "https://github.com/mohitsudhakar/orator"
CONN = "arn:aws:apprunner:us-east-1:530751794826:connection/github/f801bdf2f9074fc58b57ac2633e568c2"

sess = boto3.Session(profile_name="hermes", region_name=REGION)
ar = sess.client("apprunner", config=Config(retries={"max_attempts": 3}))

key = None
for line in open(os.path.expanduser("~/.hermes/.env")):
    if line.startswith("GEMINI_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not key:
    print("NO KEY"); sys.exit(1)

ENV = {
    "PORT": "3000",
    "ORATOR_DATA_DIR": "/var/task/data",
    "NODE_ENV": "production",
    "GEMINI_API_KEY": key,
}


def find():
    for s in ar.list_services()["ServiceSummaryList"]:
        if s["ServiceName"] == NAME:
            return s
    return None


existing = find()
if existing:
    print(f"service '{NAME}' already exists: {existing['Status']}")
    arn = existing["ServiceArn"]
else:
    print(f"creating service '{NAME}'...")
    r = ar.create_service(
        ServiceName=NAME,
        SourceConfiguration={
            "CodeRepository": {
                "RepositoryUrl": REPO,
                "SourceCodeVersion": {"Type": "BRANCH", "Value": "main"},
                "SourceDirectory": ".",
                "CodeConfiguration": {
                    "ConfigurationSource": "API",
                    "CodeConfigurationValues": {
                        "BuildCommand": "npm install --omit=dev",
                        "StartCommand": "node server/index.js",
                        "Runtime": "NODEJS_22",
                        "RuntimeEnvironmentVariables": ENV,
                    },
                },
            },
            "AuthenticationConfiguration": {"ConnectionArn": CONN},
            "AutoDeploymentsEnabled": True,
        },
    )["Service"]
    arn = r["ServiceArn"]
    print("  created:", r["Status"], arn)

print("waiting for RUNNING...")
deadline = time.time() + 900
last = None
while time.time() < deadline:
    s = ar.describe_service(ServiceArn=arn)["Service"]
    st = s["Status"]
    if st != last:
        print(f"  {st}  (deploy: {(s.get('LatestDeployment') or {}).get('Status')})", flush=True)
        last = st
    if st == "RUNNING":
        print("\nURL: https://" + s["ServiceUrl"])
        print("ARN:", arn)
        json.dump({"arn": arn, "url": "https://" + s["ServiceUrl"], "name": NAME},
                  open("/tmp/orator_deploy.json", "w"))
        sys.exit(0)
    if st in ("FAILED", "DELETED"):
        print(f"\nSERVICE {st}")
        sys.exit(1)
    time.sleep(15)
print("\nTIMED OUT")
sys.exit(1)
