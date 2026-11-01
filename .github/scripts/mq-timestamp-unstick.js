// Merge queue ignores a passed check whose completed_at predates its own run; re-running that job unsticks it.

const OK_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const SETTLE_MINUTES = 5;
// Skipped jobs legitimately report completedAt a second or two before their run's createdAt.
const SKEW_SECONDS = 120;

const ENTRIES_QUERY = `query($owner:String!,$repo:String!,$branch:String!){
  repository(owner:$owner,name:$repo){ mergeQueue(branch:$branch){ entries(first:100){ nodes{
    state enqueuedAt headCommit{oid} pullRequest{number headRefOid}
  }}}}}`;

const CONTEXTS = `statusCheckRollup{ contexts(first:100){ pageInfo{hasNextPage} nodes{ __typename
  ... on CheckRun{ databaseId name status conclusion startedAt completedAt detailsUrl
    isRequired(pullRequestNumber:$pr)
    checkSuite{ workflowRun{ databaseId createdAt updatedAt } } }
  ... on StatusContext{ context state createdAt isRequired(pullRequestNumber:$pr) } }}}`;

const CHECKS_QUERY = `query($owner:String!,$repo:String!,$mg:GitObjectID!,$head:GitObjectID!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    mg: object(oid:$mg){ ... on Commit{ ${CONTEXTS} } }
    head: object(oid:$head){ ... on Commit{ ${CONTEXTS} } }
  }}`;

const markerFor = (sha) => `<!-- stuck-run-reaper:mq-timestamp:${sha} -->`;
const ms = (s) => (s ? Date.parse(s) : NaN);
const maxMs = (...xs) => Math.max(...xs.filter((x) => !isNaN(x)));

function normalize(rollup) {
  if (!rollup) return { checks: [], truncated: false };
  const { pageInfo, nodes } = rollup.contexts;
  const checks = nodes
    .filter((n) => n.isRequired)
    .map((n) =>
      n.__typename === "CheckRun"
        ? {
            kind: "check",
            name: n.name,
            jobId: n.databaseId,
            url: n.detailsUrl,
            done: n.status === "COMPLETED",
            ok: n.status === "COMPLETED" && OK_CONCLUSIONS.has(n.conclusion),
            result: n.status === "COMPLETED" ? n.conclusion : n.status,
            startedAt: n.startedAt,
            completedAt: n.completedAt,
            runId: n.checkSuite?.workflowRun?.databaseId,
            runCreatedAt: n.checkSuite?.workflowRun?.createdAt,
            runUpdatedAt: n.checkSuite?.workflowRun?.updatedAt,
          }
        : {
            kind: "status",
            name: n.context,
            done: n.state !== "PENDING" && n.state !== "EXPECTED",
            ok: n.state === "SUCCESS",
            result: n.state,
            completedAt: n.createdAt,
          },
    );
  return { checks, truncated: pageInfo.hasNextPage };
}

function evaluateEntry({ entry, mgRollup, headRollup, now }) {
  const skip = (reason) => ({ act: false, reason, offenders: [] });
  if (entry.state !== "AWAITING_CHECKS") return skip(`state ${entry.state}`);
  if (!entry.headCommit) return skip("no merge-group commit yet");

  const mg = normalize(mgRollup);
  const head = normalize(headRollup);
  if (mg.truncated || head.truncated) return skip("more than 100 check contexts; not evaluated");
  if (mg.checks.length === 0) return skip("no required checks reported on the merge-group commit");

  const mgNames = new Set(mg.checks.map((c) => c.name));
  const missing = [...new Set(head.checks.map((c) => c.name))].filter((n) => !mgNames.has(n));
  if (missing.length) return skip(`required check(s) not reported yet: ${missing.join(", ")}`);

  const pending = mg.checks.filter((c) => !c.done);
  if (pending.length) return skip(`still running: ${pending.map((c) => c.name).join(", ")}`);
  const bad = mg.checks.filter((c) => !c.ok);
  if (bad.length) return skip(`not passing: ${bad.map((c) => `${c.name}=${c.result}`).join(", ")}`);

  const enqueued = ms(entry.enqueuedAt);
  const settled = maxMs(
    enqueued,
    ...mg.checks.flatMap((c) => [ms(c.completedAt), ms(c.startedAt), ms(c.runCreatedAt), ms(c.runUpdatedAt)]),
  );
  const settleMs = SETTLE_MINUTES * 60 * 1000;
  if (now - settled < settleMs) {
    return skip(`all required checks passed ${Math.floor((now - settled) / 60000)}m ago; waiting ${SETTLE_MINUTES}m`);
  }

  const skew = SKEW_SECONDS * 1000;
  const offenders = mg.checks.filter((c) => {
    if (c.kind !== "check" || !c.jobId) return false;
    const done = ms(c.completedAt);
    return [ms(c.runCreatedAt), ms(c.startedAt), enqueued].some((t) => !isNaN(t) && done < t - skew);
  });
  if (offenders.length === 0)
    return skip("all required checks passed and no mis-timestamped check found; not this bug");

  // Re-running two jobs of the same run would race on one new attempt, so take one per run.
  const perRun = new Map();
  // A summary job re-runs in seconds and was the proven fix (#16139, #16140, #16120); prefer it.
  const ordered = [...offenders].sort((a, b) => /summary/i.test(b.name) - /summary/i.test(a.name));
  for (const o of ordered) if (!perRun.has(o.runId)) perRun.set(o.runId, o);
  return { act: true, reason: "mis-timestamped required check(s)", offenders: [...perRun.values()] };
}

async function hasMarker(github, owner, repo, pr, marker) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr,
    per_page: 100,
  });
  return comments.some((c) => (c.body || "").includes(marker));
}

async function run({ github, context, core, dryRun, now = Date.now() }) {
  const { owner, repo } = context.repo;
  const rows = [];
  const log = (pr, sha, decision, detail) => {
    core.info(`[mq-unstick${dryRun ? " (dry-run)" : ""}] PR #${pr} ${sha.slice(0, 9)}: ${decision} - ${detail}`);
    rows.push([`#${pr}`, sha.slice(0, 9), decision, detail]);
  };

  const data = await github.graphql(ENTRIES_QUERY, { owner, repo, branch: "main" });
  const entries = data.repository.mergeQueue?.entries.nodes || [];
  core.info(`${entries.length} merge queue entr${entries.length === 1 ? "y" : "ies"}`);

  for (const entry of entries) {
    const pr = entry.pullRequest.number;
    const sha = entry.headCommit?.oid || "";
    if (entry.state !== "AWAITING_CHECKS" || !sha) {
      log(
        pr,
        sha || "-",
        "skip",
        entry.state !== "AWAITING_CHECKS" ? `state ${entry.state}` : "no merge-group commit yet",
      );
      continue;
    }
    const checks = await github.graphql(CHECKS_QUERY, {
      owner,
      repo,
      mg: sha,
      head: entry.pullRequest.headRefOid,
      pr,
    });
    const verdict = evaluateEntry({
      entry,
      mgRollup: checks.repository.mg?.statusCheckRollup,
      headRollup: checks.repository.head?.statusCheckRollup,
      now,
    });
    if (!verdict.act) {
      log(pr, sha, "skip", verdict.reason);
      continue;
    }

    const marker = markerFor(sha);
    if (await hasMarker(github, owner, repo, pr, marker)) {
      log(pr, sha, "skip", "already re-ran once for this merge-group commit");
      continue;
    }

    const rerun = [];
    for (const o of verdict.offenders) {
      const { data: wr } = await github.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}", {
        owner,
        repo,
        run_id: o.runId,
      });
      const what = `${o.name} (job ${o.jobId}, completed ${o.completedAt}, run created ${o.runCreatedAt})`;
      if (wr.run_attempt > 1) {
        log(pr, sha, "skip", `${what}: run already on attempt ${wr.run_attempt}`);
        continue;
      }
      if (dryRun) {
        log(pr, sha, "would re-run", what);
        continue;
      }
      try {
        await github.request("POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun", {
          owner,
          repo,
          job_id: o.jobId,
        });
        rerun.push(o);
        log(pr, sha, "re-ran", what);
      } catch (e) {
        log(pr, sha, "error", `${what}: re-run failed: ${e.message}`);
      }
    }

    if (rerun.length === 0) continue;
    const names = rerun.map((o) => `\`${o.name}\``).join(", ");
    const links = rerun
      .map((o) => `[${o.name}](${o.url || `${context.serverUrl}/${owner}/${repo}/actions/runs/${o.runId}`})`)
      .join(", ");
    const body = [
      marker,
      `Merge queue was stuck: ${names} reported success with a timestamp older than its run, so the queue ignored it. Re-ran ${links} to unstick it.`,
    ].join("\n");
    try {
      await github.rest.issues.createComment({ owner, repo, issue_number: pr, body });
    } catch (e) {
      core.warning(`Could not comment on PR #${pr}: ${e.message}`);
    }
  }

  await core.summary
    .addHeading(`Merge-queue unstick${dryRun ? " (dry-run)" : ""}`, 3)
    .addRaw(
      `Acts only when an AWAITING_CHECKS entry has every required check passed (none missing vs the PR), ` +
        `has sat ${SETTLE_MINUTES}+ min since enqueue and since the latest of each check's completed/started/run-created/run-updated time, ` +
        `and has a required check whose completed_at is over ${SKEW_SECONDS}s before its run's created_at, its started_at, or the enqueue time. ` +
        `Then re-runs that job once per merge-group SHA; it never edits check results.`,
    )
    .addTable([
      [
        { data: "PR", header: true },
        { data: "Merge-group SHA", header: true },
        { data: "Decision", header: true },
        { data: "Why / what", header: true },
      ],
      ...rows,
    ])
    .write();
}

module.exports = { run, evaluateEntry, markerFor, SETTLE_MINUTES, SKEW_SECONDS };
