import { execFileSync } from "node:child_process";

import { STATUS_CONTEXT } from "./verdict.mjs";

// Arguments go to gh as an argv array and bodies over stdin, so comment text never reaches a shell.
export function ghApi(path, { method = "GET", body, token, paginate = false } = {}) {
  const args = ["api", path, "--method", method];
  if (paginate) args.push("--paginate", "--slurp");
  if (body !== undefined) args.push("--input", "-");
  const out = execFileSync("gh", args, {
    encoding: "utf-8",
    input: body === undefined ? undefined : JSON.stringify(body),
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, ...(token ? { GH_TOKEN: token } : {}), NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
  }).trim();
  return out ? JSON.parse(out) : null;
}

export function currentGateStatus(repo, sha) {
  const combined = ghApi(`repos/${repo}/commits/${sha}/status?per_page=100`);
  return (combined?.statuses || []).find(s => s.context === STATUS_CONTEXT) ?? null;
}

export function postGateStatus(repo, sha, { state, description, targetUrl }) {
  const body = { state, context: STATUS_CONTEXT, description };
  if (targetUrl) body.target_url = targetUrl;
  return ghApi(`repos/${repo}/statuses/${sha}`, { method: "POST", body });
}
