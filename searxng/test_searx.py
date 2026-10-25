#!/usr/bin/env python3
"""Loopback-only regression tests for the searx CLI."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(self.server.response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class SearxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        except PermissionError:
            raise unittest.SkipTest("sandbox blocks local sockets; mocked search tests still run")
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def run_searx(self, body, *args):
        self.server.response = body
        env = {**os.environ,
               "SEARXNG_URL": f"http://127.0.0.1:{self.server.server_port}",
               "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1",
               "PYTHONIOENCODING": "utf-8"}
        return subprocess.run(
            [sys.executable, str(Path(__file__).with_name("searx")), "test", *args],
            env=env, capture_output=True, timeout=5)

    def test_control_characters_in_all_text_fields(self):
        controls = "".join(chr(i) for i in (*range(32), *range(127, 160)))
        result = self.run_searx({
            "results": [{"title": "Title\x1b[2J" + controls,
                         "url": "https://example.test/" + controls,
                         "engines": ["engine" + controls],
                         "publishedDate": "today" + controls}],
            "unresponsive_engines": [["failed" + controls, "reason" + controls]],
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(b"\x1b", result.stdout + result.stderr)
        self.assertEqual(result.stdout.decode(),
                         "1. Title[2J\n   https://example.test/\n   [engine] today\n")
        self.assertEqual(result.stderr, b"unresponsive: failed (reason)\n")

    def test_bad_response_shapes(self):
        for body in ([], "x", None, 1, {}, {"results": None},
                     {"results": {}}, {"results": "x"},
                     {"results": [None]}, {"results": [{}] * 10 + ["x"]}):
            for args in ((), ("--json",)):
                with self.subTest(body=body, args=args):
                    result = self.run_searx(body, *args)
                    self.assertEqual(result.returncode, 3, result.stderr)
                    self.assertIn(b"unreachable or bad response", result.stderr)
                    self.assertNotIn(b"Traceback", result.stderr)
                    self.assertEqual(result.stdout, b"")

    def test_single_result(self):
        result = self.run_searx({"results": [{"title": "Title",
                                             "url": "https://example.test/",
                                             "engines": ["engine"]}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout,
                         b"1. Title\n   https://example.test/\n   [engine]\n")
        self.assertEqual(result.stderr, b"")

    def test_json_preserves_data_and_result_limit(self):
        controls = "\x00\x1b\x7f\x85\x9f"
        item = {"title": controls, "url": controls, "engines": [controls],
                "publishedDate": controls}
        body = {"results": [item, item], "unresponsive_engines": [[controls, controls]]}
        result = self.run_searx(body, "--json", "-n", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {**body, "results": [item]}
        self.assertEqual(result.stdout.decode(), json.dumps(expected, indent=2) + "\n")
        self.assertEqual(result.stderr, b"")

    def test_empty_results(self):
        result = self.run_searx({"results": []})
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")


if __name__ == "__main__":
    unittest.main()
