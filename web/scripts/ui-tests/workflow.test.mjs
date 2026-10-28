import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "js-yaml";

const workflow = load(
  readFileSync(new URL("../../../.github/workflows/unit-tests.yml", import.meta.url), "utf8"),
);
const gate = workflow.jobs.ui_unit_tests;
const source = gate.steps.find((step) => step.name === "Verify merged artifact freshness").with
  .script;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const verify = new AsyncFunction("github", "context", "core", "process", source);

function fixture() {
  const job = (index) => ({
    name: `UI unit shard ${index}`,
    run_id: 12,
    head_sha: "pr-head",
    status: "completed",
    conclusion: "success",
  });
  const coordinator = {
    ...job(4),
    steps: [
      { name: "Merge UI coverage [501,502,503,504]", status: "completed", conclusion: "success" },
    ],
  };
  const jobs = new Map([
    [1, [job(1), job(2), job(3)]],
    [2, [coordinator]],
  ]);
  const artifacts = [1, 2, 3, 4].map((index) => ({
    id: 500 + index,
    name: `ui-unit-shard-${index}-4`,
    expired: false,
  }));
  const run = { id: 12, run_attempt: 2, head_sha: "pr-head", conclusion: null };
  const env = { UI_TEST_SHARD_COUNT: "4", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: "tested-merge-sha" };
  const calls = [];
  const github = {
    rest: {
      actions: {
        getWorkflowRun: async () => ({ data: run }),
        listJobsForWorkflowRunAttempt: "jobs",
        listWorkflowRunArtifacts: "artifacts",
      },
    },
    paginate: async (method, params) => {
      calls.push({ method, params });
      assert.equal(params.run_id, 12);
      assert.equal(params.per_page, 100);
      return method === "jobs" ? jobs.get(params.attempt_number) || [] : artifacts;
    },
  };
  return {
    job,
    jobs,
    coordinator,
    artifacts,
    run,
    env,
    calls,
    github,
    verify: () =>
      verify(github, { repo: { owner: "owner", repo: "repo" }, runId: 12 }, { info() {} }, { env }),
  };
}

test("workflow preserves triggers, four partitions and required rerun dependencies", () => {
  assert.equal(
    JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8")).shards,
    4,
  );
  assert.deepEqual(gate.needs, ["check_changes", "ui_unit_test_shards"]);
  assert.ok(workflow.jobs.unit_tests_summary.needs.includes("ui_unit_tests"));
  assert.equal(gate["runs-on"], "ubuntu-latest");
  assert.deepEqual(gate.permissions, { actions: "read" });
  assert.equal(
    gate.steps.some((step) => String(step.uses).includes("checkout")),
    false,
  );
  assert.equal(workflow.jobs.ui_unit_test_shards.strategy["fail-fast"], false);
  assert.deepEqual(workflow.jobs.ui_unit_test_shards["runs-on"], { labels: "ubicloud-standard-8" });
  const steps = workflow.jobs.ui_unit_test_shards.steps;
  assert.equal(steps.find((step) => step.id === "ui_artifacts")["timeout-minutes"], 10);
  assert.equal(
    steps.find((step) => step.name?.startsWith("Merge UI coverage")).run,
    "./coverage.sh merge",
  );
  assert.equal(
    steps.find((step) => step.name === "Download shard coverage").with["artifact-ids"],
    "${{ steps.ui_artifacts.outputs.artifact_ids }}",
  );
  assert.ok(workflow.on.pull_request.types.includes("labeled"));
  assert.ok(workflow.jobs.check_changes.if.includes("ready-for-ci"));
  assert.ok(workflow.jobs.check_changes.if.includes("draft == false"));
});

test("actual gate accepts same-run earlier artifacts and distinct PR head versus tested merge SHA", async () => {
  const data = fixture();
  await data.verify();
  assert.equal(data.calls.filter((call) => call.method === "jobs").length, 2);
});

test("actual gate fails a successful shard rerun with stale coverage and accepts coordinator recovery", async () => {
  const data = fixture();
  data.run.run_attempt = 3;
  data.env.GITHUB_RUN_ATTEMPT = "3";
  data.jobs.set(3, [data.job(1)]);
  data.artifacts[0].id = 701;
  await assert.rejects(data.verify(), /changed after coverage merge/);
  data.run.run_attempt = 4;
  data.env.GITHUB_RUN_ATTEMPT = "4";
  data.artifacts[3].id = 704;
  data.jobs.set(4, [
    {
      ...data.coordinator,
      steps: [
        {
          name: "Merge UI coverage [701,502,503,704]",
          status: "completed",
          conclusion: "success",
        },
      ],
    },
  ]);
  await data.verify();
});

test("actual gate refuses newer failed or running replacements despite an older successful merge", async () => {
  for (const [status, conclusion] of [
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["in_progress", null],
  ]) {
    const data = fixture();
    data.run.run_attempt = 3;
    data.env.GITHUB_RUN_ATTEMPT = "3";
    data.jobs.set(3, [{ ...data.job(1), status, conclusion }]);
    await assert.rejects(data.verify(), /has not succeeded/);
  }
});

test("actual gate rejects replaced, missing, expired and duplicate artifacts", async () => {
  for (const change of [
    (data) => {
      data.artifacts[0].id = 900;
    },
    (data) => {
      data.artifacts.pop();
    },
    (data) => {
      data.artifacts[0].expired = true;
    },
    (data) => {
      data.artifacts.push(data.artifacts[0]);
    },
  ]) {
    const data = fixture();
    change(data);
    await assert.rejects(data.verify(), /changed after coverage merge|rerun all jobs/);
  }
});

test("actual gate requires a unique completed successful merge receipt", async () => {
  for (const steps of [
    [],
    [{ name: "Merge UI coverage [501,502,503,504]", status: "completed", conclusion: "failure" }],
  ]) {
    const data = fixture();
    data.coordinator.steps = steps;
    await assert.rejects(data.verify(), /No successful complete coverage merge/);
  }
});

test("actual gate fails closed on API errors and changed workflow attempts", async () => {
  const data = fixture();
  data.run.run_attempt = 3;
  await assert.rejects(data.verify(), /Workflow run changed/);
  data.run.run_attempt = 2;
  data.github.paginate = async () => {
    throw new Error("HTTP 429");
  };
  await assert.rejects(data.verify(), /HTTP 429/);
});
