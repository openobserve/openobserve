import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("proof", Path(__file__).with_name("run-proof.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.report = {"errors": [], "records": [{"file": "src/example.spec.ts", "project": "jsdom", "pool": "forks", "tests": [
            {"id": str(n), "name": f"case {n}", "mode": "run", "state": "passed"} for n in range(117)
        ]}]}
        self.summary = {"total": {"lines": {"total": 2, "covered": 1}}, "/src/AlertList.vue": {"lines": {"total": 2, "covered": 1}}}
        self.coverage = {"/src/AlertList.vue": {
            "statementMap": {"0": {"start": {"line": 1}, "end": {"line": 1}}, "1": {"start": {"line": 2}, "end": {"line": 2}}},
            "fnMap": {}, "branchMap": {}, "s": {"0": 1, "1": 0}, "f": {}, "b": {}
        }}
        for name in ("baseline", "candidate"):
            (self.output / (name + "-coverage")).mkdir()
            self.write(name + ".json", self.report)
            self.write(name + "-coverage/coverage-summary.json", self.summary)
            self.write(name + "-coverage/coverage-final.json", self.coverage)

    def write(self, path, value):
        (self.output / path).write_text(json.dumps(value))

    def compare(self):
        return proof.compare(self.output, "baseline", "candidate")

    def test_identical_reports_pass(self):
        result = self.compare()
        self.assertTrue(result["equivalent"])
        self.assertTrue(result["allTestsPassedOrSkipped"])

    def test_failed_or_missing_runtime_cannot_verify_matching_reports(self):
        trials = [{"name": name, "test": {"exit": 0}, "merge": {"exit": 0}} for name in ("baseline", "candidate")]
        self.assertTrue(proof.attach_runtime_status(self.compare(), trials)["comparisonVerified"])
        trials[0]["test"]["exit"] = 1
        self.assertFalse(proof.attach_runtime_status(self.compare(), trials)["comparisonVerified"])
        self.assertFalse(proof.attach_runtime_status(self.compare(), trials[1:])["comparisonVerified"])

    def test_missing_coverage_fails(self):
        (self.output / "candidate-coverage/coverage-final.json").unlink()
        self.assertFalse(self.compare()["equivalent"])

    def test_empty_matching_coverage_cannot_pass(self):
        for name in ("baseline", "candidate"):
            self.write(name + "-coverage/coverage-summary.json", {"total": {}})
            self.write(name + "-coverage/coverage-final.json", {})
        self.assertFalse(self.compare()["equivalent"])

    def test_summary_and_map_source_sets_must_agree(self):
        for name in ("baseline", "candidate"):
            self.write(name + "-coverage/coverage-final.json", {"/src/Other.vue": self.coverage["/src/AlertList.vue"]})
        self.assertFalse(self.compare()["equivalent"])

    def test_case_identity_change_fails(self):
        self.report["records"][0]["tests"][1]["name"] = "another case"
        self.write("candidate.json", self.report)
        self.assertFalse(self.compare()["equivalent"])

    def test_empty_matching_case_lists_fail(self):
        self.report["records"][0]["tests"].clear()
        for name in ("baseline", "candidate"):
            self.write(name + ".json", self.report)
        self.assertFalse(self.compare()["equivalent"])

    def test_unhandled_error_fails(self):
        self.report["errors"] = ["unhandled rejection"]
        self.write("candidate.json", self.report)
        self.assertFalse(self.compare()["equivalent"])

    def test_equal_failure_dispositions_are_not_all_green(self):
        self.report["records"][0]["tests"][0]["state"] = "failed"
        for name in ("baseline", "candidate"):
            self.write(name + ".json", self.report)
        self.assertFalse(self.compare()["allTestsPassedOrSkipped"])
        self.assertFalse(self.compare()["comparisonVerified"])

    def test_per_source_change_fails_even_when_total_matches(self):
        self.summary["/src/AlertList.vue"]["lines"]["covered"] = 0
        self.write("candidate-coverage/coverage-summary.json", self.summary)
        result = self.compare()
        self.assertFalse(result["equivalent"])
        self.assertFalse(result["summaryObjectsEqual"])

    def test_equal_counters_cannot_hide_changed_covered_locations(self):
        self.coverage["/src/AlertList.vue"]["s"] = {"0": 0, "1": 1}
        self.write("candidate-coverage/coverage-final.json", self.coverage)
        result = self.compare()
        self.assertTrue(result["summaryObjectsEqual"])
        self.assertFalse(result["coveredLocationsEqual"])
        self.assertFalse(result["equivalent"])

    def test_changed_source_map_fails(self):
        self.coverage["/src/AlertList.vue"]["statementMap"]["0"]["start"]["line"] = 3
        self.write("candidate-coverage/coverage-final.json", self.coverage)
        self.assertFalse(self.compare()["equivalent"])

    def test_repeated_execution_counts_do_not_change_coverage(self):
        self.coverage["/src/AlertList.vue"]["s"]["0"] = 100
        self.write("candidate-coverage/coverage-final.json", self.coverage)
        self.assertTrue(self.compare()["equivalent"])


class TrialValidationTests(unittest.TestCase):
    def setUp(self):
        tests = [{"id": "1", "name": "case", "mode": "run", "state": "passed"},
                 {"id": "2", "name": "existing skip", "mode": "skip", "state": "skipped"}]
        self.sample = {"files": [{"file": "src/a.spec.ts", "project": "jsdom", "pool": "forks", "cases": 2, "caseDigest": proof.case_digest(tests)}]}
        self.runtime = {"node": "v24.22.0", "vitest": "4.1.11", "availableParallelism": 8, "cpuModels": ["CPU"]}
        self.report = {"reason": "passed", "errors": [], "runtime": dict(self.runtime), "options": {"maxWorkers": 7, "pool": "forks", "isolate": True, "watch": False, "projects": [{"name": "jsdom", "maxWorkers": 7, "pool": "forks", "isolate": True, "environment": "jsdom"}]}, "records": [{"file": "src/a.spec.ts", "project": "jsdom", "pool": "forks", "tests": tests}]}
        self.trials = [{"name": name, "workers": workers, "reportVerified": True, "sourceBefore": "hash", "sourceAfter": "hash", "test": {"exit": 0}, "merge": {"exit": 0}} for name, workers in proof.TRIALS]

    def valid(self):
        return proof.validate_report(self.report, self.sample, 7, self.runtime)

    def test_exact_reference_with_existing_skip_passes(self):
        self.assertTrue(self.valid())
        self.assertTrue(proof.verify_trials(self.trials, "hash"))

    def test_omitted_or_reordered_trial_fails(self):
        self.assertFalse(proof.verify_trials(self.trials[:-1], "hash"))
        self.assertFalse(proof.verify_trials(list(reversed(self.trials)), "hash"))

    def test_source_drift_fails(self):
        self.trials[1]["sourceAfter"] = "other"
        self.assertFalse(proof.verify_trials(self.trials, "hash"))

    def test_runtime_drift_fails(self):
        self.report["runtime"]["cpuModels"] = ["different"]
        self.assertFalse(self.valid())

    def test_wrong_runtime_even_on_both_sides_fails(self):
        self.runtime["node"] = self.report["runtime"]["node"] = "v24.22.1"
        self.assertFalse(self.valid())

    def test_worker_mismatch_fails_at_root_and_project(self):
        self.report["options"]["maxWorkers"] = 6
        self.assertFalse(self.valid())
        self.report["options"]["maxWorkers"] = 7
        self.report["options"]["projects"][0]["maxWorkers"] = 6
        self.assertFalse(self.valid())
        self.trials[1]["workers"] = 7
        self.assertFalse(proof.verify_trials(self.trials, "hash"))

    def test_missing_or_duplicate_file_fails(self):
        record = self.report["records"].pop()
        self.assertFalse(self.valid())
        self.report["records"] = [record, record]
        self.assertFalse(self.valid())

    def test_missing_case_or_changed_disposition_fails(self):
        self.report["records"][0]["tests"].pop()
        self.assertFalse(self.valid())

    def test_changed_skip_disposition_fails(self):
        self.report["records"][0]["tests"][1]["mode"] = "run"
        self.report["records"][0]["tests"][1]["state"] = "passed"
        self.assertFalse(self.valid())

    def test_matching_trial_cases_still_require_reference_identity(self):
        self.report["records"][0]["tests"][0]["name"] = "replaced case"
        self.assertFalse(self.valid())

    def test_setup_project_or_isolation_changes_fail(self):
        self.report["options"]["projects"][0]["environment"] = "node"
        self.assertFalse(self.valid())
        self.report["options"]["projects"][0]["environment"] = "jsdom"
        self.report["options"]["isolate"] = False
        self.assertFalse(self.valid())

    def test_failed_merge_or_unverified_report_fails(self):
        self.trials[2]["merge"]["exit"] = 1
        self.assertFalse(proof.verify_trials(self.trials, "hash"))
        self.trials[2]["merge"]["exit"] = 0
        self.trials[2]["reportVerified"] = False
        self.assertFalse(proof.verify_trials(self.trials, "hash"))


class ReporterTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for reporter syntax and lifecycle")
    def test_project_worker_fallback_and_runtime_capture(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "probe").mkdir()
            (root / "node_modules/vitest").mkdir(parents=True)
            (root / "node_modules/vitest/package.json").write_text('{"version":"4.1.11"}')
            (root / "probe/reporter.mjs").write_text('import fs from "node:fs"; import os from "node:os"; import v8 from "node:v8"; const reportedTest=t=>t;\n' + proof.REPORTER)
            harness = root / "check.mjs"
            harness.write_text('''import assert from 'node:assert/strict';
import fs from 'node:fs';
import Measure from './probe/reporter.mjs';
const m = new Measure();
const config = { maxWorkers: 6, pool: 'forks', isolate: true, watch: false };
m.onInit({ config, vite: { config: { cacheDir: '/cache' } }, projects: [{ name: 'jsdom', config: { ...config, maxWorkers: undefined, environment: 'jsdom' }, vite: { config: { cacheDir: '/cache/jsdom' } } }] });
m.onTestRunStart(); m.onTestModuleEnd(); m.onCoverage();
const test = { id: '1', name: 'case', mode: 'run', state: 'passed' };
m.onTestCaseResult({ fullName: 'case', result: () => ({ state: 'passed' }) });
m.onTestRunEnd([{ relativeModuleId: 'src/a.spec.ts', project: { name: 'jsdom' }, toTestSpecification: () => ({ pool: 'forks' }), state: () => 'passed', diagnostic: () => ({}), children: { allTests: () => [test] } }], [], 'passed');
const report = JSON.parse(fs.readFileSync(process.env.BENCH_REPORT));
assert.equal(report.options.projects[0].configuredMaxWorkers, null);
assert.equal(report.options.projects[0].maxWorkers, 6);
assert.equal(report.options.maxWorkers, 6);
assert.equal(report.runtime.vitest, '4.1.11');
assert.ok(report.runtime.heapLimit > 0);
assert.equal(report.records[0].pool, 'forks');
assert.equal(report.records[0].tests[0].id, '1');
assert.ok(report.coverageMs >= report.lastModuleMs);
assert.equal(JSON.parse(fs.readFileSync(process.env.BENCH_REPORT + '.progress.jsonl')).result.state, 'passed');
''')
            subprocess.run([shutil.which("node"), str(harness)], env=os.environ | {"BENCH_REPORT": str(root / "report.json")}, check=True, timeout=10)


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.addCleanup(setattr, proof, "DEADLINE", None)

    def test_expired_deadline_never_launches_command(self):
        proof.DEADLINE = time.monotonic() - 1
        result = proof.run(["this-command-must-not-launch"], self.output, os.environ, self.output / "expired.log", 1)
        self.assertEqual(result["exit"], "deadline")
        self.assertFalse((self.output / "expired.log").exists())
        self.assertTrue((self.output / "expired.launch.json").is_file())

    def test_timeout_reaps_owned_group_and_preserves_unrelated_process(self):
        sentinel = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
        try:
            result = proof.run([sys.executable, "-c", "import time; time.sleep(30)"], self.output, os.environ, self.output / "timeout.log", 0.05)
            self.assertEqual(result["exit"], "timeout")
            self.assertEqual(result["remainingOwnedProcesses"], [])
            self.assertIsNone(sentinel.poll())
        finally:
            sentinel.terminate()
            sentinel.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
