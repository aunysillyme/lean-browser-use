# Compile once, run as code

The page reader extracts repeatable fields from public pages. A model writes the extraction spec during compilation. Successful later runs fetch and extract with code, without a model call. Validation can trigger one self-heal when a page changes.

Copy the companion with `npx lean-browser-use --with-reader`. The examples below run from a repository checkout; installed copies live under the chosen config directory's `lean-browser-use/reader/`.

## Prepare the reader

Python 3 runs the reader. Crawl4AI supplies CSS extraction and the browser fetch fallback. The user installs it separately with `pip install crawl4ai` in their chosen Python environment. See the [reader guide](../reader/README.md) for interpreter discovery and offline tests.

Choose a command that reads a prompt on stdin and prints schema JSON on stdout. For example:

```sh
export READER_COMPILE_CMD='claude -p'
reader/reader compile packages --url 'https://www.npmjs.com/package/{name}' \
  --param name=react --want 'Name, version, license, repository URL'
reader/reader run packages --param name=zod
reader/reader ls
```

The compile command is parsed with `shlex` and run without a shell. It can be an agent CLI, an API client script, or a local model command. The reader supplies the prompt on stdin. An unset `READER_COMPILE_CMD` makes compilation or self-heal exit 2 with setup guidance. Running an already compiled valid spec needs neither the variable nor a model.

## Verify and reuse

Give `compile` an observed `--example` row when possible. Verify the resulting values independently before reusing the spec. The bundled [pricing spec](../reader/specs/claude-pricing.json) and [package spec](../reader/specs/npm-package.json) include their provenance; saved fixtures demonstrate extraction, while current public values require a fresh read.

`run` returns `rows` and fetch metadata. `ls` shows available specs and their state. Use `--no-heal` to keep a run to code-only extraction even when validation fails. A successful heal is stored in runtime state, preserving shipped specs. `READER_SPECS_DIR` selects specs and `READER_STATE_DIR` selects state.

Only public HTTP and HTTPS pages are eligible. Private targets and authenticated browsing belong outside this reader. Use the user-selected browser route for logged-in work.

| Exit | Meaning |
| --- | --- |
| 0 | Success. |
| 2 | Usage error, refused target, or missing compile command when needed. |
| 10 | Fetch failed. |
| 11 | Compile failed. |
| 12 | Extraction failed after self-heal or with `--no-heal`. |

Preserve the error and fall through to an eligible route from the [route table](../skills/lean-browser-use/references/route-by-job.md). Avoid repeating an unchanged failed fetch.
