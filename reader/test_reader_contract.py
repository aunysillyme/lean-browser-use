"""Compile-command usage and bundled-spec offline contracts."""
from reader_test_support import *


def test_unset_compile_command_exits_two(monkeypatch, capsys):
    monkeypatch.delenv('READER_COMPILE_CMD')
    assert reader.main(['compile', 'sample', '--url', 'https://example.com', '--want', 'title']) == 2
    message = capsys.readouterr().err
    assert 'READER_COMPILE_CMD' in message
    assert "export READER_COMPILE_CMD='claude -p'" in message
    socket.getaddrinfo.assert_not_called()


def test_unset_command_self_heal_and_valid_run(monkeypatch):
    spec, _ = compile_npm()
    monkeypatch.delenv('READER_COMPILE_CMD')
    monkeypatch.setattr(reader, 'fetch', lambda url, **kwargs: (html(), 'urllib'))
    assert reader.run_spec(spec, {}, False)['rows'][0]['name'] == 'react'
    spec['paths']['license'] = 'absent'
    with checks.raises(reader.ReaderError) as error:
        reader.run_spec(spec, {}, False)
    assert error.value.code == 2


def test_bundled_pricing_spec_offline_contract(monkeypatch):
    spec = json.loads((ROOT / 'specs/claude-pricing.json').read_text())
    page = (DATA / 'claude-pricing.html').read_text()
    # A stdlib HTML parser checks the captured rows before mocking the CSS engine.
    class Table(reader.HTMLParser):
        def __init__(self):
            super().__init__()
            self.rows, self.cells, self.cell, self.retired = [], [], None, False
        def handle_starttag(self, tag, attrs):
            if tag == 'tr': self.cells, self.retired = [], False
            if tag == 'td': self.cell = ''
            if tag == 'button' and 'Retired' in dict(attrs).get('aria-label', ''): self.retired = True
        def handle_data(self, data):
            if self.cell is not None: self.cell += data
        def handle_endtag(self, tag):
            if tag == 'td': self.cells.append(self.cell); self.cell = None
            if tag == 'tr' and len(self.cells) == len(spec['schema']['fields']) and not self.retired:
                self.rows.append(dict(zip([f['name'] for f in spec['schema']['fields']], self.cells)))
    parser = Table(); parser.feed(page)
    def helper(operation, payload, code):
        assert operation == 'css'
        assert payload['schema'] == spec['schema']
        assert payload['html'] == page
        return {'rows': parser.rows}
    monkeypatch.setattr(reader, 'crawl_helper', helper)
    rows = reader.extract(spec, page)
    assert reader.failures(spec, rows) == []
    assert len(rows) == len(spec['sample_output'])
    assert {row['model'] for row in rows} == {row['model'] for row in spec['sample_output']}


def load_tests(loader, suite, pattern):
    return checks.suite(globals())
