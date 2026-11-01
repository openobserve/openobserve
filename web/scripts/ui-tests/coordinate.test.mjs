import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { coordinate } from "./coordinate.mjs";

const options = {
  repository: "owner/repo",
  runId: 12,
  attempt: 2,
  count: 2,
  token: "fixture-token",
  timeoutMs: 100,
  pollMs: 10,
  artifactGraceMs: 20,
};
const job = (index, status = "completed", conclusion = "success") => ({
  name: `UI unit shard ${index}`,
  run_id: 12,
  status,
  conclusion,
});
const artifact = (index, count = 2) => ({
  id: 500 + index,
  name: `ui-unit-shard-${index}-${count}`,
  expired: false,
});

function scenario(change = () => undefined) {
  let elapsed = 0;
  let cycle = 0;
  const calls = [];
  return {
    calls,
    now: () => elapsed,
    sleep: async (ms) => {
      elapsed += ms;
    },
    log: () => {},
    fetch: async (input) => {
      const url = new URL(input);
      calls.push(url.pathname + url.search);
      let body;
      if (url.pathname.endsWith("/runs/12")) {
        cycle++;
        body = { id: 12, run_attempt: 2, status: "in_progress", conclusion: null };
      } else if (url.pathname.endsWith("/jobs")) {
        body = { jobs: [job(1), job(2, "in_progress", null)] };
      } else body = { artifacts: [artifact(1), artifact(2)] };
      const response = change({ url, body, cycle });
      return response || { ok: true, json: async () => body };
    },
  };
}

test("waits for terminal producer success even when its upload already exists", async () => {
  const api = scenario(({ url, body, cycle }) => {
    if (url.pathname.endsWith("/jobs") && cycle === 1) body.jobs[0] = job(1, "in_progress", null);
  });
  assert.deepEqual(await coordinate(options, api), [501, 502]);
  assert.equal(api.calls.filter((path) => path.includes("/artifacts")).length, 1);
  assert.equal(api.calls.filter((path) => path.endsWith("/runs/12")).length, 2);
});

test("paginates jobs and artifacts and reuses earlier successful attempts", async () => {
  const api = scenario(({ url, body }) => {
    if (url.pathname.includes("/attempts/2/jobs")) {
      body.jobs =
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 100 }, (_, index) => ({ name: `unrelated ${index}` }))
          : [job(2, "in_progress", null)];
    } else if (url.pathname.includes("/attempts/1/jobs")) body.jobs = [job(1)];
    else if (url.pathname.endsWith("/artifacts")) {
      body.artifacts =
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 100 }, (_, index) => ({ name: `other ${index}` }))
          : [artifact(1), artifact(2)];
    }
  });
  assert.deepEqual(await coordinate(options, api), [501, 502]);
  assert.ok(api.calls.some((path) => path.includes("/attempts/1/jobs")));
  assert.equal(api.calls.filter((path) => path.endsWith("page=2")).length, 2);
});

for (const conclusion of ["failure", "cancelled", "timed_out", "skipped", "neutral"]) {
  test(`rejects a ${conclusion} producer despite an earlier successful artifact`, async () => {
    const api = scenario(({ url, body }) => {
      if (url.pathname.endsWith("/jobs")) body.jobs[0] = job(1, "completed", conclusion);
    });
    await assert.rejects(coordinate(options, api), new RegExp(`ended with ${conclusion}`));
    assert.ok(!api.calls.some((path) => path.includes("/artifacts")));
  });
}

test("never substitutes an older success for an active replacement", async () => {
  const api = scenario(({ url, body }) => {
    if (url.pathname.includes("/attempts/2/jobs")) body.jobs[0] = job(1, "queued", null);
  });
  await assert.rejects(coordinate(options, api), /Timed out.*UI unit shard 1/);
  assert.ok(!api.calls.some((path) => path.includes("/attempts/1/jobs")));
});

test("refreshes an earlier attempt while its producer is still running", async () => {
  const api = scenario(({ url, body, cycle }) => {
    if (url.pathname.includes("/attempts/2/jobs")) body.jobs = [job(2, "in_progress", null)];
    if (url.pathname.includes("/attempts/1/jobs")) {
      body.jobs = [cycle === 1 ? job(1, "in_progress", null) : job(1)];
    }
  });
  assert.deepEqual(await coordinate(options, api), [501, 502]);
  assert.equal(api.calls.filter((path) => path.includes("/attempts/1/jobs")).length, 2);
});

for (const [name, mutate, message] of [
  [
    "missing",
    (body) => {
      body.artifacts.pop();
    },
    /missing artifacts.*rerun all jobs/,
  ],
  [
    "expired",
    (body) => {
      body.artifacts[0].expired = true;
    },
    /Expired artifact.*rerun all jobs/,
  ],
  [
    "duplicate",
    (body) => {
      body.artifacts.push(artifact(1));
    },
    /Duplicate artifact/,
  ],
]) {
  test(`rejects ${name} artifacts`, async () => {
    const api = scenario(({ url, body }) => {
      if (url.pathname.endsWith("/artifacts")) mutate(body);
    });
    await assert.rejects(coordinate(options, api), message);
  });
}

test("rejects workflow cancellation, changed attempts and API failures", async () => {
  for (const [change, message] of [
    [
      ({ url, body }) => {
        if (url.pathname.endsWith("/runs/12")) body.conclusion = "cancelled";
      },
      /Workflow ended/,
    ],
    [
      ({ url, body }) => {
        if (url.pathname.endsWith("/runs/12")) body.run_attempt = 3;
      },
      /attempt changed/,
    ],
    [() => ({ ok: false, status: 503 }), /GitHub API failed: HTTP 503/],
    [() => ({ ok: false, status: 403 }), /GitHub API failed: HTTP 403/],
  ])
    await assert.rejects(coordinate(options, scenario(change)), message);
});

test("bounds polling and refuses absent current coordinator identity", async () => {
  await assert.rejects(coordinate({ ...options, timeoutMs: 540001 }), /exceeds/);
  const api = scenario(({ url, body }) => {
    if (url.pathname.includes("/attempts/2/jobs")) body.jobs = [job(1)];
    if (url.pathname.includes("/attempts/1/jobs")) body.jobs = [job(2)];
  });
  await assert.rejects(coordinate(options, api), /Timed out.*UI unit shard 2/);
});

for (const outcome of ["success", "failure", "api-error", "timeout"]) {
  test(
    `actual coordinator CLI handles ${outcome} without leaking credentials`,
    { timeout: 10000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "ui-coordinate-"));
      const output = join(directory, "output");
      const server = createServer((request, response) => {
        assert.equal(request.headers.authorization, "Bearer fixture-token");
        if (outcome === "api-error") {
          response.writeHead(503).end();
          return;
        }
        let body;
        if (request.url.includes("/jobs")) {
          body = { jobs: [job(1), job(2), job(3), job(4, "in_progress", null)] };
          if (outcome === "failure") body.jobs[0].conclusion = "failure";
          if (outcome === "timeout") body.jobs[0] = job(1, "in_progress", null);
        } else if (request.url.includes("/artifacts")) {
          body = { artifacts: [1, 2, 3, 4].map((index) => artifact(index, 4)) };
        } else body = { id: 12, run_attempt: 2, status: "in_progress", conclusion: null };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(body));
      });
      try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const result = await promisify(execFile)(
          process.execPath,
          [join(dirname(fileURLToPath(import.meta.url)), "coordinate.mjs")],
          {
            env: {
              ...process.env,
              GITHUB_REPOSITORY: "owner/repo",
              GITHUB_RUN_ID: "12",
              GITHUB_RUN_ATTEMPT: "2",
              GITHUB_TOKEN: "fixture-token",
              GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
              GITHUB_OUTPUT: output,
              UI_TEST_WAIT_TIMEOUT_MS: outcome === "timeout" ? "100" : "3000",
              UI_TEST_POLL_INTERVAL_MS: "5",
            },
            timeout: 5000,
          },
        ).then(
          (value) => ({ ...value, code: 0 }),
          (error) => error,
        );
        assert.ok(!(String(result.stdout) + String(result.stderr)).includes("fixture-token"));
        if (outcome === "success") {
          assert.equal(result.code, 0, result.stderr);
          assert.equal(readFileSync(output, "utf8"), "artifact_ids=501,502,503,504\n");
        } else {
          assert.notEqual(result.code, 0);
          assert.equal(existsSync(output), false);
          assert.match(
            result.stderr,
            outcome === "failure"
              ? /ended with failure/
              : outcome === "api-error"
                ? /HTTP 503/
                : /Timed out|TimeoutError/,
          );
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}
