from reader_test_support import *

@checks.mark.parametrize("chunked", [False, True])
def test_proxy_http_frames_body_and_drops_pipelined_requests(monkeypatch, chunked):
    monkeypatch.setattr(socket, "socket", REAL_SOCKET)
    monkeypatch.setattr(socket, "getaddrinfo", REAL_GETADDRINFO)
    received = []
    body = b"4\r\ndata\r\n0\r\n\r\n" if chunked else b"data"

    async def origin(source, client):
        head = await source.readuntil(b"\r\n\r\n")
        data = await source.readexactly(len(body))
        try:
            extra = await asyncio.wait_for(source.read(1), 0.05)
        except asyncio.TimeoutError:
            extra = b""
        received.append((head, data, extra))
        client.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
        await client.drain()
        client.close()
        await client.wait_closed()

    async def check():
        server = await asyncio.start_server(origin, "127.0.0.1", 0)
        async with server, helper["FilteringProxy"]() as proxy:
            port = server.sockets[0].getsockname()[1]
            url = f"http://127.0.0.1:{port}"
            monkeypatch.setenv("READER_TEST_ALLOW_ORIGIN", url)
            source, client = await asyncio.open_connection("127.0.0.1", proxy.port)
            framing = "Transfer-Encoding: chunked" if chunked else "Content-Length: 4"
            client.write((f"POST {url}/page?key=value HTTP/1.1\r\nHost: invalid.example\r\n"
                          f"Proxy-Authorization: discard\r\nConnection: keep-alive\r\n{framing}\r\n\r\n").encode()
                         + body + b"GET http://127.0.0.1:9/denied HTTP/1.1\r\n\r\n")
            await client.drain()
            assert (await source.read()).endswith(b"ok")
            assert not proxy.blocked
            head, data, extra = received[0]
            assert head.startswith(b"POST /page?key=value HTTP/1.1\r\n")
            assert f"Host: 127.0.0.1:{port}\r\n".encode() in head
            assert b"Connection: close\r\n" in head
            assert b"Proxy-Authorization" not in head
            assert data == body and extra == b""
            client.close()
            await client.wait_closed()

    asyncio.run(asyncio.wait_for(check(), 10))


def test_proxy_connect_tunnels_bytes_unchanged(monkeypatch):
    monkeypatch.setattr(socket, "socket", REAL_SOCKET)
    received = []
    addresses = []
    connect = helper["pinned_connection"]
    payload = b"\x16\x03\x01\x00\x10" + bytes(range(256)) + b"\r\n\r\n"
    response = b"\x16\x03\x03" + payload[::-1]

    def resolve(host, port, **kwargs):
        assert host == "public.example"
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))]

    async def mapped_connection(address):
        addresses.append(address)
        # Map a checked public fixture address to the local byte-echo server.
        assert address[4][0] == PUBLIC_IP
        return await connect((*address[:4], ("127.0.0.1", address[4][1])))

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setitem(helper["FilteringProxy"].handle.__globals__, "pinned_connection", mapped_connection)

    async def echo(source, client):
        received.append(await source.read())
        client.write(response)
        await client.drain()
        client.close()
        await client.wait_closed()

    async def check():
        server = await asyncio.start_server(echo, "127.0.0.1", 0)
        async with server, helper["FilteringProxy"]() as proxy:
            port = server.sockets[0].getsockname()[1]
            source, client = await asyncio.open_connection("127.0.0.1", proxy.port)
            client.write(f"CONNECT public.example:{port} HTTP/1.1\r\n\r\n".encode())
            await client.drain()
            assert await source.readuntil(b"\r\n\r\n") == b"HTTP/1.1 200 Connection Established\r\n\r\n"
            client.write(payload)
            await client.drain()
            client.write_eof()
            assert await source.read() == response
            assert received == [payload]
            assert len(addresses) == 1 and not proxy.blocked
            client.close()
            await client.wait_closed()

    asyncio.run(asyncio.wait_for(check(), 10))


def test_browser_fetch_local_origin_and_script_rendering(local_http):
    origin, _, pages, requests = local_http
    pages["/page"] = (200, {}, '<p id="value">before</p><p>A public page with enough visible text for crawl4ai.</p>'
                      '<script>document.querySelector("p").textContent="after"</script>')
    page, method = reader.fetch(origin + "/page", preferred="crwl")
    assert '<p id="value">after</p>' in page and method == "crwl"
    assert (origin, "/page") in requests
    assert all(host == origin for host, path in requests)


@checks.mark.parametrize("destination", ["other-port", ".".join(['169', '254', '169', '254'])])
@checks.mark.parametrize("kind", ["redirect", "image", "iframe", "websocket"])
def test_browser_blocks_private_redirects_and_subresources(local_http, destination, kind):
    origin, denied_origin, pages, requests = local_http
    target = (denied_origin if destination == "other-port" else "http://" + ".".join(["169", "254", "169", "254"])) + "/denied"
    if kind == "redirect":
        pages["/page"] = (302, {"Location": target}, "")
    elif kind == "websocket":
        pages["/page"] = (200, {}, f'<p>allowed</p><script>new WebSocket("{target.replace("http:", "ws:")}")</script>')
    else:
        element = f'<img src="{target}">' if kind == "image" else f'<iframe src="{target}"></iframe>'
        pages["/page"] = (200, {}, '<p>allowed</p>' + element)
    with checks.raises(reader.ReaderError) as exc:
        reader.fetch(origin + "/page", preferred="crwl")
    assert exc.value.code == 10
    assert "non-public" in str(exc.value)
    assert requests == [(origin, "/page")]


@checks.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_browser_follows_same_host_redirects(local_http, status):
    origin, _, pages, requests = local_http
    pages["/page"] = (status, {"Location": "/step"}, "")
    pages["/step"] = (status, {"Location": origin + "/final"}, "")
    pages["/final"] = (200, {}, '<p>Final page after the checked redirect chain.</p>'
                       '<p>This public fixture contains enough visible text for crawl4ai.</p>')
    page, method = reader.fetch(origin + "/page", preferred="crwl")
    assert "Final page" in page and method == "crwl"
    assert requests == [(origin, path) for path in ("/page", "/step", "/final")]


def test_browser_follows_public_host_redirect_with_stub_resolver(local_http, tmp_path):
    origin, _, pages, requests = local_http
    port = origin.rsplit(":", 1)[1]
    target = f"http://public.example:{port}/final"
    pages["/page"] = (302, {"Location": target}, "")
    pages["/final"] = (200, {}, '<p>Public host redirect followed through the filtering proxy.</p>')
    # Stub only DNS and the physical connection to the public fixture address.
    # The real proxy and public-address check run unchanged in the browser child.
    script = f'''import runpy, socket
helper = runpy.run_path({str(ROOT / "crawl_helper.py")!r})
PUBLIC_IP = {PUBLIC_IP!r}
resolve = socket.getaddrinfo
def fixture_dns(host, port, *args, **kwargs):
    if host == "public.example":
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))]
    assert host in ("127.0.0.1", "localhost"), host
    return resolve(host, port, *args, **kwargs)
socket.getaddrinfo = fixture_dns
connect = helper["pinned_connection"]
async def fixture_connection(address):
    if address[4][0] == PUBLIC_IP:
        address = (*address[:4], ("127.0.0.1", address[4][1]))
    return await connect(address)
helper["FilteringProxy"].handle.__globals__["pinned_connection"] = fixture_connection
raise SystemExit(helper["main"]())
'''
    result = subprocess.run([reader.crawl4ai_python(), "-c", script, "fetch"],
                            input=json.dumps({"url": origin + "/page"}), capture_output=True,
                            text=True, timeout=45, env=reader.crwl_env(tmp_path))
    assert result.returncode == 0, result.stderr[-2000:]
    page = json.loads(result.stdout)
    assert "Public host redirect followed" in page["html"]
    assert page["redirected_url"] == target
    assert requests == [(origin, "/page"), (origin, "/final")]


def test_browser_follows_same_host_subresource_redirects(local_http):
    origin, _, pages, requests = local_http
    pages["/page"] = (200, {}, '<p id="value">before</p><script src="/redirect"></script>'
                      '<p>This public fixture contains enough visible text for crawl4ai.</p>')
    pages["/redirect"] = (302, {"Location": "/script"}, "")
    pages["/script"] = (200, {"Content-Type": "application/javascript"},
                        'document.querySelector("p").textContent="loaded";')
    page, _ = reader.fetch(origin + "/page", preferred="crwl")
    assert '<p id="value">loaded</p>' in page
    assert (origin, "/script") in requests


@checks.mark.parametrize("navigation", [False, True])
def test_browser_checks_script_navigation_destination(local_http, navigation):
    origin, _, pages, requests = local_http
    target = origin if navigation else origin.replace("127.0.0.1", "localhost")
    pages["/page"] = (200, {}, f'<script>location.replace("{target}/final")</script>')
    pages["/final"] = (200, {}, '<p>Final page after the checked script navigation.</p>'
                       '<p>This public fixture contains enough visible text for crawl4ai.</p>')
    if navigation:
        page, _ = reader.fetch(origin + "/page", preferred="crwl")
        assert "Final page" in page
        assert (origin, "/final") in requests
    else:
        with checks.raises(reader.ReaderError, match="non-public") as exc:
            reader.fetch(origin + "/page", preferred="crwl")
        assert exc.value.code == 10
        assert requests == [(origin, "/page")]


@checks.mark.parametrize("kind", ["redirect", "image", "iframe"])
def test_browser_stops_private_later_redirect_hop(local_http, kind):
    origin, denied_origin, pages, requests = local_http
    element = '<img src="/redirect">' if kind == "image" else '<iframe src="/redirect"></iframe>'
    pages["/page"] = ((302, {"Location": "/redirect"}, "") if kind == "redirect" else
                      (200, {}, element))
    pages["/redirect"] = (302, {"Location": denied_origin + "/denied"}, "")
    with checks.raises(reader.ReaderError, match="non-public") as exc:
        reader.fetch(origin + "/page", preferred="crwl")
    assert exc.value.code == 10
    assert (origin, "/redirect") in requests
    assert all(path != "/denied" for host, path in requests)


def test_test_origin_override_is_exact_and_opt_in(local_http, monkeypatch):
    origin, denied_origin, _, _ = local_http
    reader.checked_address(origin + "/allowed")
    for target in (origin.replace("127.0.0.1", "localhost"), origin.replace("http:", "https:"),
                   denied_origin, "http://" + ".".join(["169", "254", "169", "254"])):
        with checks.raises(reader.ReaderError) as exc:
            reader.checked_address(target)
        assert exc.value.code == 2
    monkeypatch.delenv("READER_TEST_ALLOW_ORIGIN")
    with checks.raises(reader.ReaderError) as exc:
        reader.checked_address(origin)
    assert exc.value.code == 2


def test_css_hostile_html_extracts_without_browser_or_requests(local_http, monkeypatch):
    origin, _, _, requests = local_http
    # Browser startup fails immediately if the CSS helper tries to launch it.
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", "/reader-no-browser-for-css")
    spec = {"type": "css", "schema": {"name": "sample", "baseSelector": "p",
            "fields": [{"name": "value", "selector": "span", "type": "text"}]}}
    page = (f'<p><span>extracted</span></p><script>fetch("{origin}/script")</script>'
            f'<img src="{origin}/image"><img src="http://127.0.0.1:9/">')
    assert reader.extract(spec, page) == [{"value": "extracted"}]
    assert requests == []


@checks.mark.parametrize("wrapper", ["shebang", "env", "exec", "missing"])
def test_crawl4ai_python_resolution(monkeypatch, tmp_path, wrapper):
    monkeypatch.delenv("READER_CRAWL4AI_PYTHON", raising=False)
    executable = tmp_path / "crwl"
    python = str(tmp_path / "python with spaces") if wrapper == "exec" else sys.executable
    if wrapper == "shebang":
        executable.write_text(f"#!{python}\n")
    elif wrapper == "env":
        executable.write_text("#!/usr/bin/env python3\n")
        python = reader.shutil.which("python3")
    elif wrapper == "exec":
        executable.write_text(f'''#!/bin/sh\n\x27\x27\x27exec\x27 "{python}" "$0" "$@"\n\x27 \x27\x27\x27\n''')
    else:
        python = str(ROOT / ".venv/bin/python")
    monkeypatch.setattr(reader, "crwl_binary", lambda: str(executable))
    assert reader.crawl4ai_python() == python
    monkeypatch.setenv("READER_CRAWL4AI_PYTHON", "/custom/python")
    assert reader.crawl4ai_python() == "/custom/python"


def test_compile_embedded_miss_then_css(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "pricing")
    page = '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script><table></table>'
    monkeypatch.setattr(reader, "extract", lambda spec, html: [{"model": "Claude", "input": 2, "output": 10}])
    spec, _ = reader.compile_spec("prices", "https://public.example", {}, "model prices", None, page)
    assert spec["type"] == "css"
    assert len(calls()) == 2
    assert "embedded_json" in calls()[0]
    assert "html" in calls()[1]


def test_params_encoding_and_usage():
    assert reader.render_url("https://public.example/{name}", {"name": "@scope/a?x=y"}) == "https://public.example/%40scope%2Fa%3Fx%3Dy"
    assert reader.parse_params(["name=react", "name=zod", "x=a=b"]) == {"name": "zod", "x": "a=b"}
    for operation in (lambda: reader.render_url("https://public.example/{missing}", {}),
                      lambda: reader.parse_params(["bad"]), lambda: reader.spec_path("../secret")):
        with checks.raises(reader.ReaderError) as exc:
            operation()
        assert exc.value.code == 2


def test_cli_compile_run_ls(monkeypatch, capsys):
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html("zod" if url.endswith("zod") else "react"), "crwl"))
    assert reader.main(["compile", "npm-package", "--url", "https://www.npmjs.com/package/{name}",
                        "--want", "package fields", "--param", "name=react"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["name"] == "react"
    assert reader.load("npm-package")["fetch_method"] == "crwl"
    assert reader.main(["run", "npm-package", "--param", "name=zod"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["rows"][0]["name"] == "zod"
    assert output["meta"] == {"fetch_method": "crwl"}
    assert reader.main(["ls"]) == 0
    listing = capsys.readouterr().out
    assert all(key in listing for key in ("npm-package", "embedded_json", "compiled_at", "last_ok", "healed_at"))


def test_compile_without_example_warns_once_across_refinements(monkeypatch, capsys):
    monkeypatch.setenv("STUB_MODE", "refine")
    monkeypatch.setattr(reader, "fetch", lambda url, **kwargs: (html(), "urllib"))
    assert reader.main(["compile", "npm-package", "--url", "https://public.example", "--want", "package fields"]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out)[0]["name"] == "react"
    assert len(calls()) == 2
    assert captured.err.splitlines() == [
        "reader: warning: wrong-but-plausible values cannot be detected without an example row; "
        "use --example to anchor the compile"]


@checks.mark.parametrize("url", ["file:///etc/passwd", "http://127.0.0.1"])
def test_cli_compile_and_run_refuse_targets(url):
    env = {**os.environ, "READER_COMPILE_CMD": "reader-must-not-be-called"}
    compiled = subprocess.run([sys.executable, str(ROOT / "reader"), "compile", "bad", "--url", url,
                               "--want", "name"], env=env, capture_output=True, text=True)
    assert compiled.returncode == 2 and compiled.stdout == ""
    spec, _ = compile_npm()
    spec["url_template"] = url
    reader.save(spec)
    run = subprocess.run([sys.executable, str(ROOT / "reader"), "run", "npm-package"],
                         env=env, capture_output=True, text=True)
    assert run.returncode == 2 and run.stdout == ""


def test_cli_invalid_example_and_corrupt_spec(capsys):
    assert reader.main(["compile", "bad", "--url", "https://public.example", "--want", "name", "--example", "42"]) == 2
    path = reader.spec_path("corrupt")
    path.parent.mkdir(parents=True)
    path.write_text("not JSON")
    assert reader.main(["run", "corrupt"]) == 2
    assert "cannot load spec" in capsys.readouterr().err


def test_candidate_rejects_computed_code_and_required_omissions():
    candidate = json.loads((DATA / "pricing-schema.json").read_text())
    candidate["schema"]["fields"][0]["expression"] = "__import__('os')"
    with checks.raises(ValueError, match="computed"):
        reader.validate_candidate(candidate, None)
    candidate = json.loads((DATA / "npm-schema.json").read_text())
    candidate["required"] = ["missing"]
    with checks.raises(ValueError, match="required"):
        reader.validate_candidate(candidate, None)



def load_tests(loader, suite, pattern):
    return checks.suite(globals())
