import argparse


import hashlib


import http.client


import ipaddress


import json


import math


import os


from pathlib import Path


import re


import shlex


import shutil


import socket


import subprocess


import sys


import tempfile


from datetime import datetime, timezone


from html.parser import HTMLParser


from urllib.error import HTTPError, URLError


from urllib.parse import quote, urlsplit


from urllib.request import HTTPHandler, HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent


FETCH_CAP = 8 * 1024 * 1024


PROMPT_CAP = 120000


USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"


class ReaderError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def json_object(output):
    # Prefer explicitly fenced JSON, then tolerate CLI chatter around an object.
    for match in re.finditer(r"```json\s*\n?(.*?)```", output, re.DOTALL | re.IGNORECASE):
        try:
            value = json.loads(match.group(1))
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", output):
        try:
            value, _ = decoder.raw_decode(output, match.start())
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    raise ValueError("command returned no JSON object")


def page_hash(html):
    return hashlib.sha256(html.encode()).hexdigest()


