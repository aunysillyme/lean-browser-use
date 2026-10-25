from reader_test_support import *

def test_validation_each_row_example_keys_and_numeric():
    spec = {"required": ["name", "input"], "example": {"name": "Claude", "input": 1, "cache": None}}
    assert reader.failures(spec, [{"name": "Claude", "input": 0, "cache": None}]) == []
    result = reader.failures(spec, [{"name": "Claude", "input": 1, "cache": None}, {"name": " ", "input": "$2"}])
    assert set(result) == {"row[1].name", "row[1].cache", "row[1].input must be numeric"}
    assert "list rows >= 1" in reader.failures(spec, [])
    assert reader.failures(spec, ["invalid"])


def test_optional_numeric_fields_allow_null_but_keep_example_keys():
    spec = {"required": ["model", "input", "output"],
            "example": {"model": "Claude", "input": 2, "output": 10,
                        "cache_write": 2.5, "cache_read": 0.2}}
    row = {"model": "Claude", "input": 2, "output": 10, "cache_write": None, "cache_read": None}
    assert reader.failures(spec, [row]) == []
    assert reader.failures(spec, [{**row, "cache_read": "0.2"}]) == ["row[0].cache_read must be numeric"]
    assert reader.failures(spec, [{**row, "input": None}]) == ["row[0].input"]
    del row["cache_read"]
    assert reader.failures(spec, [row]) == ["row[0].cache_read"]


@checks.mark.parametrize("value", [None, "", "   ", "x", "ab", 0, 2.5, False, [], {}])
def test_copy_check_skips_null_empty_short_strings_and_numbers(value):
    spec = {"required": ["name"], "example": {"first": "example one", "second": "example two"}}
    assert reader.failures(spec, [{"name": "row", "first": value, "second": value}]) == []


def test_free_model_equal_numeric_prices_are_valid():
    spec = {"required": ["model", "input", "output"],
            "example": {"model": "paid", "input": 2, "output": 10}}
    assert reader.failures(spec, [{"model": "free", "input": 0, "output": 0}]) == []


@checks.mark.parametrize("example", [
    {"version": "1.2.3", "license": "MIT"},
    [{"version": "1.2.3", "license": "MIT"}],
])
def test_validation_rejects_cross_field_value_in_each_row(example):
    spec = {"required": ["version", "license"], "example": example}
    rows = [{"version": "4.6.7", "license": "MIT"},
            {"version": "4.6.7", "license": "4.6.7"}]
    assert reader.failures(spec, rows) == [
        "row[1].license equals version; example values differ"]


@checks.mark.parametrize("example", [None, {}, {"version": "same", "license": "same"}])
def test_validation_allows_equal_values_without_differing_example(example):
    spec = {"required": ["version", "license"], "example": example}
    assert reader.failures(spec, [{"version": "same", "license": "same"}]) == []


@checks.mark.parametrize("value, expected", [("144,621,339", 144621339), (0, 0),
                                           ("1.25", 1.25), ("inf", None)])
def test_number_transform_preserves_integral_type(value, expected):
    row = reader.normalize([{"weekly_downloads": value}], {"weekly_downloads": "number"})[0]
    assert row["weekly_downloads"] == expected
    assert type(row["weekly_downloads"]) is type(expected)


def test_cross_field_mismatch_heals_once_and_no_heal_exits_12(monkeypatch):
    spec, _ = compile_npm()
    spec["paths"]["license"] = spec["paths"]["latest_version"]
    reader.save(spec)
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "urllib"))
    before = len(calls())
    with checks.raises(reader.ReaderError) as exc:
        reader.run_spec(reader.load("npm-package"), {}, True)
    assert exc.value.code == 12
    assert "latest_version equals license" in str(exc.value)
    assert len(calls()) == before
    result = reader.run_spec(reader.load("npm-package"), {}, False)
    assert result["rows"][0]["license"] == "MIT"
    assert len(calls()) == before + 1
    assert reader.load("npm-package")["healed_at"]


def test_run_and_heal_leave_shipped_specs_byte_for_byte_unchanged(monkeypatch):
    spec, _ = compile_npm()
    reader.save(spec)
    spec["name"] = "broken"
    spec["paths"]["license"] = "broken.path"
    reader.save(spec)
    directory = reader.spec_path("unused").parent

    def hashes():
        return {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in directory.rglob("*") if path.is_file()}

    before = hashes()
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "crwl"))
    monkeypatch.setattr(reader, "now", lambda: "2026-10-23T12:00:00+00:00")
    assert reader.main(["run", "npm-package"]) == 0
    assert hashes() == before
    state = json.loads(reader.state_path("npm-package").read_text())
    assert state == {"last_ok": reader.now(), "healed_at": None,
                     "fetch_method": "crwl", "page_hash": reader.page_hash(html())}
    assert not reader.override_path("npm-package").exists()
    assert reader.main(["run", "broken"]) == 0
    assert hashes() == before
    assert reader.override_path("broken").exists()
    assert reader.load("broken")["healed_at"] == reader.now()
    assert json.loads(reader.state_path("broken").read_text())["healed_at"] == reader.now()
    # A later successful run uses the healed rules without another compile.
    before_calls = len(calls())
    assert reader.main(["run", "broken"]) == 0
    assert len(calls()) == before_calls
    assert hashes() == before


def test_state_default_and_override_precedence(monkeypatch, tmp_path):
    monkeypatch.delenv("READER_STATE_DIR")
    monkeypatch.setattr(reader.Path, "home", lambda: tmp_path)
    assert reader.state_path("npm-package") == tmp_path / ".cache/lean-browser-use/reader/npm-package.json"
    spec, _ = compile_npm()
    reader.save(spec)
    healed = {**spec, "want": "healed request"}
    reader.save(healed, runtime=True)
    assert reader.load("npm-package")["want"] == "healed request"
    reader.save_state(healed, html(), "crwl")
    assert reader.load("npm-package")["fetch_method"] == "crwl"
    # An explicit compile supersedes stale healed rules and fetch preferences.
    reader.save(spec)
    assert not reader.override_path("npm-package").exists()
    assert not reader.state_path("npm-package").exists()
    assert reader.load("npm-package")["want"] == spec["want"]


def test_ls_reports_source_and_includes_state_only_specs(capsys):
    spec, _ = compile_npm()
    reader.save(spec)
    assert reader.main(["ls"]) == 0
    assert str(reader.spec_path("npm-package")) in capsys.readouterr().out
    reader.save(spec, runtime=True)
    spec["name"] = "state-only"
    reader.save(spec, runtime=True)
    assert reader.main(["ls"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].endswith("\tsource")
    assert len(lines) == 3
    assert lines[1].endswith(str(reader.override_path("npm-package")))
    assert lines[2].endswith(str(reader.override_path("state-only")))


def test_run_valid_spec_never_calls_compile(monkeypatch):
    spec, _ = compile_npm()
    reader.save(spec)
    before = len(calls())
    fetch = mock.Mock(return_value=(html("zod"), "urllib"))
    monkeypatch.setattr(reader, "fetch", fetch)
    compiler = mock.Mock(side_effect=AssertionError("run must use no AI"))
    monkeypatch.setattr(reader, "compile_spec", compiler)
    result = reader.run_spec(reader.load("npm-package"), {"name": "zod"}, False)
    assert result["rows"][0]["name"] == "zod"
    assert result["meta"] == {"fetch_method": "urllib"}
    fetch.assert_called_once_with("https://www.npmjs.com/package/zod", preferred="urllib")
    compiler.assert_not_called()
    assert len(calls()) == before
    assert reader.load("npm-package")["last_ok"]


@checks.mark.parametrize("heal", [False, True])
def test_run_and_heal_ignore_stale_example(monkeypatch, capsys, heal):
    spec, _ = compile_npm()
    if heal:
        spec["paths"]["license"] = "broken.selector"
    reader.save(spec)
    page = html().replace('"19.2.0"', '"20.0.0"')
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (page, "urllib"))
    before = len(calls())
    assert reader.main(["run", "npm-package"]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out)["rows"][0]["latest_version"] == "20.0.0"
    assert captured.err == ""
    assert len(calls()) == before + int(heal)
    saved = reader.load("npm-package")
    assert saved["example"]["latest_version"] == "19.2.0"
    assert bool(saved["healed_at"]) == heal


def test_run_heals_once_and_no_heal_second_break(monkeypatch):
    spec, _ = compile_npm()
    spec["paths"]["license"] = "broken.selector"
    reader.save(spec)
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "crwl"))
    before = len(calls())
    result = reader.run_spec(reader.load("npm-package"), {}, False)
    assert result["rows"][0]["license"] == "MIT"
    assert result["meta"] == {"fetch_method": "crwl"}
    assert len(calls()) == before + 1
    saved = reader.load("npm-package")
    assert saved["healed_at"]
    assert saved["fetch_method"] == "crwl"
    saved["paths"]["license"] = "second.break"
    reader.save(saved, runtime=True)
    with checks.raises(reader.ReaderError) as exc:
        reader.run_spec(reader.load("npm-package"), {}, True)
    assert exc.value.code == 12
    assert "license" in str(exc.value)
    assert len(calls()) == before + 1


def test_failed_heal_keeps_old_spec_and_exits_12(monkeypatch):
    spec, _ = compile_npm()
    spec["paths"]["license"] = "broken"
    reader.save(spec)
    before = reader.spec_path("npm-package").read_bytes()
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "urllib"))
    monkeypatch.setenv("STUB_MODE", "broken")
    with checks.raises(reader.ReaderError) as exc:
        reader.run_spec(reader.load("npm-package"), {}, False)
    assert exc.value.code == 12
    assert "license" in str(exc.value)
    assert len(calls()) == 5  # initial compile plus one compile cycle of 4 attempts
    assert reader.spec_path("npm-package").read_bytes() == before


def test_run_fetch_failure_skips_heal(monkeypatch):
    spec, _ = compile_npm()
    monkeypatch.setattr(reader, "fetch", mock.Mock(side_effect=reader.ReaderError(10, "offline")))
    with checks.raises(reader.ReaderError) as exc:
        reader.run_spec(spec, {}, False)
    assert exc.value.code == 10
    assert len(calls()) == 1


def test_css_subprocess_contract_and_snapshot(monkeypatch):
    spec = json.loads((DATA / "pricing-schema.json").read_text())

    def crwl(command, **kwargs):
        assert command == [reader.crawl4ai_python(), str(ROOT / "crawl_helper.py"), "css"]
        assert json.loads(kwargs["input"]) == {"html": "<html>snapshot</html>", "schema": spec["schema"]}
        rows = [
            {"model": "Claude Sonnet 5.5 Description", "input": "$2 / MTok", "output": "$10 / MTok",
             "cache_write_5m": "$2.5", "cache_write_1h": "$4", "cache_read": "$0.10"}]
        return subprocess.CompletedProcess(command, 0, json.dumps({"rows": rows}), "")

    monkeypatch.setattr(reader.subprocess, "run", crwl)
    result = reader.extract(spec, "<html>snapshot</html>")
    assert result[0]["model"] == "Claude Sonnet 5.5"
    assert result[0]["input"] == 2 and result[0]["output"] == 10
    assert reader.failures(spec, result) == []


def test_real_crawl4ai_pricing_snapshot():
    if not Path(reader.crawl4ai_python()).exists() and not reader.shutil.which(reader.crawl4ai_python()):
        checks.skip("optional crawl4ai integration; subprocess contract is tested separately")
    spec = json.loads((DATA / "pricing-schema.json").read_text())
    result = reader.extract(spec, (DATA / "claude-pricing.html").read_text())
    assert len(result) == 16
    assert len({row["model"] for row in result}) == 16
    assert reader.failures(spec, result) == []
    by_name = {row["model"]: row for row in result}
    assert (by_name["Claude Fable 5.1"]["input"], by_name["Claude Fable 5.1"]["output"]) == (10, 50)
    assert (by_name["Claude Sonnet 5.5"]["input"], by_name["Claude Sonnet 5.5"]["output"]) == (2, 10)


def test_proxy_connector_uses_checked_sockaddr_without_dns(monkeypatch):
    monkeypatch.setattr(socket, "socket", REAL_SOCKET)

    async def check():
        sock = mock.Mock()
        create = mock.Mock(return_value=sock)
        monkeypatch.setattr(socket, "socket", create)
        connect = mock.AsyncMock()
        monkeypatch.setattr(asyncio.get_running_loop(), "sock_connect", connect)
        streams = (mock.Mock(), mock.Mock())
        opened = mock.AsyncMock(return_value=streams)
        monkeypatch.setattr(asyncio, "open_connection", opened)
        assert await helper["pinned_connection"](public_address()) == streams
        create.assert_called_once_with(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        sock.setblocking.assert_called_once_with(False)
        connect.assert_awaited_once_with(sock, (PUBLIC_IP, 443))
        opened.assert_awaited_once_with(sock=sock)
        socket.getaddrinfo.assert_not_called()

    asyncio.run(check())


@checks.mark.parametrize("raw_request", [b"GET http://public.example/ HTTP/1.1\r\n\r\n",
                                       b"CONNECT public.example:443 HTTP/1.1\r\n\r\n"])
@checks.mark.parametrize("addresses", [[], [public_address(), public_address("127.0.0.1")],
                                      [public_address(".".join(['169', '254', '169', '254']))]])
def test_proxy_refuses_unresolved_or_nonpublic_targets(monkeypatch, raw_request, addresses):
    monkeypatch.setattr(socket, "socket", REAL_SOCKET)
    socket.getaddrinfo.side_effect = None
    socket.getaddrinfo.return_value = addresses
    connector = mock.AsyncMock(side_effect=AssertionError("refused address must never connect"))
    monkeypatch.setitem(helper["FilteringProxy"].handle.__globals__, "pinned_connection", connector)

    async def check():
        async with helper["FilteringProxy"]() as proxy:
            source, client = await asyncio.open_connection("127.0.0.1", proxy.port)
            client.write(raw_request)
            await client.drain()
            assert (await source.read()).startswith(b"HTTP/1.1 502")
            assert len(proxy.blocked) == 1
            assert "non-public" in proxy.blocked[0] or "no addresses" in proxy.blocked[0]
            connector.assert_not_called()
            client.close()
            await client.wait_closed()

    asyncio.run(asyncio.wait_for(check(), 10))



def load_tests(loader, suite, pattern):
    return checks.suite(globals())
