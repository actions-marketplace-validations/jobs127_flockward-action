// Flockward link check: finds links in your repo's docs (or a PR's changed files), checks them with
// Flockward, annotates each flagged line, writes a job summary and fails on "block" by default.
// No dependencies; runs on the Node.js that GitHub runners already have.
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const API = (process.env.FLOCKWARD_API_URL || "https://flockward.com").replace(/\/+$/, "") + "/v1/check/batch";
const EXT = /\.(md|mdx|markdown|rst|txt|html?|adoc|ya?ml|json)$/i;
const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;
const SKIP = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|([a-z0-9-]+\.)*example\.(com|org|net))([:/]|$)/i;
const failOn = (process.env.FW_FAIL_ON || "block").trim().toLowerCase();
if (!["block", "warn", "never"].includes(failOn)) {
  console.log(`::error::fail-on must be block, warn or never (got "${failOn}")`);
  process.exit(2);
}
const git = (...args) => {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
};
const norm = (u) => { try { return new URL(u).toString(); } catch { return null; } };

// 1. Pick files: explicit paths, else a PR's changed files, else every tracked file.
let files = null;
if (process.env.FW_PATHS && process.env.FW_PATHS.trim()) {
  files = git("ls-files", "--", ...process.env.FW_PATHS.trim().split(/\s+/));
} else if (process.env.FW_BASE) {
  files = git("diff", "--name-only", "--diff-filter=AM", `${process.env.FW_BASE}...HEAD`);
  if (files === null) console.log("::notice::Flockward: could not diff against the PR base (use actions/checkout with fetch-depth: 0). Checking all files instead.");
}
if (files === null) files = git("ls-files") || "";
files = files.split("\n").filter((f) => f && EXT.test(f) && existsSync(f)).slice(0, 2000);

// 2. Collect links and where each one appears.
const where = new Map(); // normalized url -> [{file, line}]
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((ln, i) => {
    for (const raw of ln.match(URL_RE) || []) {
      const u = norm(raw.replace(/[.,;:!?*_]+$/, ""));
      if (!u || SKIP.test(u)) continue;
      if (!where.has(u)) where.set(u, []);
      where.get(u).push({ file: f, line: i + 1 });
    }
  });
}
const urls = [...where.keys()];
console.log(`Flockward: ${urls.length} unique links in ${files.length} files.`);

// 3. Check them in batches. If the daily limit is smaller than a batch, shrink the batch.
const headers = { "content-type": "application/json", "user-agent": "flockward-github-action/1" };
if (process.env.FLOCKWARD_API_KEY) headers["x-api-key"] = process.env.FLOCKWARD_API_KEY;
const results = [];
let size = 50, stopped = null;
for (let i = 0; i < urls.length;) {
  const chunk = urls.slice(i, i + size);
  let res, j;
  try {
    res = await fetch(API, { method: "POST", headers, body: JSON.stringify({ urls: chunk }) });
    j = await res.json().catch(() => ({}));
  } catch (e) { stopped = `network error: ${e.message}`; break; }
  if (res.status === 429 && size > 1) {
    size = Math.max(1, Math.min(Math.floor(size / 2), Number(j.limit) || size));
    continue;
  }
  if (!res.ok) { stopped = j.error || `HTTP ${res.status}`; break; }
  results.push(...(j.results || []));
  i += chunk.length;
}
if (stopped) console.log(`::warning::Flockward checked ${results.length} of ${urls.length} links, then stopped (${stopped}). A free api-key raises the daily limit: https://flockward.com/llms.txt`);

// 4. Report.
const flagged = results.filter((r) => r.verdict === "block" || r.verdict === "warn");
const clean = (s) => String(s || "").replace(/[\r\n]+/g, " ");
for (const r of flagged) {
  const level = r.verdict === "block" ? "error" : "warning";
  for (const w of where.get(r.url) || where.get(norm(r.url)) || []) {
    console.log(`::${level} file=${w.file},line=${w.line},title=Flockward: ${r.verdict}::${clean(r.url)}${r.reason ? " - " + clean(r.reason) : ""}${r.category ? " [" + r.category + "]" : ""}`);
  }
}
const nBlock = flagged.filter((r) => r.verdict === "block").length;
const nWarn = flagged.length - nBlock;
const summary = ["## Flockward link check", "", `Checked **${results.length}** of ${urls.length} links: **${nBlock}** block, **${nWarn}** warn.`, ""];
if (flagged.length) {
  summary.push("| Verdict | Link | Where | Why |", "|---|---|---|---|",
    ...flagged.map((r) => {
      const at = (where.get(r.url) || where.get(norm(r.url)) || []).slice(0, 3).map((w) => `${w.file}:${w.line}`).join(", ");
      return `| ${r.verdict} | \`${clean(r.url).replace(/`/g, "")}\` | ${at} | ${clean(r.reason || r.category).replace(/\|/g, "/")} |`;
    }));
}
summary.push("", "Checked by [Flockward](https://flockward.com), free link-safety data for AI agents.");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `checked=${results.length}\nflagged=${flagged.length}\nblocked=${nBlock}\n`);
console.log(summary.join("\n"));
const fail = failOn === "warn" ? flagged.length > 0 : failOn === "block" ? nBlock > 0 : false;
process.exit(fail ? 1 : 0);
