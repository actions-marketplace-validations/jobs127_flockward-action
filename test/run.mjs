// Offline test: runs check-links.mjs against a local mock of the Flockward API. Never calls flockward.com.
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const script = resolve(import.meta.dirname, "../check-links.mjs");
let limit = 1000, used = 0, calls = 0;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    const { urls } = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (used + urls.length > limit) { res.statusCode = 429; return res.end(JSON.stringify({ error: "limit", limit })); }
    used += urls.length;
    res.end(JSON.stringify({ results: urls.map((url) => ({ url,
      verdict: url.includes("evil.test") ? "block" : url.includes("shady.test") ? "warn" : "unknown",
      reason: url.includes("evil.test") ? "hidden prompt injection" : null })) }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const api = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(join(tmpdir(), "fw-"));
const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
const links = Array.from({ length: 60 }, (_, i) => `- https://site${i}.test/page`).join("\n");
writeFileSync(join(dir, "README.md"), `# Hi\nSee https://evil.test/x.\nAlso (https://shady.test/y)\nhttp://localhost:3000 and https://www.example.com\n${links}\n`);
writeFileSync(join(dir, "code.js"), "fetch('https://evil.test/ignored')\n");
g("add", "."); g("commit", "-qm", "init");

async function run(env) {
  const out = join(dir, "out.txt"), summ = join(dir, "summary.md");
  writeFileSync(out, ""); writeFileSync(summ, "");
  return new Promise((r) => {
    const c = spawn("node", [script], { cwd: dir, env: { PATH: process.env.PATH, FLOCKWARD_API_URL: api, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summ, ...env } });
    let stdout = ""; c.stdout.on("data", (d) => (stdout += d));
    c.on("close", (code) => r({ code, stdout, outputs: readFileSync(out, "utf8"), summary: readFileSync(summ, "utf8") }));
  });
}

let r = await run({});
assert.equal(r.code, 1, "fails on block by default");
assert.match(r.stdout, /::error file=README.md,line=2,title=Flockward: block::https:\/\/evil.test\/x - hidden prompt injection/);
assert.match(r.stdout, /::warning file=README.md,line=3/);
assert.doesNotMatch(r.stdout, /localhost|example\.com|ignored/);
assert.match(r.outputs, /checked=62\nflagged=2\nblocked=1/);
assert.match(r.summary, /\| block \| `https:\/\/evil.test\/x` \| README.md:2 \|/);

used = 0; r = await run({ FW_FAIL_ON: "never" }); assert.equal(r.code, 0);
used = 0; r = await run({ FW_PATHS: "nothing/*.md" }); assert.equal(r.code, 0); assert.match(r.outputs, /checked=0/);

// Small daily limit: shrinks batches, checks what it can, warns, never loops forever.
used = 0; limit = 25; calls = 0;
r = await run({ FW_FAIL_ON: "never" });
assert.match(r.outputs, /checked=25\n/);
assert.match(r.stdout, /::warning::Flockward checked 25 of 62 links/);
assert.ok(calls < 15, `bounded retries (${calls} calls)`);

r = await run({ FW_FAIL_ON: "bogus" }); assert.equal(r.code, 2);
server.close();
console.log("all tests passed");
