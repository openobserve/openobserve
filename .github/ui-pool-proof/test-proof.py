import copy
import json
import os
import sys
import tempfile
import time
from unittest.mock import patch
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("proof", Path(__file__).with_name("run-proof.py"))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

class PerformanceGuards(unittest.TestCase):
    def trials(self, wall=80, cpu=90, rss=90):
        return [{"name": name, "run": {"wallSeconds": 100 if i in (0, 3) else wall, "processGroupPeakRssKiB": 100 if i in (0, 3) else rss},
                 "resources": {"cpuSeconds": 100 if i in (0, 3) else cpu,
                               "maxRssKiB": 100 if i in (0, 3) else rss}}
                for i, (name, _) in enumerate(proof.TRIALS)]

    def test_under_fifteen_percent_is_not_accepted(self):
        self.assertFalse(proof.performance_eligible(self.trials(wall=86), True))

    def test_memory_regression_is_not_accepted(self):
        self.assertFalse(proof.performance_eligible(self.trials(rss=101), True))

    def test_both_directions_complete_and_correct_required(self):
        self.assertTrue(proof.performance_eligible(self.trials(), True))
        self.assertFalse(proof.performance_eligible(self.trials()[:3], True))
        self.assertFalse(proof.performance_eligible(self.trials(), False))
        trials = self.trials()
        trials[2]["resources"]["cpuSeconds"] = 101
        self.assertFalse(proof.performance_eligible(trials, True))


class CoverageGuards(unittest.TestCase):
    def test_exact_parity_and_changed_positive_count(self):
        a = {"file": {"statementMap": {"0": {}}, "fnMap": {}, "branchMap": {}, "s": {"0": 1}, "f": {}, "b": {}}}
        summary = {"file": {k: {"total": 1} for k in ("lines", "statements", "functions", "branches")}}
        for mutation in ("unchanged", "positive", "negative", "zero", "map", "scope", "denominator"):
            with self.subTest(mutation=mutation):
                b, sb = copy.deepcopy(a), copy.deepcopy(summary)
                if mutation == "positive": b["file"]["s"]["0"] = 2
                if mutation == "negative": b["file"]["s"]["0"] = -1
                if mutation == "zero": b["file"]["s"]["0"] = 0
                if mutation == "map": b["file"]["statementMap"]["0"] = {"changed": True}
                if mutation == "scope": b = {}
                if mutation == "denominator": sb["file"]["lines"]["total"] = 2
                result = proof.coverage_difference(a, b, summary, sb)
                self.assertEqual(result["accepted"], mutation in ("unchanged", "positive"))
                if mutation == "positive": self.assertTrue(result["counterDifferences"])


class OptionGuards(unittest.TestCase):
    def setUp(self):
        self.options = {"cacheDir": "/a", "pool": "forks", "projects": [{"name": "node", "pool": "forks", "cacheDir": "/a/node", "isolate": True}], "coverage": {"reportsDirectory": "/a/coverage", "exclude": ["src/test/**", "**/*.spec.ts"], "include": ["src/**"]}}

    def test_only_intended_pool_paths_and_positive_exclusion_order_ignored(self):
        other = copy.deepcopy(self.options)
        other.update(pool="threads", cacheDir="/b")
        other["projects"][0].update(pool="threads", cacheDir="/b/node")
        other["coverage"].update(reportsDirectory="/b/coverage", exclude=list(reversed(other["coverage"]["exclude"])))
        before = copy.deepcopy(other)
        self.assertEqual(proof.comparable_options(self.options), proof.comparable_options(other))
        self.assertEqual(other, before)
        other["projects"][0]["isolate"] = False
        self.assertNotEqual(proof.comparable_options(self.options), proof.comparable_options(other))
        other = copy.deepcopy(self.options)
        other["coverage"]["exclude"].append("**/*.spec.ts")
        self.assertNotEqual(proof.comparable_options(self.options), proof.comparable_options(other))

    def test_negative_or_invalid_exclusions_rejected(self):
        for value in (["!src/**"], [None], [""], ["src/\x00"], "src/**"):
            with self.subTest(value=value):
                self.options["coverage"]["exclude"] = value
                with self.assertRaises(ValueError): proof.comparable_options(self.options)


class InventoryGuards(unittest.TestCase):
    def setUp(self):
        self.sample = json.loads(Path(__file__).with_name("sample.json").read_text())
        self.runtime = {"node": "v24.22.0", "vitest": "4.1.11", "platform": "linux", "availableParallelism": 8, "cpuCount": 8, "nodeOptions": None}
        self.cache = Path("/trial/cache")
        self.report = {"reason": "passed", "errors": [], "runtime": self.runtime.copy(), "records": [{"file": r["file"], "project": r["project"], "pool": "forks", "state": "passed", "tests": [{"name": r["file"] + " > behavior", "mode": "run", "state": "passed"}]} for r in self.sample["files"]], "options": {"rootEnvironment": "jsdom", "maxWorkers": 7, "pool": "forks", "isolate": True, "watch": False, "shuffle": False, "cacheDir": str(self.cache), "coverage": {"include": ["src/**/*.{js,ts,vue}"], "reporters": [["json", {}], ["json-summary", {}]], "provider": "v8", "thresholds": None}, "projects": [{"name": name, "environment": name, "maxWorkers": 7, "pool": "forks", "isolate": True, "cacheDir": str(self.cache / name), "setupFiles": [setup]} for name, setup in (("node", "setupNodeTests.ts"), ("jsdom", "setupTests.ts"))]}}
        self.expected = proof.canonical_cases(self.report)

    def valid(self):
        return proof.validate_report(self.report, self.sample, self.runtime, self.cache, "forks", self.expected)

    def test_same_inventory_and_runtime(self):
        self.assertTrue(self.valid())

    def test_changes_in_cases_project_pool_runtime_cache_and_error_rejected(self):
        for mutation in ("case", "skip", "project", "pool", "workers", "runtime", "cache", "errors"):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == "case": self.report["records"][0]["tests"].pop()
                if mutation == "skip": self.report["records"][0]["tests"][0]["state"] = "skipped"
                if mutation == "project": self.report["records"][0]["project"] = "wrong"
                if mutation == "pool": self.report["records"][0]["pool"] = "threads"
                if mutation == "workers": self.report["options"]["maxWorkers"] = 6
                if mutation == "runtime": self.report["runtime"]["vitest"] = "wrong"
                if mutation == "cache": self.report["options"]["projects"][0]["cacheDir"] = "/shared"
                if mutation == "errors": self.report["errors"] = ["failure"]
                self.assertFalse(self.valid())


class ProcessGuards(unittest.TestCase):
    def tearDown(self):
        proof.process.DEADLINE = None

    def test_timeout_reaps_child_and_grandchild(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            script = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); time.sleep(30)"
            result = proof.process.run([sys.executable, "-c", script], root, os.environ.copy(), root / "run.log", 0.2)
            self.assertEqual(result["exit"], "timeout")
            self.assertEqual(result["remainingOwnedProcesses"], [])
            self.assertGreater(result["processGroupPeakRssKiB"], 0)
            self.assertEqual(result["memorySamplingErrors"], [])
            self.assertLess(result["wallSeconds"], 7)

    def test_expired_budget_launches_nothing(self):
        proof.process.DEADLINE = time.monotonic() - 1
        with tempfile.TemporaryDirectory() as d:
            result = proof.process.run(["does-not-exist"], Path(d), {}, Path(d) / "run.log", 150)
            self.assertEqual(result["exit"], "deadline")

    def test_failure_writes_evidence_without_accepting_incomplete_abba(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with patch.object(sys, "argv", ["proof", "--web", str(root), "--output", str(root / "out")]), patch.object(proof, "web_matches", side_effect=RuntimeError("source mismatch")):
                self.assertEqual(proof.main(), 1)
            result = json.loads((root / "out/result.json").read_text())
            self.assertFalse(result["complete"])
            self.assertFalse(result["screenAccepted"])
            self.assertIn("source mismatch", result["error"])
            self.assertFalse(result["sourceUnchangedAndWebClean"])

if __name__ == "__main__":
    unittest.main()
