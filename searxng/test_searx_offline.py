"""Search request and output contracts with a mocked local response."""
from contextlib import redirect_stdout, redirect_stderr
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock
from urllib.parse import urlsplit, parse_qs
from urllib.error import URLError

loader = importlib.machinery.SourceFileLoader('search_command', str(Path(__file__).with_name('searx')))
spec = importlib.util.spec_from_loader(loader.name, loader)
search = importlib.util.module_from_spec(spec)
loader.exec_module(search)


class SearchOfflineTests(unittest.TestCase):
    def invoke(self, body, *args):
        out, err = io.StringIO(), io.StringIO()
        response = io.StringIO(json.dumps(body))
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(sys, 'argv', ['searx', 'test', *args]), mock.patch.object(search.urllib.request, 'urlopen', return_value=response) as opened, redirect_stdout(out), redirect_stderr(err):
            status = search.main()
            request = opened.call_args.args[0]
        return status, out.getvalue(), err.getvalue(), request

    def test_default_and_query_parameters(self):
        status, out, _, request = self.invoke({'results': [{'title': 'Page', 'url': 'https://example.com', 'engines': ['web']}]}, '--engines', 'bing,yahoo', '--time', 'week')
        self.assertEqual(status, 0)
        self.assertEqual(urlsplit(request.full_url).netloc, '127.0.0.1:8888')
        self.assertEqual(parse_qs(urlsplit(request.full_url).query)['engines'], ['bing,yahoo'])
        self.assertIn('Page', out)

    def test_empty_and_malformed(self):
        self.assertEqual(self.invoke({'results': []})[0], 1)
        for body in [None, [], {}, {'results': [None]}, {'results': 'wrong'}]:
            with self.subTest(body=body):
                status, out, err, _ = self.invoke(body)
                self.assertEqual(status, 3)
                self.assertEqual(out, '')
                self.assertIn('bad response', err)

    def test_json_limit_and_text_controls(self):
        item = {'title': 'Title\x1b', 'url': 'https://example.com/\x00', 'engines': ['web\x7f']}
        status, out, _, _ = self.invoke({'results': [item, item]}, '--json', '-n', '1')
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out)['results'], [item])
        _, out, _, _ = self.invoke({'results': [item]})
        self.assertNotIn('\x1b', out)
        self.assertNotIn('\x00', out)

    def test_unreachable(self):
        with mock.patch.object(sys, 'argv', ['searx', 'test']), mock.patch.object(search.urllib.request, 'urlopen', side_effect=URLError('offline')), redirect_stderr(io.StringIO()):
            self.assertEqual(search.main(), 3)

    def test_deployment_configuration(self):
        root = Path(__file__).parent
        self.assertIn('127.0.0.1:8888:8080', (root / 'compose.yml').read_text())
        self.assertIn('mem_limit: 320m', (root / 'compose.yml').read_text())
        self.assertIn('lean-searxng', (root / 'core-config/settings.yml').read_text())
        deploy = (root / 'deploy.sh').read_text()
        self.assertIn('${XDG_CONFIG_HOME:-$HOME/.config}/lean-browser-use/searxng-secret.env', deploy)
        self.assertIn('chmod 600', deploy)
        self.assertIn('chmod 700', deploy)
