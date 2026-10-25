"""Public page reader: runtime operations."""
from reader_base import *
from reader_fetch import fetch
from reader_extract import extract, failures, validate_candidate
from reader_compile import compile_spec, required_compile_command

def spec_path(name):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", name):
        raise ReaderError(2, "name must use letters, digits, underscores or hyphens")
    directory = Path(os.environ.get("READER_SPECS_DIR", ROOT / "specs"))
    return directory / f"{name}.json"


def state_dir():
    return Path(os.environ.get("READER_STATE_DIR", Path.home() / ".cache/lean-browser-use/reader"))


def state_path(name):
    return state_dir() / spec_path(name).name


def override_path(name):
    return state_dir() / "specs" / spec_path(name).name


def selected_path(name):
    override = override_path(name)
    return override if override.exists() else spec_path(name)


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=f".{path.stem}.", suffix=".tmp", delete=False) as stream:
        temp = Path(stream.name)
        try:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
            stream.close()
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def save(spec, runtime=False):
    name = spec["name"]
    save_json(override_path(name) if runtime else spec_path(name), spec)
    if not runtime:
        # An explicit compile replaces any older healed rules and run metadata.
        override_path(name).unlink(missing_ok=True)
        state_path(name).unlink(missing_ok=True)


def save_state(spec, html, fetch_method):
    save_json(state_path(spec["name"]), {
        "last_ok": now(), "healed_at": spec.get("healed_at"),
        "fetch_method": fetch_method, "page_hash": page_hash(html),
    })


def load(name):
    try:
        spec = json.loads(selected_path(name).read_text())
        if not isinstance(spec, dict):
            raise ValueError("spec must be a JSON object")
        if state_path(name).exists():
            state = json.loads(state_path(name).read_text())
            if not isinstance(state, dict):
                raise ValueError("run state must be a JSON object")
            for key in ("last_ok", "healed_at", "fetch_method", "page_hash"):
                if key in state:
                    spec[key] = state[key]
        validate_candidate(spec, spec.get("example"))
        if spec.get("name") != name or not isinstance(spec.get("url_template"), str):
            raise ValueError("invalid stored name or url_template")
        if not isinstance(spec.get("params"), dict) or not all(
                isinstance(key, str) and isinstance(value, str) for key, value in spec["params"].items()):
            raise ValueError("stored params must be an object of strings")
        if not isinstance(spec.get("want"), str):
            raise ValueError("stored want must be a string")
        if spec.get("fetch_method", "urllib") not in ("urllib", "crwl"):
            raise ValueError("stored fetch_method must be urllib or crwl")
        return spec
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise ReaderError(2, f"cannot load spec {name}: {exc}") from exc


def parse_params(values):
    params = {}
    for value in values:
        key, sep, text = value.partition("=")
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ReaderError(2, "--param must be key=value")
        params[key] = text
    return params


def render_url(template, params):
    try:
        # Only named placeholders are supported, with URL-encoded values.
        def replace(match):
            return quote(params[match.group(1)], safe="")
        url = re.sub(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", replace, template)
        if "{" in url or "}" in url:
            raise ValueError("invalid URL template")
        return url
    except (KeyError, ValueError) as exc:
        raise ReaderError(2, f"URL template parameter: {exc}") from exc


def run_spec(spec, params, no_heal):
    url = render_url(spec["url_template"], {**spec["params"], **params})
    html, fetch_method = fetch(url, preferred=spec.get("fetch_method", "urllib"))
    try:
        rows = extract(spec, html)
        errors = failures(spec, rows)
    except (ReaderError, ValueError, TypeError, KeyError, re.error) as exc:
        errors = [str(exc), *spec["required"]]
    if errors:
        if no_heal:
            raise ReaderError(12, "extraction failed; missing fields: " + "; ".join(errors))
        try:
            healed, rows = compile_spec(spec["name"], spec["url_template"],
                                        {**spec["params"], **params}, spec["want"],
                                        spec.get("example"), html, healed_at=now(),
                                        required_contract=spec["required"], fetch_method=fetch_method,
                                        anchor_example=False)
            # Rerun the replacement spec before replacing the saved file.
            rows = extract(healed, html)
            errors = failures(healed, rows)
            if not errors:
                save(healed, runtime=True)
                save_state(healed, html, fetch_method)
                return {"rows": rows, "meta": {"fetch_method": fetch_method}}
        except ReaderError as exc:
            if exc.code == 2:
                raise
            errors += [str(exc)]
        raise ReaderError(12, "extraction failed after one heal; missing fields: " + "; ".join(errors))
    save_state(spec, html, fetch_method)
    return {"rows": rows, "meta": {"fetch_method": fetch_method}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    compile_parser = commands.add_parser("compile", help="compile a public page once")
    compile_parser.add_argument("name")
    compile_parser.add_argument("--url", required=True)
    compile_parser.add_argument("--want", required=True)
    compile_parser.add_argument("--example")
    compile_parser.add_argument("--param", action="append", default=[])
    run_parser = commands.add_parser("run", help="extract without AI, healing once on failure")
    run_parser.add_argument("name")
    run_parser.add_argument("--param", action="append", default=[])
    run_parser.add_argument("--no-heal", action="store_true")
    commands.add_parser("ls", help="list saved specs")
    args = parser.parse_args(argv)
    try:
        if args.command == "ls":
            directories = (spec_path("unused").parent, override_path("unused").parent)
            names = {path.stem for directory in directories for path in directory.glob("*.json")}
            print("name\turl\ttype\tcompiled_at\tlast_ok\thealed_at\tsource")
            for name in sorted(names):
                spec = load(name)
                print("\t".join(str(spec.get(key) or "") for key in
                                ("name", "url_template", "type", "compiled_at", "last_ok", "healed_at"))
                      + "\t" + str(selected_path(name)))
            return 0
        spec_path(args.name)
        params = parse_params(args.param)
        if args.command == "compile":
            required_compile_command()
            try:
                example = json.loads(args.example) if args.example is not None else None
                if example is not None and not (isinstance(example, dict) or
                        isinstance(example, list) and example and all(isinstance(row, dict) for row in example)):
                    raise ValueError("example must be an object or non-empty list of objects")
            except ValueError as exc:
                raise ReaderError(2, f"invalid --example JSON: {exc}") from exc
            html, fetch_method = fetch(render_url(args.url, params))
            if example is None:
                print("reader: warning: wrong-but-plausible values cannot be detected without an example row; "
                      "use --example to anchor the compile", file=sys.stderr)
            spec, rows = compile_spec(args.name, args.url, params, args.want, example, html,
                                      fetch_method=fetch_method)
            save(spec)
            output = rows
        else:
            output = run_spec(load(args.name), params, args.no_heal)
        print(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except ReaderError as exc:
        print(f"reader: {exc}", file=sys.stderr)
        return exc.code
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f"reader: invalid spec or local I/O failure: {exc}", file=sys.stderr)
        return 2


