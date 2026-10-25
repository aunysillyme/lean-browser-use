# Compile-once page reader

The reader turns a public page into an extraction spec. Later reads run the spec as code. Embedded JSON extraction uses the Python standard library. CSS extraction and browser fetching use Crawl4AI, which you install yourself:

```sh
python3 -m pip install crawl4ai
```

Use Python 3. The installer copies these files only when you pass `--with-reader`.

## Compile, run, list

Choose a command that reads a prompt from stdin and prints extraction JSON on stdout. For example:

```sh
export READER_COMPILE_CMD='claude -p'
reader/reader compile package --url 'https://www.npmjs.com/package/{name}' --param name=react --want 'name, version, license'
reader/reader run npm-package --param name=react
reader/reader ls
```

`READER_COMPILE_CMD` is split with `shlex` and executed directly. Shell expansion and shell pipelines are not used. A command may be another agent CLI, a script calling an API, or a local model. Compile and self-heal require this variable; a valid compiled spec runs without it. Add `--example` with a JSON object to anchor the compile to an observed row. Page text is untrusted data.

A failed extraction gets one self-heal. `--no-heal` reports the extraction failure directly. Fetches accept public HTTP and HTTPS destinations, check redirects and browser requests, and refuse private addresses. Use the browser runner for pages that need your login.

## Files and state

Bundled specs are in `specs/`. `READER_SPECS_DIR` selects a different spec directory. Successful reads and healed overrides live under `~/.cache/lean-browser-use/reader`, or `READER_STATE_DIR`. Runs preserve the bundled spec files. `READER_CRAWL4AI_PYTHON` selects the Python executable with Crawl4AI installed.

To add a spec, compile a known public URL with the fields you need and an observed example. Verify the JSON result against the page. Keep a public fixture and an offline regression check beside the spec. The bundled pricing fixture is a captured test page, not current pricing guidance.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed |
| 2 | Usage, unset compile command, or refused target |
| 10 | Fetch failed |
| 11 | Compile failed |
| 12 | Extraction failed after the allowed heal |

## Offline checks

```sh
python3 -m unittest discover -s reader -p 'test_*.py'
```

The suite uses the standard library. Crawl4AI and local socket integration checks skip with a reason when their capability is unavailable. Mocked subprocess contracts and embedded JSON extraction still run.
