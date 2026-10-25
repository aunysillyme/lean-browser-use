"""Small unittest fixture adapter for the retained regression functions."""
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import inspect
import io
import itertools
import os
from pathlib import Path
import re
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

fixtures = {}


def fixture(fn=None, autouse=False):
    def decorate(function):
        fixtures[function.__name__] = (function, autouse)
        return function
    return decorate(fn) if fn else decorate


class Mark:
    def parametrize(self, names, values):
        def decorate(function):
            existing = getattr(function, '_parameters', [])
            function._parameters = existing + [(names.replace(' ', '').split(','), values)]
            return function
        return decorate


mark = Mark()
skip = lambda reason: (_ for _ in ()).throw(unittest.SkipTest(reason))


class raises:
    def __init__(self, exception, match=None):
        self.exception, self.match = exception, match

    def __enter__(self):
        return self

    def __exit__(self, kind, value, tb):
        if kind is None:
            raise AssertionError('Expected exception')
        if not isinstance(value, self.exception):
            return False
        if self.match and not re.search(self.match, str(value)):
            raise AssertionError('Exception text did not match')
        self.value = value
        return True


class MonkeyPatch:
    def __init__(self, stack):
        self.stack = stack

    def setenv(self, name, value):
        self.stack.enter_context(mock.patch.dict(os.environ, {name: str(value)}))

    def delenv(self, name, raising=True):
        if raising and name not in os.environ:
            raise KeyError(name)
        self.stack.enter_context(mock.patch.dict(os.environ))
        os.environ.pop(name, None)

    def setattr(self, obj, name, value):
        original = getattr(obj, name)
        # The command facade re-exports functions from focused reader modules.
        # Patch their imported bindings too, keeping the original injection tests.
        if getattr(obj, '__name__', '') == 'page_reader':
            for module_name, module in list(sys.modules.items()):
                if module_name in ('reader_fetch', 'reader_crawl', 'reader_extract', 'reader_compile', 'reader_runtime') and getattr(module, name, object()) is original:
                    self.stack.enter_context(mock.patch.object(module, name, value))
        self.stack.enter_context(mock.patch.object(obj, name, value))

    def setitem(self, mapping, key, value):
        self.stack.enter_context(mock.patch.dict(mapping, {key: value}))


class Capture:
    def __init__(self, stack):
        self.out, self.err = io.StringIO(), io.StringIO()
        stack.enter_context(redirect_stdout(self.out))
        stack.enter_context(redirect_stderr(self.err))

    def readouterr(self):
        result = SimpleNamespace(out=self.out.getvalue(), err=self.err.getvalue())
        for stream in (self.out, self.err):
            stream.seek(0)
            stream.truncate()
        return result


def crawler_available():
    try:
        import importlib.util
        return importlib.util.find_spec('crawl4ai') is not None
    except (ImportError, ValueError):
        return False


def local_sockets_available():
    try:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
        return True
    except PermissionError:
        return False


class RegressionCase(unittest.TestCase):
    def __init__(self, function, parameters, label):
        super().__init__('runTest')
        self.function, self.parameters, self.label = function, parameters, label

    def id(self):
        return self.label

    def __str__(self):
        return self.label

    def runTest(self):
        name = self.function.__name__
        needs_crawler = name.startswith('test_browser_') or name in (
            'test_real_crawl4ai_pricing_snapshot', 'test_compile_css_refinement_carries_failing_rows',
            'test_css_hostile_html_extracts_without_browser_or_requests')
        if needs_crawler and not crawler_available():
            self.skipTest('optional crawl4ai/browser dependency is absent; offline contracts still run')
        needs_socket = name.startswith('test_proxy_') or 'local_http' in inspect.signature(self.function).parameters
        if needs_socket and not local_sockets_available():
            self.skipTest('sandbox blocks local sockets; public-address unit checks still run')
        with ExitStack() as stack:
            directory = stack.enter_context(tempfile.TemporaryDirectory(prefix='lbu-reader-test-'))
            cache = {'tmp_path': Path(directory), 'monkeypatch': MonkeyPatch(stack), 'capsys': Capture(stack)}
            cache.update(self.parameters)

            def resolve(key):
                if key in cache:
                    return cache[key]
                factory = fixtures[key][0]
                value = factory(**{arg: resolve(arg) for arg in inspect.signature(factory).parameters})
                if inspect.isgenerator(value):
                    generator = value
                    value = next(generator)
                    stack.callback(lambda: next(generator, None))
                cache[key] = value
                return value

            for key, (_, automatic) in fixtures.items():
                if automatic:
                    resolve(key)
            self.function(**{arg: resolve(arg) for arg in inspect.signature(self.function).parameters})


def suite(namespace):
    cases = []
    for name, function in namespace.items():
        if not name.startswith('test_') or not callable(function):
            continue
        parameters = [{}]
        for names, values in getattr(function, '_parameters', []):
            expanded = []
            for previous, value in itertools.product(parameters, values):
                values_tuple = value if len(names) > 1 else (value,)
                expanded.append({**previous, **dict(zip(names, values_tuple))})
            parameters = expanded
        for index, values in enumerate(parameters):
            cases.append(RegressionCase(function, values, f'{name}[{index}]'))
    return unittest.TestSuite(cases)
