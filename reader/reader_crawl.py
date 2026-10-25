"""Public page reader: crawl operations."""
from reader_base import *

def crwl_env(temp):
    # crawl4ai 0.9.2 ignores its base-directory setting for global.yml.
    # Isolate Path.home() in the child without changing the user's HOME.
    (temp / "sitecustomize.py").write_text(
        "from pathlib import Path\n"
        f"Path.home = classmethod(lambda cls: Path({str(temp)!r}))\n")
    env = dict(os.environ, CRAWL4_AI_BASE_DIRECTORY=str(temp / "crawl"),
               PYTHONPATH=str(temp) + os.pathsep + os.environ.get("PYTHONPATH", ""))
    if (ROOT / ".venv/browsers").exists():
        env.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".venv/browsers"))
    return env


def crwl_binary():
    return shutil.which("crwl") or (str(ROOT / ".venv/bin/crwl") if (ROOT / ".venv/bin/crwl").exists() else "crwl")


def crawl4ai_python():
    if os.environ.get("READER_CRAWL4AI_PYTHON"):
        return os.environ["READER_CRAWL4AI_PYTHON"]
    try:
        script = Path(crwl_binary()).read_text()[:4096]
        first = script.splitlines()[0]
        if first.startswith("#!"):
            parts = shlex.split(first[2:])
            if parts and Path(parts[0]).name == "env":
                parts = [part for part in parts[1:] if not part.startswith("-")]
            if parts and Path(parts[0]).name.startswith("python"):
                return shutil.which(parts[0]) or parts[0]
        # pip uses a shell exec wrapper when the Python path contains spaces.
        match = re.search(r'''^(?:'{3})?exec'?\s+("[^"]+"|'[^']+'|\S+)''', script, re.MULTILINE)
        if match:
            return shlex.split(match.group(1))[0]
    except (OSError, ValueError, IndexError):
        pass
    return str(ROOT / ".venv/bin/python")


def crawl_helper(operation, payload, code):
    with tempfile.TemporaryDirectory(prefix="reader-crawl-") as directory:
        command = [crawl4ai_python(), str(ROOT / "crawl_helper.py"), operation]
        try:
            result = subprocess.run(command, input=json.dumps(payload), capture_output=True,
                                    text=True, timeout=90, env=crwl_env(Path(directory)))
            if result.returncode:
                raise ValueError(result.stderr.strip()[-1500:] or f"exited {result.returncode}")
            return json_object(result.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            raise ReaderError(code, f"{operation} failed: crwl helper (crawl4ai Python required): {exc}") from exc


def crawl4ai_version():
    try:
        # Inspect only the command's version metadata; never import crawl4ai.
        executable = Path(crwl_binary()).resolve()
        for metadata in executable.parent.parent.glob("lib/python*/site-packages/crawl4ai-*.dist-info/METADATA"):
            for line in metadata.read_text().splitlines():
                if line.startswith("Version: "):
                    return line[9:]
    except OSError:
        pass
    return None


