#!/usr/bin/env python3
"""Offline compile-command fixture: stdin prompt, stdout extraction JSON."""
import json
import os
from pathlib import Path
import sys

prompt = sys.stdin.read()
payload = json.loads(prompt.split("INPUT JSON:\n", 1)[1])
counter = os.environ.get("STUB_CALL_LOG")
if counter:
    with open(counter, "a") as stream:
        stream.write(json.dumps(payload) + "\n")
mode = os.environ.get("STUB_MODE", "npm")
if mode == "fail":
    print("not valid JSON")
elif mode == "pricing" and "embedded_json" in payload:
    print('{"need_html":true}')
else:
    filename = "pricing-schema.json" if mode == "pricing" else "npm-schema.json"
    schema = json.loads((Path(__file__).parent / filename).read_text())
    if mode == "broken" or mode == "refine" and not payload.get("validation_failures"):
        schema["paths"]["license"] = "nonexistent.license"
    print(json.dumps(schema))
