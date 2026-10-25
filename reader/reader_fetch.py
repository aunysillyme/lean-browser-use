"""Public page reader: fetch operations."""
from reader_base import *
from reader_crawl import crawl_helper

def checked_address(url):
    if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url):
        raise ReaderError(2, "refused target: whitespace or control character")
    try:
        target = urlsplit(url)
        if target.scheme not in ("http", "https") or not target.hostname:
            raise ValueError("only http(s) URLs with a host are supported")
        if target.username is not None or target.password is not None:
            raise ValueError("URL credentials are not supported")
        port = target.port or (443 if target.scheme == "https" else 80)
    except ValueError as exc:
        raise ReaderError(2, f"refused target: {exc}") from exc
    try:
        addresses = socket.getaddrinfo(target.hostname, port, type=socket.SOCK_STREAM,
                                       proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ReaderError(10, f"fetch failed: DNS lookup: {exc}") from exc
    if not addresses:
        raise ReaderError(10, "fetch failed: DNS returned no addresses")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0].split("%", 1)[0])
        # Tests may opt in to one exact local HTTP origin, never a host range.
        if (target.scheme == "http" and target.hostname == "127.0.0.1" and target.port
                and os.environ.get("READER_TEST_ALLOW_ORIGIN") == f"http://127.0.0.1:{port}"
                and str(ip) == "127.0.0.1"):
            continue
        if not ip.is_global or ip.is_multicast or ip.is_reserved:
            raise ReaderError(2, f"refused target: {target.hostname} resolves to a non-public address")
    return addresses[0]


def connection(cls, host, address, **kwargs):
    conn = cls(host, **kwargs)

    def connect(unused, timeout, source_address=None):
        sock = socket.socket(address[0], address[1], address[2])
        try:
            sock.settimeout(timeout)
            sock.connect(address[4])
            return sock
        except BaseException:
            sock.close()
            raise

    conn._create_connection = connect
    return conn


class PinnedHTTP(HTTPHandler):
    def http_open(self, req):
        return self.do_open(lambda host, **kw: connection(
            http.client.HTTPConnection, host, req.checked_address, **kw), req)


class PinnedHTTPS(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(lambda host, **kw: connection(
            http.client.HTTPSConnection, host, req.checked_address, **kw), req,
            context=self._context)


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        address = checked_address(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected:
            redirected.checked_address = address
        return redirected

    def http_error_302(self, req, fp, code, msg, headers):
        # urllib drains redirect bodies before following them. Bound that drain.
        if len(fp.read(FETCH_CAP + 1)) > FETCH_CAP:
            fp.close()
            raise ReaderError(10, "fetch failed: redirect body exceeds size limit")
        return super().http_error_302(req, fp, code, msg, headers)

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def fetch_urllib(url):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    req.checked_address = checked_address(url)
    # Disable ambient proxies so the checked sockaddr is the actual destination.
    opener = build_opener(ProxyHandler({}), PinnedHTTP(), PinnedHTTPS(), PublicRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            body = response.read(FETCH_CAP + 1)
            if len(body) > FETCH_CAP:
                raise ReaderError(10, "fetch failed: page exceeds size limit")
            try:
                return body.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            except LookupError:
                return body.decode("utf-8", errors="replace")
    except HTTPError:
        raise
    except (OSError, URLError, ValueError) as exc:
        raise ReaderError(10, f"fetch failed: {exc}") from exc


def bot_wall(html):
    title = re.search(r"<title\b[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
    if title and re.search(r"just a moment|attention required|access denied|verify (?:you are|you're) human|captcha",
                           title.group(1), re.IGNORECASE):
        return True
    return bool(re.search(r"/cdn-cgi/challenge-platform/[^\s\"'<>]*orchestrate/|\bcf-chl-|_cf_chl_opt\b|please enable js and disable any ad blocker",
                          html, re.IGNORECASE))


def fetch_crwl(url):
    checked_address(url)
    page = crawl_helper("fetch", {"url": url}, 10)
    try:
        if page.get("success") is False or (page.get("status_code") or 200) >= 400:
            raise ValueError("returned an unsuccessful page")
        for key in ("url", "redirected_url"):
            if page.get(key):
                checked_address(page[key])
        html = page.get("html")
        if not isinstance(html, str) or not html.strip():
            raise ValueError("returned no html field")
        if len(html.encode("utf-8")) > FETCH_CAP:
            raise ValueError("page exceeds size limit")
        if bot_wall(html):
            raise ValueError("page is still a bot wall")
        return html
    except (ValueError, TypeError) as exc:
        raise ReaderError(10, f"fetch failed: crwl helper: {exc}") from exc


def fetch(url, preferred="urllib"):
    if preferred == "crwl":
        return fetch_crwl(url), "crwl"
    try:
        html = fetch_urllib(url)
    except HTTPError as exc:
        exc.close()
        if exc.code not in (401, 403, 429):
            raise ReaderError(10, f"fetch failed: {exc}") from exc
        return fetch_crwl(url), "crwl"
    if bot_wall(html):
        return fetch_crwl(url), "crwl"
    return html, "urllib"


