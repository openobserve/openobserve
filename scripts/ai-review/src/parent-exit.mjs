// The harness holds this engine's stdin pipe: one "go" byte starts the review, and EOF (the harness died by any means) ends the whole group.
// Resolves true on "go", false when no harness asked; on EOF it exits and never resolves (README, "Cost experiments").
export function exitWithParent({ env = process.env, stdin = process.stdin, onGone = () => {}, kill = process.kill, pid = process.pid, exit = process.exit } = {}) {
  if (env.REVIEW_EXIT_WITH_PARENT !== "true") return Promise.resolve(false);
  return new Promise(resolve => {
    // Until "go" the pipe is what keeps the engine alive; afterwards it must not keep a finished engine running.
    stdin.once("data", () => { stdin.unref?.(); resolve(true); });
    stdin.once("end", () => {
      try {
        onGone();
      } catch {
        // Ending the group matters more than any cleanup that fails.
      }
      try {
        kill(-pid, "SIGKILL");
      } catch {
        // Not a group leader (the harness always makes it one): fall through to a plain exit.
      }
      exit(1);
    });
    stdin.resume();
  });
}
