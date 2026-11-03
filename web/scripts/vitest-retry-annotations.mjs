import path from "node:path";

// Turns every test that passed only on a CI retry into a GitHub warning, so the retry never hides a flake.
export default class RetryAnnotations {
  onTestCaseResult(testCase) {
    const diagnostic = testCase.diagnostic();
    if (!diagnostic?.flaky) return;
    const file = path.join("web", path.relative(process.cwd(), testCase.module.moduleId));
    const message = `${testCase.fullName} passed after ${diagnostic.retryCount} retry`
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    console.log(`::warning file=${file},title=Flaky unit test::${message}`);
  }
}
