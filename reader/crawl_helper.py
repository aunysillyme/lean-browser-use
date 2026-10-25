#!/usr/bin/env python3
"""Isolated crawl4ai operations; JSON on stdin and stdout."""

import asyncio
from contextlib import redirect_stdout, suppress
import json
from pathlib import Path
import re
import runpy
import socket
import sys
from urllib.parse import urlsplit


reader = runpy.run_path(str(Path(__file__).with_name("reader")))


async def pinned_connection(address):
    sock = socket.socket(address[0], address[1], address[2])
    try:
        sock.setblocking(False)
        await asyncio.wait_for(asyncio.get_running_loop().sock_connect(sock, address[4]), 30)
        return await asyncio.open_connection(sock=sock)
    except BaseException:
        sock.close()
        raise


async def relay(source, destination):
    while data := await source.read(65536):
        destination.write(data)
        await destination.drain()
    if destination.can_write_eof():
        destination.write_eof()


class FilteringProxy:
    def __init__(self):
        self.blocked = []
        self.tasks = set()

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0, limit=65536)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *args):
        self.server.close()
        await self.server.wait_closed()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def handle(self, source, client):
        task = asyncio.current_task()
        self.tasks.add(task)
        upstream = None
        responding = False
        try:
            head = await asyncio.wait_for(source.readuntil(b"\r\n\r\n"), 30)
            lines = head.decode("iso-8859-1").split("\r\n")
            method, target, version = lines[0].split(" ")
            if not re.fullmatch(r"[A-Z]+", method) or version not in ("HTTP/1.0", "HTTP/1.1"):
                raise ValueError("invalid proxy request line")
            headers = []
            for line in lines[1:-2]:
                key, sep, value = line.partition(":")
                if (not sep or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key)
                        or any(ord(c) < 32 and c != "\t" or ord(c) == 127 for c in value)):
                    raise ValueError("invalid proxy header")
                headers.append((key.lower(), value.strip()))
            lengths = [value for key, value in headers if key == "content-length"]
            encodings = [value.lower() for key, value in headers if key == "transfer-encoding"]
            if (len(lengths) > 1 or lengths and not re.fullmatch(r"[0-9]+", lengths[0])
                    or encodings and (encodings != ["chunked"] or lengths)):
                raise ValueError("ambiguous proxy request body")
            length = int(lengths[0]) if lengths else 0
            if length > reader["FETCH_CAP"]:
                raise ValueError("proxy request body exceeds size limit")
            if method == "CONNECT":
                parsed = urlsplit("https://" + target)
                if (not parsed.port or parsed.netloc != target or parsed.path or parsed.query
                        or parsed.fragment or length or encodings):
                    raise ValueError("invalid CONNECT authority")
                url = "https://" + target
            else:
                parsed = urlsplit(target)
                if parsed.scheme != "http" or not parsed.netloc or parsed.fragment:
                    raise ValueError("proxy requires an absolute HTTP URL")
                url = target
            address = await asyncio.to_thread(reader["checked_address"], url)
            remote, upstream = await pinned_connection(address)
            if method == "CONNECT":
                client.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await client.drain()
                responding = True
                await self.tunnel(source, client, remote, upstream)
            else:
                connection = {token.strip().lower() for key, value in headers if key == "connection"
                              for token in value.split(",")}
                websocket = ("upgrade" in connection and
                             any(key == "upgrade" and value.lower() == "websocket" for key, value in headers))
                if connection & {"host", "content-length", "transfer-encoding"}:
                    raise ValueError("invalid Connection header")
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                # One HTTP request per connection: only its framed body is forwarded.
                # A pipelined absolute URL must never bypass the destination check.
                dropped = {"host", "connection", "proxy-connection", "proxy-authorization", *connection}
                if websocket:
                    dropped.discard("upgrade")
                output = [f"{method} {path} {version}", f"Host: {parsed.netloc}"]
                output += [f"{key}: {value}" for key, value in headers if key not in dropped]
                output += ["Connection: Upgrade" if websocket else "Connection: close", "", ""]
                upstream.write("\r\n".join(output).encode("iso-8859-1"))
                await self.body(source, upstream, length, bool(encodings))
                await upstream.drain()
                responding = True
                if websocket:
                    await self.tunnel(source, client, remote, upstream)
                else:
                    await relay(remote, client)
        except (ValueError, reader["ReaderError"], asyncio.LimitOverrunError) as exc:
            self.blocked.append(f"blocked browser request: {exc}")
        except (OSError, asyncio.IncompleteReadError, asyncio.TimeoutError):
            pass
        finally:
            if not responding:
                with suppress(OSError):
                    client.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    await client.drain()
            for writer in (upstream, client):
                if writer is not None:
                    writer.close()
                    with suppress(OSError):
                        await writer.wait_closed()
            self.tasks.discard(task)

    async def body(self, source, upstream, length, chunked):
        total = 0
        while True:
            if chunked:
                line = await asyncio.wait_for(source.readuntil(b"\r\n"), 30)
                size = line[:-2].split(b";", 1)[0]
                if not re.fullmatch(rb"[0-9A-Fa-f]+", size):
                    raise ValueError("invalid proxy chunk size")
                length = int(size, 16)
                # Page requests use an empty trailer section.
                if not length:
                    if await asyncio.wait_for(source.readexactly(2), 30) != b"\r\n":
                        raise ValueError("proxy request trailers are unsupported")
                    upstream.write(b"0\r\n\r\n")
                    return
                upstream.write(line)
            total += length
            if total > reader["FETCH_CAP"]:
                raise ValueError("proxy request body exceeds size limit")
            while length:
                data = await asyncio.wait_for(source.readexactly(min(length, 65536)), 30)
                upstream.write(data)
                await upstream.drain()
                length -= len(data)
            if not chunked:
                return
            if await asyncio.wait_for(source.readexactly(2), 30) != b"\r\n":
                raise ValueError("invalid proxy chunk ending")
            upstream.write(b"\r\n")

    async def tunnel(self, source, client, remote, upstream):
        tasks = [asyncio.create_task(relay(source, upstream)), asyncio.create_task(relay(remote, client))]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def fetch(url):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    reader["checked_address"](url)

    async def protect_browser(browser, **kwargs):
        new_context = browser.new_context

        async def protected_context(**options):
            # crawl4ai 0.9.2 has no service_workers option in BrowserConfig.
            options["service_workers"] = "block"
            return await new_context(**options)

        browser.new_context = protected_context

    async with FilteringProxy() as proxy:
        config = BrowserConfig(headless=True, verbose=False, ignore_https_errors=False,
                               extra_args=[f"--proxy-server=http://127.0.0.1:{proxy.port}",
                                           "--proxy-bypass-list=<-loopback>"])
        crawler = AsyncWebCrawler(config=config)
        crawler.crawler_strategy.set_hook("on_browser_created", protect_browser)
        async with crawler:
            result = await crawler.arun(url=url, config=CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS, verbose=False, page_timeout=30000))
        if proxy.blocked:
            raise ValueError("; ".join(proxy.blocked[:5]))
        if not result.success:
            raise ValueError(result.error_message or "unsuccessful page")
        for target in (result.url, result.redirected_url):
            if target:
                reader["checked_address"](target)
        return {"html": result.html, "success": result.success, "status_code": result.status_code,
                "url": result.url, "redirected_url": result.redirected_url}


def main():
    operation = sys.argv[1]
    try:
        payload = json.load(sys.stdin)
        # Keep crawl4ai's startup and progress output out of the JSON channel.
        with redirect_stdout(sys.stderr):
            if operation == "css":
                from crawl4ai import JsonCssExtractionStrategy

                schema = payload["schema"]
                if "sample_indices" in payload:
                    # A field without a selector extracts the base element itself.
                    key = "__reader_outer_html"
                    names = {field["name"] for field in schema["fields"] + schema.get("baseFields", [])}
                    while key in names:
                        key += "_"
                    schema = dict(schema, fields=[*schema["fields"], {"name": key, "type": "html"}])
                    rows = JsonCssExtractionStrategy(schema).extract("", payload["html"])
                    outer_html = []
                    for row in rows:
                        markup = row.pop(key)
                        # Keep indices aligned when the original schema drops empty rows.
                        if row:
                            outer_html.append(markup)
                    result = {"samples": {str(index): outer_html[index][:600]
                              for index in payload["sample_indices"][:3] if 0 <= index < len(outer_html)}}
                else:
                    result = {"rows": JsonCssExtractionStrategy(schema).extract("", payload["html"])}
            elif operation == "fetch":
                result = asyncio.run(fetch(payload["url"]))
            else:
                raise ValueError("unknown helper operation")
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 10 if operation == "fetch" else 12


if __name__ == "__main__":
    sys.exit(main())
