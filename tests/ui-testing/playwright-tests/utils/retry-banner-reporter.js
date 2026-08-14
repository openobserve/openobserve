/**
 * Retry Banner Reporter
 * ---------------------
 * In CI the reporter is `blob`, which writes nothing to stdout — so when Playwright
 * retries a failed test (retries: 3 in playwright.config.js) there is no signal in the
 * GitHub Actions logs that a retry is even happening. This reporter fixes that: it prints
 * a LOUD, unmissable banner to stdout the moment any test starts a retry attempt, and a
 * short roll-up at the end listing every test that had to be retried.
 *
 * It only logs — it never sends anything or fails the run, so it is safe to run alongside
 * the blob/html/json reporters.
 *
 * Playwright reporter API: https://playwright.dev/docs/api/class-reporter
 */
class RetryBannerReporter {
  constructor() {
    // Map<string, number> — testId -> highest retry attempt observed (for the end summary).
    this.retried = new Map();
    // Parallel map of testId -> { title, file } for the summary print.
    this.meta = new Map();
  }

  /**
   * Fires when each test attempt begins. `result.retry` is 0 for the first attempt and
   * increments for every retry, so `> 0` means "this is a retry".
   */
  onTestBegin(test, result) {
    if (!result || result.retry <= 0) return;

    const retryNum = result.retry;
    const maxRetries = test.retries || 0;         // configured retries for this test
    const attempt = retryNum + 1;                 // human-friendly attempt number
    const totalAttempts = maxRetries + 1;
    const title = test.titlePath().filter(Boolean).join(' › ') || test.title;
    const file = this._shortFile(test.location && test.location.file);

    this.retried.set(test.id, retryNum);
    this.meta.set(test.id, { title, file });

    // A fat, high-contrast banner. Emojis + repeated chars make it trivial to spot when
    // eyeballing or Ctrl+F-ing ("RETRY") a long CI log.
    const bar = '🔁🔁🔁' + '═'.repeat(58) + '🔁🔁🔁';
    const lines = [
      '',
      bar,
      `🔁  R E T R Y   # ${retryNum}   ·   attempt ${attempt} of ${totalAttempts}  (test previously failed — re-running)`,
      `🔁  ▶ ${title}`,
      `🔁  ▶ ${file}`,
      bar,
      '',
    ];
    // Single write so the banner never interleaves with parallel-worker output.
    process.stdout.write(lines.join('\n') + '\n');
  }

  onEnd() {
    if (this.retried.size === 0) return;

    const bar = '🔁🔁🔁' + '═'.repeat(58) + '🔁🔁🔁';
    const out = ['', bar, `🔁  RETRY SUMMARY — ${this.retried.size} test(s) were retried in this shard:`];
    for (const [id, retries] of this.retried) {
      const m = this.meta.get(id) || {};
      out.push(`🔁    • [${retries} retr${retries === 1 ? 'y' : 'ies'}] ${m.title || id}  (${m.file || 'unknown'})`);
    }
    out.push(bar, '');
    process.stdout.write(out.join('\n') + '\n');
  }

  _shortFile(file) {
    if (!file) return 'unknown';
    // Keep the last two path segments (folder/file.spec.js) — enough to locate the test.
    const parts = file.split(/[\\/]/);
    return parts.slice(-2).join('/');
  }

  // Quieter than the default reporter about everything else.
  printsToStdio() {
    return false;
  }
}

module.exports = RetryBannerReporter;
