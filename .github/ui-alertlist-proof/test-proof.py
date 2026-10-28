import importlib.util
import json
import os
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
        self.report = {"errors": [], "records": [{"file": proof.TARGET, "tests": [
            {"name": f"case {n}", "mode": "run", "state": "passed"} for n in range(106)
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
        self.assertTrue(result["allTestsPassed"])

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

    def test_wrong_case_count_fails(self):
        self.report["records"][0]["tests"].pop()
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
        self.assertFalse(self.compare()["allTestsPassed"])
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
