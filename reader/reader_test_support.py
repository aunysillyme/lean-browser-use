"""Offline reader regression checks using the standard library."""


import asyncio


import importlib.machinery


import importlib.util


import hashlib


import io


import json


import os


from pathlib import Path


import runpy


import shlex


import socket


import subprocess


import sys


import threading


from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


from unittest import mock


from urllib.error import HTTPError


from urllib.request import Request


import reader_test_harness as checks


ROOT = Path(__file__).resolve().parent


DATA = ROOT / "testdata"


REAL_SOCKET = socket.socket


REAL_GETADDRINFO = socket.getaddrinfo


loader = importlib.machinery.SourceFileLoader("page_reader", str(ROOT / "reader"))


module_spec = importlib.util.spec_from_loader(loader.name, loader)


reader = importlib.util.module_from_spec(module_spec)


loader.exec_module(reader)


helper = runpy.run_path(str(ROOT / "crawl_helper.py"))


@checks.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    monkeypatch.setenv("READER_SPECS_DIR", str(tmp_path / "specs"))
    monkeypatch.setenv("READER_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([sys.executable, str(DATA / "compile_stub.py")]))
    monkeypatch.setenv("STUB_CALL_LOG", str(tmp_path / "calls.jsonl"))
    monkeypatch.setenv("STUB_MODE", "npm")
    # Any accidental live network access fails the offline suite.
    monkeypatch.setattr(socket, "getaddrinfo", mock.Mock(side_effect=AssertionError("offline DNS")))
    monkeypatch.setattr(socket, "socket", mock.Mock(side_effect=AssertionError("offline socket")))


def calls():
    path = Path(os.environ["STUB_CALL_LOG"])
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def html(package="react"):
    return (DATA / f"npm-{package}.html").read_text()


def compile_npm():
    return reader.compile_spec("npm-package", "https://www.npmjs.com/package/{name}",
                               {"name": "react"}, "package name, latest version, weekly downloads, license, repository URL",
                               {"name": "react", "latest_version": "19.2.0", "weekly_downloads": 42000000,
                                "license": "MIT", "repository_url": "git+https://github.com/facebook/react.git"}, html())


PUBLIC_IP = ".".join(["93", "184", "216", "34"])


def public_address(ip=PUBLIC_IP):
    return (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443))


@checks.fixture
def anchor_compile(monkeypatch, tmp_path):
    schema = {"type": "embedded_json", "source": "__NEXT_DATA__", "rows": "models",
              "paths": {"model": "model", "input": "input", "output": "output"},
              "required": ["model", "input", "output"]}
    command = tmp_path / "anchor_compile.py"
    command.write_text('''import json, os, sys
payload = json.loads(sys.stdin.read().split("INPUT JSON:\\n", 1)[1])
with open(os.environ["STUB_CALL_LOG"], "a") as stream:
    stream.write(json.dumps(payload) + "\\n")
schema = json.loads(sys.argv[1])
if not payload.get("validation_failures") or os.environ["STUB_MODE"] == "anchor-broken":
    schema["transforms"] = {"model": {"regex": r"(Claude .* [0-9]+)"}}
print(json.dumps(schema))
''')
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([sys.executable, str(command), json.dumps(schema)]))
    rows = [{"model": "Claude Fable 5.1", "input": 10, "output": 50},
            {"model": "Claude Sonnet 5.5", "input": 2, "output": 10}]
    page = '<script id="__NEXT_DATA__">' + json.dumps({"models": rows}) + '</script>'
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (page, "urllib"))
    return rows


@checks.fixture
def local_http(monkeypatch):
    # Only these integration tests open sockets, all against local servers.
    monkeypatch.setattr(socket, "socket", REAL_SOCKET)
    monkeypatch.setattr(socket, "getaddrinfo", REAL_GETADDRINFO)
    pages = {}
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((f"http://127.0.0.1:{self.server.server_address[1]}", self.path))
            status, headers, body = pages.get(self.path, (200, {}, "<p>private</p>"))
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(body.encode())))
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *args):
            pass

    allowed = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = allowed.server_address[1]
    denied = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    servers = [allowed, denied]
    threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in servers]
    for thread in threads:
        thread.start()
    origin = f"http://127.0.0.1:{port}"
    denied_origin = f"http://127.0.0.1:{denied.server_address[1]}"
    monkeypatch.setenv("READER_TEST_ALLOW_ORIGIN", origin)
    monkeypatch.setenv("INSTABOX_HEADLESS", "1")
    try:
        yield origin, denied_origin, pages, requests
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=5)


@checks.fixture
def crwl_fetch_stub(monkeypatch, tmp_path):
    log = tmp_path / "crwl-calls.jsonl"
    executable = tmp_path / "crawl-python"
    executable.write_text(f'''#!{sys.executable}
import json
import os
from pathlib import Path
import sys
assert sys.argv[2:] == ["fetch"]
request = json.load(sys.stdin)
with open(os.environ["CRWL_FETCH_LOG"], "a") as stream:
    stream.write(json.dumps(request) + "\\n")
package = request["url"].rsplit("/", 1)[-1]
page = (Path({str(DATA)!r}) / ("npm-" + package + ".html")).read_text()
print("crwl: browser ready")
print(json.dumps({{"html": page, "success": True, "status_code": 200, "url": request["url"]}}))
''')
    executable.chmod(0o755)
    monkeypatch.setenv("READER_CRAWL4AI_PYTHON", str(executable))
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    monkeypatch.setenv("CRWL_FETCH_LOG", str(log))
    return log


