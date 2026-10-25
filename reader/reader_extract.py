"""Public page reader: extract operations."""
from reader_base import *
from reader_crawl import crawl_helper

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self.script = None
        self.trimmed = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.script = [dict(attrs), ""]
        if tag in ("script", "style", "svg"):
            self.skip += 1
        if not self.skip:
            self.trimmed.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            self.scripts.append(self.script)
            self.script = None
        if tag in ("script", "style", "svg") and self.skip:
            self.skip -= 1
        elif not self.skip:
            self.trimmed.append(f"</{tag}>")

    def handle_data(self, data):
        if self.script is not None:
            self.script[1] += data
        if not self.skip:
            self.trimmed.append(data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")


def page_data(html):
    parser = PageParser()
    parser.feed(html)
    embedded = {}
    decoder = json.JSONDecoder()
    for attrs, content in parser.scripts:
        if attrs.get("type", "").lower() in ("application/json", "application/ld+json") or attrs.get("id") == "__NEXT_DATA__":
            try:
                value = json.loads(content)
                key = attrs.get("id") or f"ld+json:{len(embedded)}"
                embedded[key] = value
            except ValueError:
                pass
        for match in re.finditer(r"(?:window\s*\.\s*)?(__[\w$]+)\s*=\s*", content):
            tail = content[match.end():].lstrip()
            try:
                if tail.startswith("JSON.parse("):
                    encoded, _ = decoder.raw_decode(tail[len("JSON.parse("):].lstrip())
                    value = json.loads(encoded)
                else:
                    value, _ = decoder.raw_decode(tail)
                if isinstance(value, (dict, list)):
                    embedded[match.group(1)] = value
            except (ValueError, TypeError):
                pass
    return embedded, "".join(parser.trimmed)


def path_get(value, path):
    if path in ("", ".", "$"):
        return value
    # A backslash escapes dots in object keys, for example dist-tags.latest.
    parts = re.split(r"(?<!\\)\.", path.removeprefix("$."))
    try:
        for part in parts:
            part = part.replace("\\.", ".").replace("\\\\", "\\")
            value = value[int(part)] if isinstance(value, list) else value[part]
        return value
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def normalize(rows, transforms):
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key, transform in transforms.items():
            value = row.get(key)
            if value is None:
                continue
            if isinstance(transform, str):
                transform = {"number": transform == "number"}
            if transform.get("regex"):
                match = re.search(transform["regex"], str(value))
                value = match.group(transform.get("group", 1)) if match else None
            if value is not None and transform.get("number"):
                try:
                    value = float(str(value).replace(",", "").strip())
                    if not math.isfinite(value):
                        value = None
                    elif value.is_integer():
                        value = int(value)
                except ValueError:
                    value = None
            row[key] = value
    return rows


def extract(spec, html):
    if spec["type"] == "embedded_json":
        embedded, _ = page_data(html)
        source = embedded.get(spec["source"])
        data = path_get(source, spec.get("rows", "."))
        if data is None:
            return []
        data = data if isinstance(data, list) else [data]
        rows = [{key: path_get(row, path) for key, path in spec["paths"].items()} for row in data]
    else:
        rows = crawl_helper("css", {"html": html, "schema": spec["schema"]}, 12).get("rows")
    if not isinstance(rows, list):
        raise ReaderError(12, "extraction failed: expected list rows")
    return normalize(rows, spec.get("transforms", {}))


def empty(value):
    return value is None or value == "" or value == [] or value == {} or (isinstance(value, str) and not value.strip())


def failures(spec, rows):
    if not rows:
        return ["list rows >= 1", *spec["required"]]
    example = spec.get("example")
    if isinstance(example, list):
        example = example[0] if example else {}
    example = example or {}
    keys = set(spec["required"]) | set(example or {})
    missing = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            missing.append(f"row[{index}] must be an object")
            continue
        for key in sorted(keys):
            if key not in row or (key in spec["required"] and empty(row[key])):
                missing.append(f"row[{index}].{key}")
            elif row[key] is not None and isinstance(example.get(key), (int, float)) and not isinstance(example[key], bool):
                if isinstance(row[key], bool) or not isinstance(row[key], (int, float)) or not math.isfinite(row[key]):
                    missing.append(f"row[{index}].{key} must be numeric")
        example_keys = sorted(example)
        for offset, key in enumerate(example_keys):
            for other in example_keys[offset + 1:]:
                if (isinstance(row.get(key), str) and len(row[key]) >= 3 and not empty(row[key])
                        and isinstance(row.get(other), str) and len(row[other]) >= 3 and not empty(row[other])
                        and example[key] != example[other]
                        and row[key] == row[other]):
                    missing.append(f"row[{index}].{key} equals {other}; example values differ")
    return missing


def anchor_failures(example, rows):
    if example is None:
        return []
    if isinstance(example, list):
        example = example[0]

    def matches(value, expected):
        if isinstance(value, str) and isinstance(expected, str):
            return " ".join(value.split()) == " ".join(expected.split())
        if (isinstance(value, (int, float)) and not isinstance(value, bool)
                and isinstance(expected, (int, float)) and not isinstance(expected, bool)):
            return value == expected
        return type(value) is type(expected) and value == expected

    nearest, best = {}, -1
    for row in rows:
        if not isinstance(row, dict):
            continue
        score = sum(key in row and matches(row[key], value) for key, value in example.items())
        if score == len(example):
            return []
        if score > best:
            nearest, best = row, score
    return ["example row not found; nearest row: " + json.dumps(nearest, ensure_ascii=False)]


def validate_candidate(candidate, example):
    if example is not None and not (isinstance(example, dict) or
            isinstance(example, list) and example and all(isinstance(row, dict) for row in example)):
        raise ValueError("example must be an object or non-empty list of objects")
    if not isinstance(candidate, dict) or candidate.get("type") not in ("embedded_json", "css"):
        raise ValueError("schema needs type embedded_json or css")
    if candidate["type"] == "embedded_json":
        if not isinstance(candidate.get("source"), str) or not isinstance(candidate.get("paths"), dict) or not candidate["paths"]:
            raise ValueError("embedded_json needs source and non-empty paths")
        if not all(isinstance(p, str) for p in candidate["paths"].values()) or not isinstance(candidate.get("rows", "."), str):
            raise ValueError("paths and rows must be dotted strings")
        keys = list(candidate["paths"])
    else:
        schema = candidate.get("schema")
        if not isinstance(schema, dict) or not schema.get("baseSelector") or not isinstance(schema.get("fields"), list) or not schema["fields"]:
            raise ValueError("css needs schema with baseSelector and fields")
        for field in schema["fields"]:
            if not isinstance(field, dict) or not isinstance(field.get("name"), str) or field.get("type") not in ("text", "attribute", "regex", "html"):
                raise ValueError("CSS fields must use text, attribute, regex, or html")
            if any(key in field for key in ("expression", "function", "default")):
                raise ValueError("CSS fields cannot use computed values or defaults")
        keys = [field["name"] for field in schema["fields"]]
    required = candidate.setdefault("required", keys)
    if not isinstance(required, list) or not required or not all(isinstance(key, str) and key in keys for key in required):
        raise ValueError("required must be a non-empty list of output field names")
    if not isinstance(candidate.get("transforms", {}), dict):
        raise ValueError("transforms must be an object")
    for key, transform in candidate.get("transforms", {}).items():
        if key not in keys:
            raise ValueError(f"transform field {key} is absent from output")
        if isinstance(transform, str):
            if transform != "number":
                raise ValueError("string transform must be number")
            continue
        if not isinstance(transform, dict) or set(transform) - {"regex", "group", "number"}:
            raise ValueError("transform must use regex, group and/or number")
        if "number" in transform and not isinstance(transform["number"], bool):
            raise ValueError("transform number must be boolean")
        if "regex" in transform:
            if not isinstance(transform["regex"], str):
                raise ValueError("transform regex must be a string")
            try:
                pattern = re.compile(transform["regex"])
            except re.error as exc:
                raise ValueError(f"invalid transform regex: {exc}") from exc
            group = transform.get("group", 1)
            if not isinstance(group, int) or isinstance(group, bool) or not 0 <= group <= pattern.groups:
                raise ValueError("transform group must name an existing numeric capture group")
        elif "group" in transform:
            raise ValueError("transform group needs a regex")
    # The compile command supplies extraction rules only, never stored metadata.
    allowed = ("type", "source", "rows", "paths", "schema", "required", "transforms")
    return {key: value for key, value in candidate.items() if key in allowed}


def failing_row_samples(spec, rows, errors, html):
    indices = list(dict.fromkeys(int(match) for error in errors
                   for match in re.findall(r"row\[(\d+)\]", error)))[:3]
    indices = [index for index in indices if index < len(rows)]
    markup = {}
    if indices and spec["type"] == "css":
        try:
            markup = crawl_helper("css", {"html": html, "schema": spec["schema"],
                                  "sample_indices": indices}, 12).get("samples", {})
        except ReaderError:
            pass
    elif indices:
        for match in re.finditer(r"<script\b[^>]*>.*?</script\s*>", html, re.DOTALL | re.IGNORECASE):
            if spec["source"] in page_data(match.group())[0]:
                markup = {str(index): match.group()[:600] for index in indices}
                break
    return [{"index": index, "values": json.dumps(rows[index], ensure_ascii=False)[:600],
             "outer_html": markup.get(str(index), "")[:600]} for index in indices]


