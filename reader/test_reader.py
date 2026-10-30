from reader_test_support import *

@checks.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com", "data:text/html,hello",
                                 "https://", "https://a:b" + "@" + "example.com", "https://example.com\r/", "http://example.com:bad"])
def test_refused_url_shapes(url):
    with checks.raises(reader.ReaderError) as exc:
        reader.checked_address(url)
    assert exc.value.code == 2
    socket.getaddrinfo.assert_not_called()


@checks.mark.parametrize("ip", ["127.0.0.1", ".".join(['10', '1', '2', '3']), ".".join(['169', '254', '169', '254']), ".".join(['100', '64', '1', '2']),
                                "0.0.0.0", ".".join(['192', '168', '1', '1']), ".".join(['224', '0', '0', '1']), "::1", "fe80::1", "::ffff:127.0.0.1"])
def test_refused_addresses(ip):
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = [public_address(ip)]
    with checks.raises(reader.ReaderError) as exc:
        reader.checked_address("http://public.example")
    assert exc.value.code == 2


def test_every_dns_answer_checked():
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = [public_address(), public_address(".".join(['10', '0', '0', '1']))]
    with checks.raises(reader.ReaderError) as exc:
        reader.checked_address("https://public.example")
    assert exc.value.code == 2


def test_dns_failure_is_fetch_exit_10():
    socket.getaddrinfo.side_effect = socket.gaierror("not found")
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://missing.example")
    assert exc.value.code == 10


def test_redirect_refuses_private_target():
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = [public_address("127.0.0.1")]
    with checks.raises(reader.ReaderError) as exc:
        reader.PublicRedirect().redirect_request(Request("https://public.example"), None,
                                                 302, "redirect", {}, "http://127.0.0.1")
    assert exc.value.code == 2


def test_redirect_retains_checked_address():
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = [public_address()]
    req = reader.PublicRedirect().redirect_request(Request("https://public.example"), None,
                                                  302, "redirect", {}, "https://other.example/page")
    assert req.checked_address == public_address()


def test_connector_uses_checked_sockaddr_without_dns():
    sock = mock.Mock()
    socket.socket.side_effect = None
    socket.socket.return_value = sock
    conn = reader.connection(reader.http.client.HTTPSConnection, "public.example", public_address())
    assert conn._create_connection(("public.example", 443), 10) is sock
    sock.connect.assert_called_once_with((PUBLIC_IP, 443))
    socket.getaddrinfo.assert_not_called()


def test_fetch_user_agent_size_bound_and_no_proxy(monkeypatch):
    response = mock.MagicMock()
    response.__enter__.return_value = response
    response.headers.get_content_charset.return_value = "utf-8"
    response.read.return_value = b"<html>ok</html>"
    opener = mock.Mock()
    opener.open.return_value = response
    build = mock.Mock(return_value=opener)
    monkeypatch.setattr(reader, "build_opener", build)
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    assert reader.fetch("https://public.example") == ("<html>ok</html>", "urllib")
    req = opener.open.call_args.args[0]
    assert "Mozilla/" in req.get_header("User-agent")
    assert req.checked_address == public_address()
    assert build.call_args.args[0].proxies == {}
    response.read.assert_called_once_with(reader.FETCH_CAP + 1)
    response.read.return_value = b"x" * (reader.FETCH_CAP + 1)
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://public.example")
    assert exc.value.code == 10


def test_fetch_unknown_charset_uses_utf8_replacement(monkeypatch):
    response = mock.MagicMock()
    response.__enter__.return_value = response
    response.headers.get_content_charset.return_value = "reader-unknown-charset"
    response.read.return_value = b"<p>caf\xc3\xa9 \xff</p>"
    opener = mock.Mock()
    opener.open.return_value = response
    monkeypatch.setattr(reader, "build_opener", lambda *args: opener)
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    assert reader.fetch_urllib("https://public.example") == "<p>café \ufffd</p>"


@checks.mark.parametrize("package", ["react", "zod"])
def test_embedded_npm_two_params(package):
    spec, _ = compile_npm()
    result = reader.extract(spec, html(package))
    assert result[0]["name"] == package
    assert result[0]["license"] == "MIT"
    assert result[0]["latest_version"]
    assert result[0]["weekly_downloads"] > 0
    assert result[0]["repository_url"].startswith("git+https://github.com/")
    assert reader.failures(spec, result) == []


def test_embedded_detection_and_json_parse():
    value = {"value": 7}
    encoded = json.dumps(json.dumps(value))
    page = ('<script type="application/ld+json">{"@type":"Thing"}</script>'
            '<script id="__NEXT_DATA__" type="application/json">{"props":{"items":[1]}}</script>'
            '<script>window.__INITIAL_STATE__ = {"x":2}; alert("ignore");</script>'
            f'<script>window.__context__ = JSON.parse({encoded});</script>'
            '<script>window.__BAD_STATE__ = eval("private");</script><h1>Visible</h1>')
    embedded, trimmed = reader.page_data(page)
    assert embedded["ld+json:0"]["@type"] == "Thing"
    assert embedded["__NEXT_DATA__"]["props"]["items"] == [1]
    assert embedded["__INITIAL_STATE__"] == {"x": 2}
    assert embedded["__context__"] == value
    assert "__BAD_STATE__" not in embedded
    assert "alert" not in trimmed and "<h1>Visible</h1>" in trimmed


def test_page_data_preserves_svg_self_closing_script_behavior():
    assert reader.page_data('<svg><script/></svg><p>visible</p>') == ({}, '<p>visible</p>')


def test_page_data_does_not_close_script_on_unicode_casefold():
    html = '<script>window.__X__={"a":1};</scrİpt><p>visible</p>'
    assert reader.page_data(html) == ({}, '')


def test_failing_samples_match_legacy_regex_in_comments():
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    script = '<script>window.__TARGET__={"value":1};</script>'
    html = '<!--' + script + '-->'
    assert reader.failing_row_samples(spec, [{}], ['row[0].value'], html)[0]['outer_html'] == script


@checks.mark.parametrize("script", [
    '<script>window.__TARGET__={"value":1};</script>',
    '<ScRiPt data-x="a > b">window.__TARGET__={"value":1};</sCrIpT \n>',
    '<script>window.__TARGET__={"value":1};</scripture></script>',
    '<script>window.__TARGET__={"value":1};<script>nested</script>',
])
def test_failing_samples_find_exact_original_text(script):
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    sample = reader.failing_row_samples(spec, [{}], ["row[0].value"], 'before' + script + 'after')[0]
    assert sample["outer_html"] == script


def test_failing_samples_skip_nonmatching_scripts_and_truncate():
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    first = '<script>window.__OTHER__={"value":1};</script>'
    script = '<script>window.__TARGET__={"value":1};' + 'x' * 1000 + '</script>'
    samples = reader.failing_row_samples(spec, [{}, {}, {}], ['row[2].value', 'row[0].value', 'row[2].other'], first + script)
    assert [sample["index"] for sample in samples] == [2, 0]
    assert all(sample["outer_html"] == script[:600] for sample in samples)


def test_failing_samples_unterminated_scripts_do_not_emit():
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    html = '<script>window.__TARGET__={"value":1};' + '<script>' * 10000
    assert reader.failing_row_samples(spec, [{}], ['row[0].value'], html)[0]['outer_html'] == ''


@checks.mark.parametrize("html,expected", [
    ('<scrİpt>data</scrİpt>', []),
    ('<scripture>data</script>', []),
    ('<script><script>data</script>', ['<script><script>data</script>']),
    ('<script>one</script><script>two</script>',
     ['<script>one</script>', '<script>two</script>']),
    ('<script foo <script>data</script>', ['<script foo <script>data</script>']),
    ('<script>unterminated', []),
])
def test_sample_script_markup_matches_legacy_text_rules(html, expected):
    assert list(reader.sample_script_markup(html)) == expected


def test_failing_samples_find_source_with_attributes_on_end_tag():
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    script = '<script>window.__TARGET__={"value":1};</script attr="x">'
    # HTMLParser accepts end-tag attributes starting in Python 3.14; verify
    # normalization directly rather than relying on version-specific parsing.
    with mock.patch('reader_extract.page_data', wraps=reader.page_data) as page_data:
        sample = reader.failing_row_samples(spec, [{}], ['row[0].value'], script)[0]
    page_data.assert_called_once_with('<script>window.__TARGET__={"value":1};</script>')
    assert sample['outer_html'] == script


@checks.mark.parametrize("end", [
    '</sCrIpT>', '</script >', '</script\t\n\f\r>', '</script/>',
    '</script / ignored>', '</script attr="x">',
    '</script attr="a > b" other=ok>', "</SCRIPT attr='a > b'>",
    '</script attr=un"quoted>', '</script odd"name=unquoted>',
    '</script attr="x"next="y > z">', '</script =x>',
])
def test_script_samples_handle_end_tag_attributes_and_malformed_values(end):
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    script = '<script>window.__TARGET__={"value":1};' + end
    assert list(reader.sample_script_markup(script + 'after')) == [script]
    assert reader.failing_row_samples(spec, [{}], ['row[0].value'], script + 'after')[0]['outer_html'] == script


@checks.mark.parametrize("false_end", [
    '</scripture>', '</script-x>', '</script=foo>', '</script\u00a0>',
    '</scrİpt>', '</scrıpt>', '</script\v>',
])
def test_script_samples_ignore_false_end_tag_prefixes(false_end):
    script = '<script>window.__TARGET__={"value":1};' + false_end + '</script>'
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    assert list(reader.sample_script_markup(script)) == [script]
    assert reader.failing_row_samples(spec, [{}], ['row[0].value'], script)[0]['outer_html'] == script


def test_script_sample_unterminated_quoted_end_tag_does_not_emit():
    script = '<script>window.__TARGET__={"value":1};</script a="unterminated >'
    assert list(reader.sample_script_markup(script)) == []
    assert reader.failing_row_samples({"type": "embedded_json", "source": "__TARGET__"},
                                      [{}], ['row[0].value'], script)[0]['outer_html'] == ''


def test_script_sample_bounded_scanning_and_output():
    spec = {"type": "embedded_json", "source": "__TARGET__"}
    prefix = '<script>window.__TARGET__={"value":1};'
    script = prefix + '</scripture>' * 100000 + '</script attr="x > y">'
    assert list(reader.sample_script_markup(script)) == [script]
    assert reader.failing_row_samples(spec, [{}], ['row[0].value'], script)[0]['outer_html'] == script[:600]
    assert list(reader.sample_script_markup(prefix + '</scripture>' * 100000)) == []


def test_script_samples_source_test_uses_opening_tag_and_body():
    first = '<script id="__NEXT_DATA__" type="application/json">{"value":1}</script data="a > b">'
    second = '<script>window.__TARGET__={"value":2};</script / >'
    samples = reader.failing_row_samples({"type": "embedded_json", "source": "__TARGET__"},
                                         [{}], ['row[0].value'], first + second)
    assert samples[0]['outer_html'] == second
    samples = reader.failing_row_samples({"type": "embedded_json", "source": "__NEXT_DATA__"},
                                         [{}], ['row[0].value'], first + second)
    assert samples[0]['outer_html'] == first


def test_embedded_list_rows_and_escaped_paths():
    spec = {"type": "embedded_json", "source": "__NEXT_DATA__", "rows": "props.rows",
            "paths": {"field": r"nested.key\.with\.dots.0"}}
    page = '<script id="__NEXT_DATA__">{"props":{"rows":[{"nested":{"key.with.dots":["one"]}},{"nested":{"key.with.dots":["two"]}}]}}</script>'
    assert reader.extract(spec, page) == [{"field": "one"}, {"field": "two"}]
    assert reader.extract(spec, "<html></html>") == []
    assert reader.path_get({"a": []}, "a.9") is None


def test_compile_embedded_before_html_and_metadata():
    spec, rows = compile_npm()
    assert len(calls()) == 1
    assert "embedded_json" in calls()[0] and "html" not in calls()[0]
    for key in ("name", "url_template", "params", "type", "paths", "required", "want", "example",
                "sample_output", "compiled_at", "compiled_by", "crawl4ai_version", "page_hash", "last_ok", "healed_at", "fetch_method"):
        assert key in spec
    assert spec["compiled_by"] == os.environ["READER_COMPILE_CMD"]
    assert spec["sample_output"] == rows
    assert spec["healed_at"] is None
    assert len(spec["page_hash"]) == 64


def test_compile_refines_with_named_failures(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "refine")
    spec, rows = compile_npm()
    assert len(calls()) == 2
    assert calls()[1]["validation_failures"][0] == "row[0].license"
    assert calls()[1]["validation_failures"][1].startswith("example row not found; nearest row: ")
    assert "previous_schema" in calls()[1]
    sample = calls()[1]["failing_row_samples"][0]
    assert sample["index"] == 0
    assert json.loads(sample["values"])["name"] == "react"
    assert sample["outer_html"].startswith("<script")
    assert len(sample["outer_html"]) <= 600
    assert reader.failures(spec, rows) == []


@checks.mark.parametrize("as_list", [False, True])
def test_compile_anchor_refines_truncated_names(anchor_compile, capsys, as_list):
    example = anchor_compile[1]
    if as_list:
        example = [example, {"model": "only the first example anchors"}]
    assert reader.main(["compile", "prices", "--url", "https://public.example", "--want", "model prices",
                        "--example", json.dumps(example)]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out) == anchor_compile
    assert captured.err == ""
    assert len(calls()) == 2
    failures = calls()[1]["validation_failures"]
    assert len(failures) == 1
    assert failures[0].startswith("example row not found; nearest row: ")
    assert json.loads(failures[0].split("nearest row: ", 1)[1]) == {
        "model": "Claude Sonnet 5", "input": 2, "output": 10}
    assert calls()[1]["previous_schema"]["transforms"]["model"]
    assert reader.load("prices")["sample_output"] == anchor_compile


def test_compile_anchor_failure_keeps_existing_spec(anchor_compile, monkeypatch, capsys):
    monkeypatch.setenv("STUB_MODE", "anchor-broken")
    reader.save_json(reader.spec_path("prices"), {"preserved": True})
    before = reader.spec_path("prices").read_bytes()
    assert reader.main(["compile", "prices", "--url", "https://public.example", "--want", "model prices",
                        "--example", json.dumps(anchor_compile[1])]) == 11
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "example row not found; nearest row:" in captured.err
    assert len(calls()) == 4
    assert reader.spec_path("prices").read_bytes() == before


@checks.mark.parametrize("example,rows", [
    ({"model": " Claude  Sonnet\t5.5 ", "input": 2}, [{"model": "Claude\nSonnet 5.5", "input": 2.0}]),
    ({"model": "Claude", "input": 0}, [{"model": "other", "input": 1}, {"model": "Claude", "input": 0.0}]),
    ({"cache": None}, [{"cache": None}]),
])
def test_compile_anchor_normalizes_whitespace_and_numbers(example, rows):
    assert reader.anchor_failures(example, rows) == []


@checks.mark.parametrize("example,rows", [
    ({"model": "Claude"}, [{"model": "claude"}]),
    ({"input": 2}, [{"input": "2"}]),
    ({"input": 1}, [{"input": True}]),
    ({"cache": None}, [{}]),
    ({"model": "Claude", "input": 2}, [{"model": "Claude", "input": 1}, {"model": "other", "input": 2}]),
    ({"model": "Claude"}, []),
])
def test_compile_anchor_requires_all_values_in_one_row(example, rows):
    assert reader.anchor_failures(example, rows)[0].startswith("example row not found; nearest row: ")


@checks.mark.parametrize("mode", ["broken", "fail"])
def test_compile_stops_after_three_refinements(monkeypatch, mode):
    monkeypatch.setenv("STUB_MODE", mode)
    with checks.raises(reader.ReaderError) as exc:
        compile_npm()
    assert exc.value.code == 11
    assert "3 refinements" in str(exc.value)
    assert len(calls()) == (8 if mode == "fail" else 4)
    assert not reader.spec_path("npm-package").exists()


@checks.mark.parametrize("outcome", ["nonzero", "empty", "invalid"])
def test_compile_retries_command_once_before_refinement(monkeypatch, tmp_path, outcome):
    command = tmp_path / "flaky.py"
    command.write_text(f'''import os, runpy, sys
from pathlib import Path
log = Path(os.environ["STUB_CALL_LOG"])
if not log.exists():
    prompt = sys.stdin.read()
    import json
    log.write_text(json.dumps(json.loads(prompt.split("INPUT JSON:\\n", 1)[1])) + "\\n")
    print("temporary command failure", file=sys.stderr)
    if {outcome!r} == "nonzero":
        sys.exit(10)
    if {outcome!r} == "invalid":
        print("no schema returned")
else:
    runpy.run_path({str(DATA / "compile_stub.py")!r}, run_name="__main__")
''')
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([sys.executable, str(command)]))
    spec, rows = compile_npm()
    assert len(calls()) == 2
    assert calls()[0] == calls()[1]
    assert "validation_failures" not in calls()[1]
    assert reader.failures(spec, rows) == []


@checks.mark.parametrize("outcome", ["nonzero", "invalid"])
def test_compile_retry_limit_and_last_stderr(monkeypatch, tmp_path, outcome):
    command = tmp_path / "failed.py"
    command.write_text('''import json, os, sys
payload = json.loads(sys.stdin.read().split("INPUT JSON:\\n", 1)[1])
with open(os.environ["STUB_CALL_LOG"], "a") as stream:
    stream.write(json.dumps(payload) + "\\n")
print("discard-prefix:" + "x" * 320 + " final command diagnostic", file=sys.stderr)
print("not JSON")
sys.exit(int(sys.argv[1]))
''')
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([
        sys.executable, str(command), "10" if outcome == "nonzero" else "0"]))
    with checks.raises(reader.ReaderError) as exc:
        compile_npm()
    assert exc.value.code == 11
    assert len(calls()) == 8
    for index in range(0, 8, 2):
        assert calls()[index] == calls()[index + 1]
    tail = ("discard-prefix:" + "x" * 320 + " final command diagnostic\n")[-300:]
    assert str(exc.value).endswith("compile stderr: " + tail)
    assert "discard-prefix" not in str(exc.value)


def test_compile_css_refinement_carries_failing_rows(monkeypatch, tmp_path):
    schema = {"type": "css", "schema": {"name": "prices", "baseSelector": "tr", "fields": [
        {"name": "model", "selector": ".model", "type": "text"},
        {"name": "input", "selector": ".input", "type": "text"},
        {"name": "output", "selector": ".output", "type": "text"}]},
        "transforms": {"input": "number", "output": "number"}}
    command = tmp_path / "compile.py"
    command.write_text('''import json, os, sys
prompt = sys.stdin.read()
payload = json.loads(prompt.split("INPUT JSON:\\n", 1)[1])
with open(os.environ["STUB_CALL_LOG"], "a") as stream:
    stream.write(json.dumps({"prompt": prompt, "payload": payload}) + "\\n")
schema = json.loads(sys.argv[1])
if payload.get("validation_failures"):
    schema["schema"]["baseSelector"] = "table.prices tr"
print(json.dumps(schema))
''')
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([sys.executable, str(command), json.dumps(schema)]))
    page = ('<table><tr><td>empty row is skipped by extraction</td></tr></table>'
            '<table class="prices"><tr><td class="model">Claude</td>'
            '<td class="input">2</td><td class="output">10</td></tr></table><table>')
    for index in range(5):
        page += f'<tr><td class="model">Unrelated {index}</td><td>{"x" * 800}</td></tr>'
    page += '</table>'
    spec, rows = reader.compile_spec("prices", "https://public.example", {}, "model prices",
                                     {"model": "Claude", "input": 2, "output": 10}, page)
    assert rows == [{"model": "Claude", "input": 2, "output": 10}]
    assert spec["schema"]["baseSelector"] == "table.prices tr"
    assert len(calls()) == 2
    refinement = calls()[1]
    assert "narrow baseSelector so only rows matching the want" in refinement["prompt"]
    samples = refinement["payload"]["failing_row_samples"]
    assert len(samples) == 3
    assert [sample["index"] for sample in samples] == [1, 2, 3]
    for index, sample in enumerate(samples):
        assert json.loads(sample["values"]) == {"model": f"Unrelated {index}"}
        assert f'Unrelated {index}</td>' in sample["outer_html"]
        assert sample["outer_html"].startswith('<tr>')
        assert len(sample["outer_html"]) == 600
        assert len(sample["values"]) <= 600


def test_compile_succeeds_on_third_refinement(monkeypatch, tmp_path):
    command = tmp_path / "compile.py"
    command.write_text(f'''import os, runpy
from pathlib import Path
log = Path(os.environ["STUB_CALL_LOG"])
count = len(log.read_text().splitlines()) if log.exists() else 0
os.environ["STUB_MODE"] = "broken" if count < 3 else "npm"
runpy.run_path({str(DATA / "compile_stub.py")!r}, run_name="__main__")
''')
    monkeypatch.setenv("READER_COMPILE_CMD", shlex.join([sys.executable, str(command)]))
    spec, rows = compile_npm()
    assert len(calls()) == 4
    assert reader.failures(spec, rows) == []


def test_missing_compile_command_is_exit_11(monkeypatch):
    monkeypatch.setenv("READER_COMPILE_CMD", "reader-command-does-not-exist")
    with checks.raises(reader.ReaderError) as exc:
        compile_npm()
    assert exc.value.code == 11



def load_tests(loader, suite, pattern):
    return checks.suite(globals())
