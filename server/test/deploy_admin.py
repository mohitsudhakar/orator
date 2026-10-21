#!/usr/bin/env python3
"""Recreate the App Runner service cleanly with the API key configured."""
import json, sys, time
import boto3
from botocore.config import Config

REGION = "us-east-1"
NAME = "orator"
ARN = f"arn:aws:apprunner:{REGION}:530751794826:service/{NAME}/be0d9796e30248feb6d962b4a7bf671f"

sess = boto3.Session(profile_name="hermes", region_name=REGION)
ar = sess.client("apprunner", config=Config(retries={"max_attempts": 3}))

# Read the key from the local env file.
key = None
for line in open(f"{__import__('os').path.expanduser('~')}/.hermes/.env"):
    if line.startswith("GEMINI_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not key:
    print("NO KEY FOUND")
    sys.exit(1)
print("key length:", len(key))

ACTION = sys.argv[1] if len(sys.argv) > 1 else "status"

if ACTION == "status":
    s = ar.describe_service(ServiceArn=ARN)["Service"]
    print("status:", s["Status"], "| health:", s.get("HealthCheckStatus"))
    print("env:", {k: (v[:8] + "..." if "KEY" in k.upper() else v)
                   for k, v in (s.get("RuntimeEnvironmentVariables") or {}).items()})

elif ACTION == "env":
    s = ar.update_service(
        ServiceArn=ARN,
        RuntimeEnvironmentVariables={
            "PORT": "3000",
            "ORATOR_DATA_DIR": "/var/task/data",
            "NODE_ENV": "production",
            "GEMINI_API_KEY": key,
        },
    )["Service"]
    print("updated. status:", s["Status"])

elif ACTION == "deploy":
    s = ar.start_deployment(
        ServiceArn=ARN,
        SourceConfiguration={
            "CodeRepository": {
                "RepositoryUrl": "https://github.com/mohitsudhakar/orator",
                "SourceCodeVersion": {"Type": "BRANCH", "Value": "main"},
                "SourceDirectory": ".",
                "CodeConfiguration": {
                    "ConfigurationSource": "API",
                    "CodeConfigurationValues": {
                        "BuildCommand": "npm install --omit=dev",
                        "StartCommand": "node server/index.js",
                        "Runtime": "NODEJS_22",
                        "RuntimeEnvironmentVariables": {
                            "PORT": "3000",
                            "ORATOR_DATA_DIR": "/var/task/data",
                            "NODE_ENV": "production",
                            "GEMINI_API_KEY": key,
                        },
                    },
                },
            }
        },
    )["Deployment"]
    print("deployment:", s["Status"], s["DeploymentId"])

elif ACTION == "delete":
    ar.delete_service(ServiceArn=ARN)
    print("delete requested")
