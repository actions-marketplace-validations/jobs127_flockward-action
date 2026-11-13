# Flockward Link Safety Check

A GitHub Action that checks the links in your docs and pull requests against [Flockward](https://flockward.com), a free list of web pages that attack AI agents (hidden prompt injection, data theft, steering), plus public phishing and malware lists.

Why it matters: coding agents read your README, docs and CI results, and they follow links. A link to a page that hides instructions for agents can turn a helpful agent against your project. This action catches those links before they merge.

## Quick start

Add `.github/workflows/link-safety.yml`:

```yaml
name: Link safety
on: [pull_request, push]
permissions:
  contents: read
jobs:
  flockward:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # lets the action see which files a pull request changed
      - uses: jobs127/flockward-action@v1
```

That's it. No account, no key, no dependencies.

## What it does

1. Picks files. On a pull request, only the files it adds or changes. Otherwise, every tracked Markdown, HTML, text, reStructuredText, AsciiDoc, YAML and JSON file.
2. Finds every `http(s)://` link in them, skipping `localhost` and `example.com`.
3. Sends the unique links to Flockward's batch check (50 at a time). Only the link URLs are sent, never your file contents.
4. Marks each flagged line in the pull request with an error (`block`) or warning (`warn`), and writes a table to the job summary.
5. Fails the job if any link is `block` (change this with `fail-on`).

## Inputs

| Input | Default | What it does |
|---|---|---|
| `paths` | (auto) | Space-separated git pathspecs to scan, e.g. `docs/ *.md`. |
| `fail-on` | `block` | `block` fails on blocked links, `warn` fails on blocked or warned links, `never` only reports. |
| `api-key` | none | Optional free Flockward key. Raises the daily limit. Pass it from a secret: `api-key: ${{ secrets.FLOCKWARD_API_KEY }}`. |

## Outputs

`checked` (links checked), `flagged` (block + warn), `blocked` (block only).

## Limits and keys

Without a key, Flockward allows 25 checks a day per runner IP address. If a repo has more links than that, the action checks as many as it can, then shows a warning instead of failing.

For more, get a free key (no sign-up):

```bash
curl -X POST https://flockward.com/v1/keys
```

Save the key as a repository secret named `FLOCKWARD_API_KEY` and add `with: { api-key: ${{ secrets.FLOCKWARD_API_KEY }} }`.

## Verdicts

- `block`: a page Flockward found attacking agents, or a domain on a public phishing or malware list.
- `warn`: a page that looks risky for agents (for example a tarpit or steering content) but is not a confirmed attack.
- `unknown`: nothing known. Most links are this, and that is fine.

## Privacy

The action sends link URLs (and your key, if you set one) to `https://flockward.com/v1/check/batch`. Nothing else leaves the runner. Flockward logs each checked link to measure usage and spot new threats.

## About Flockward

Flockward is free link-safety data for AI agents: "herd immunity for AI agents." Agents can call it directly over HTTP or MCP. See https://flockward.com and https://flockward.com/llms.txt.

## License

MIT

## Also a plugin for coding agents

This repo is also an [Open Plugins](https://open-plugins.com) plugin, for editors such as Cursor:

- `.mcp.json` connects the Flockward MCP server (`https://flockward.com/mcp`, no key needed).
- `skills/flockward/SKILL.md` explains when to check links and how to act on the answers.
- `rules/flockward-link-safety.mdc` asks the agent to check unfamiliar links before opening them.
