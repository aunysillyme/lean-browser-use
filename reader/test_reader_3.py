from reader_test_support import *

@checks.mark.parametrize("transform", [[], "unknown", {"regex": "("}, {"regex": "(x)", "group": 3},
                                        {"regex": 42}, {"number": "yes"}, {"group": 1}])
def test_candidate_rejects_malformed_transforms(transform):
    candidate = json.loads((DATA / "npm-schema.json").read_text())
    candidate["transforms"] = {"name": transform}
    with checks.raises(ValueError):
        reader.validate_candidate(candidate, None)


def test_heal_preserves_required_fields_without_example(monkeypatch):
    spec, _ = compile_npm()
    spec["example"] = None
    spec["paths"]["license"] = "broken"
    reader.save(spec)
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "urllib"))
    candidate = {"type": "embedded_json", "source": "__context__", "rows": "context",
                 "paths": {"name": "packument.name"}, "required": ["name"]}
    compiler = mock.Mock(return_value=subprocess.CompletedProcess([], 0, json.dumps(candidate), ""))
    monkeypatch.setattr(reader.subprocess, "run", compiler)
    with checks.raises(reader.ReaderError) as exc:
        reader.run_spec(spec, {}, False)
    assert exc.value.code == 12
    assert compiler.call_count == 4
    assert reader.load("npm-package")["required"] == spec["required"]


@checks.mark.parametrize("command", ["", " ", "'unclosed"])
def test_invalid_compile_command_exits_11(monkeypatch, command):
    monkeypatch.setenv("READER_COMPILE_CMD", command)
    with checks.raises(reader.ReaderError) as exc:
        compile_npm()
    assert exc.value.code == 11


def test_stored_spec_requires_object():
    path = reader.spec_path("array")
    path.parent.mkdir(parents=True)
    path.write_text("[]")
    with checks.raises(reader.ReaderError) as exc:
        reader.load("array")
    assert exc.value.code == 2


@checks.mark.parametrize("key,value", [("example", "bad"), ("example", []), ("example", [42]),
                                       ("params", []), ("want", None), ("fetch_method", "unknown")])
def test_stored_spec_validates_metadata(key, value):
    spec, _ = compile_npm()
    spec[key] = value
    reader.save(spec)
    with checks.raises(reader.ReaderError) as exc:
        reader.load("npm-package")
    assert exc.value.code == 2


def test_other_compile_command_keeps_stdin(monkeypatch):
    command = mock.Mock(return_value=subprocess.CompletedProcess([], 0, "{}", ""))
    monkeypatch.setattr(reader.subprocess, "run", command)
    reader.invoke_compile("custom-compiler --flag", "é" * 60000)
    assert command.call_args.args[0] == ["custom-compiler", "--flag"]
    assert command.call_args.kwargs["input"] == "é" * 60000


@checks.mark.parametrize("output, expected", [
    ('lane ready\n{"paths":{"x":"value with } and \\\" quotes"},"required":["x"]}\ndone',
     {"paths": {"x": 'value with } and " quotes'}, "required": ["x"]}),
    ('status {"ignore":true}\n```json\n{"type":"css"}\n```\ndone', {"type": "css"}),
    ('prefix {not JSON}\n{"need_html":true}\n{"later":true}', {"need_html": True}),
])
def test_schema_json_from_mixed_stdout(output, expected):
    assert reader.json_object(output) == expected


@checks.mark.parametrize("status", [401, 403, 429])
def test_blocked_http_falls_back_to_crwl(monkeypatch, crwl_fetch_stub, status):
    body = io.BytesIO(b"denied")
    urllib = mock.Mock(side_effect=HTTPError("https://www.npmjs.com/package/react", status, "blocked", {}, body))
    monkeypatch.setattr(reader, "fetch_urllib", urllib)
    page, method = reader.fetch("https://www.npmjs.com/package/react")
    assert page == html() and method == "crwl"
    assert body.closed
    assert len(crwl_fetch_stub.read_text().splitlines()) == 1


@checks.mark.parametrize("page", ['<title>Just a moment...</title>',
                                  '<title>Attention Required! | Cloudflare</title>',
                                  '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>',
                                  '<div>Please enable JS and disable any ad blocker</div>'])
def test_bot_wall_falls_back_to_crwl(monkeypatch, crwl_fetch_stub, page):
    monkeypatch.setattr(reader, "fetch_urllib", lambda url: page)
    assert reader.fetch("https://www.npmjs.com/package/zod") == (html("zod"), "crwl")


def test_cloudflare_detection_script_preserves_valid_page(monkeypatch):
    page = html() + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
    monkeypatch.setattr(reader, "fetch_urllib", lambda url: page)
    crwl = mock.Mock(side_effect=AssertionError("valid page needs no browser retry"))
    monkeypatch.setattr(reader, "fetch_crwl", crwl)
    assert reader.fetch("https://www.npmjs.com/package/react") == (page, "urllib")
    crwl.assert_not_called()


def test_blocked_compile_run_metadata_and_crwl_preference(monkeypatch, crwl_fetch_stub, capsys):
    urllib = mock.Mock(side_effect=HTTPError("https://www.npmjs.com/package/react", 403, "blocked", {}, None))
    monkeypatch.setattr(reader, "fetch_urllib", urllib)
    assert reader.main(["compile", "npm-package", "--url", "https://www.npmjs.com/package/{name}",
                        "--want", "package fields", "--param", "name=react"]) == 0
    capsys.readouterr()
    assert reader.load("npm-package")["fetch_method"] == "crwl"
    assert urllib.call_count == 1 and len(calls()) == 1
    for package in ("react", "zod"):
        assert reader.main(["run", "npm-package", "--param", "name=" + package]) == 0
        output = json.loads(capsys.readouterr().out)
        assert output["meta"] == {"fetch_method": "crwl"}
        assert output["rows"][0]["name"] == package
        assert reader.failures(reader.load("npm-package"), output["rows"]) == []
    assert urllib.call_count == 1 and len(calls()) == 1
    assert len(crwl_fetch_stub.read_text().splitlines()) == 3


def test_missing_crwl_fetch_is_exit_10_and_skips_compile(monkeypatch, capsys):
    monkeypatch.setattr(reader, "fetch_urllib", mock.Mock(side_effect=HTTPError("https://public.example", 403, "blocked", {}, None)))
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    monkeypatch.setenv("READER_CRAWL4AI_PYTHON", "reader-missing-crawl-python")
    assert reader.main(["compile", "blocked", "--url", "https://public.example", "--want", "fields"]) == 10
    output = capsys.readouterr()
    assert output.out == "" and "crwl" in output.err
    assert calls() == []


@checks.mark.parametrize("status", [404, 500])
def test_other_http_errors_skip_crwl(monkeypatch, status):
    monkeypatch.setattr(reader, "fetch_urllib", mock.Mock(side_effect=HTTPError("https://public.example", status, "error", {}, None)))
    crwl = mock.Mock(side_effect=AssertionError("no browser retry"))
    monkeypatch.setattr(reader, "fetch_crwl", crwl)
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://public.example")
    assert exc.value.code == 10
    crwl.assert_not_called()


@checks.mark.parametrize("result", [
    {"html": "<p>ok</p>", "success": False},
    {"html": "<p>denied</p>", "status_code": 403},
    {"html": "<title>Just a moment...</title>"}, {}, {"html": ""},
    {"html": "x" * (reader.FETCH_CAP + 1)},
])
def test_crwl_bad_pages_exit_10(monkeypatch, result):
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    monkeypatch.setattr(reader.subprocess, "run", mock.Mock(return_value=subprocess.CompletedProcess([], 0, json.dumps(result), "")))
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://public.example", preferred="crwl")
    assert exc.value.code == 10 and "crwl" in str(exc.value)


@checks.mark.parametrize("failure", [subprocess.CompletedProcess([], 1, "", ""),
                                    subprocess.CompletedProcess([], 0, "invalid JSON", ""),
                                    subprocess.TimeoutExpired("crwl", 90)])
def test_crwl_command_failures_exit_10(monkeypatch, failure):
    monkeypatch.setattr(reader, "checked_address", lambda url: public_address())
    command = mock.Mock(side_effect=failure) if isinstance(failure, Exception) else mock.Mock(return_value=failure)
    monkeypatch.setattr(reader.subprocess, "run", command)
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://public.example", preferred="crwl")
    assert exc.value.code == 10 and "crwl" in str(exc.value)


@checks.mark.parametrize("url", ["file:///etc/passwd", "http://127.0.0.1"])
def test_crwl_first_refuses_targets_before_subprocess(monkeypatch, url):
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = [public_address("127.0.0.1")]
    command = mock.Mock(side_effect=AssertionError("refused target cannot reach crwl"))
    monkeypatch.setattr(reader.subprocess, "run", command)
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch(url, preferred="crwl")
    assert exc.value.code == 2
    command.assert_not_called()


def test_crwl_reported_private_redirect_is_refused(monkeypatch):
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.side_effect = [[public_address()], [public_address("127.0.0.1")]]
    result = {"html": "<p>private</p>", "redirected_url": "http://127.0.0.1"}
    monkeypatch.setattr(reader.subprocess, "run", mock.Mock(return_value=subprocess.CompletedProcess([], 0, json.dumps(result), "")))
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch("https://public.example", preferred="crwl")
    assert exc.value.code == 2


def test_legacy_spec_uses_urllib_then_remembers_crwl(monkeypatch):
    spec, _ = compile_npm()
    spec.pop("fetch_method")
    reader.save(spec)
    fetch = mock.Mock(return_value=(html(), "crwl"))
    monkeypatch.setattr(reader, "fetch", fetch)
    reader.run_spec(reader.load("npm-package"), {}, False)
    fetch.assert_called_once_with("https://www.npmjs.com/package/react", preferred="urllib")
    assert reader.load("npm-package")["fetch_method"] == "crwl"


def test_bundled_npm_spec_crwl_runs(monkeypatch):
    spec = json.loads((ROOT / "specs/npm-package.json").read_text())
    reader.save(spec)
    def live_shape(url):
        package = url.rsplit("/", 1)[-1]
        embedded, _ = reader.page_data(html(package))
        context = embedded["__context__"]["context"]
        context["packument"].update(
            version=context["packument"]["dist-tags"]["latest"],
            license=context["packageVersion"]["license"],
            repository=context["packageVersion"]["repository"]["url"])
        context["downloads"] = [{"downloads": context["downloads"]["weeklyDownloads"]}]
        return '<script>window.__context__ = ' + json.dumps(embedded["__context__"]) + ';</script>'

    crwl = mock.Mock(side_effect=live_shape)
    monkeypatch.setattr(reader, "fetch_crwl", crwl)
    monkeypatch.setattr(reader, "fetch_urllib", mock.Mock(side_effect=AssertionError("bundled spec prefers crwl")))
    for package in ("react", "zod"):
        result = reader.run_spec(reader.load("npm-package"), {"name": package}, False)
        assert result["rows"][0]["name"] == package
        assert result["rows"][0]["license"] == "MIT"
        assert type(result["rows"][0]["weekly_downloads"]) is int
        assert reader.failures(spec, result["rows"]) == []
        assert result["meta"] == {"fetch_method": "crwl"}
    assert calls() == []
    assert crwl.call_count == 2


@checks.mark.parametrize("package_license", ["MIT", "4.6.7"])
def test_bundled_npm_spec_captured_zod_context(monkeypatch, package_license):
    # Public data excerpt from crwl's live zod HTML, captured 2026-10-23.
    context = {
        "packument": {"name": "zod", "version": "4.6.7", "license": "MIT",
                      "repository": "https://github.com/colinhacks/zod"},
        "packageVersion": {"name": "zod", "version": "4.6.7", "license": package_license},
        "downloads": [{"downloads": 216094796, "label": "2026-10-09 to 2026-10-15"},
                      {"downloads": 144621339, "label": "2026-10-16 to 2026-10-22"}],
    }
    page = '<script>window.__context__ = ' + json.dumps({"context": context}) + ';</script>'
    spec = json.loads((ROOT / "specs/npm-package.json").read_text())
    reader.save(spec)
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (page, "crwl"))
    output = reader.run_spec(reader.load("npm-package"), {"name": "zod"}, False)
    assert output["rows"] == [{"name": "zod", "latest_version": "4.6.7",
                               "weekly_downloads": 144621339, "license": "MIT",
                               "repository_url": "https://github.com/colinhacks/zod"}]
    assert type(output["rows"][0]["weekly_downloads"]) is int
    assert calls() == []



def load_tests(loader, suite, pattern):
    return checks.suite(globals())
