#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

import process

SOURCE = "e6d910ca91cb50a90724c41235ac6ec6bdd9d8fd"
WEB_TREE = "f8c602b5c7cc9da35f01592badd7354b3e215311"
SAMPLE_DIGEST = "7ba8e03de09c993e64cf300ebf745817c87820fcc4f97be714181f5bd12d753c"
TRIALS = (("original-first", "forks"), ("candidate-first", "threads"),
          ("candidate-second", "threads"), ("original-last", "forks"))


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def capture(command, cwd):
    return subprocess.check_output(command, cwd=cwd, timeout=15)


def canonical_cases(report):
    rows = [dict(file=r["file"], project=r["project"], **t) for r in report["records"] for t in r["tests"]]
    return sorted(rows, key=lambda t: tuple(t[k] for k in ("file", "project", "name", "mode", "state")))


def comparable_options(raw):
    options = json.loads(json.dumps(raw))
    patterns = options["coverage"]["exclude"]
    if not isinstance(patterns, list) or not all(
        isinstance(pattern, str) and pattern and not pattern.startswith("!") and "\x00" not in pattern
        for pattern in patterns
    ):
        raise ValueError("Coverage exclusions must be nonempty positive pattern strings")
    options["coverage"]["exclude"] = sorted(patterns)
    options.pop("cacheDir")
    options.pop("pool")
    options["coverage"].pop("reportsDirectory")
    for project in options["projects"]:
        project.pop("cacheDir")
        project.pop("pool")
    return options


def validate_report(report, sample, runtime, cache, pool, expected_cases=None):
    records, options = report["records"], report["options"]
    projects = options["projects"]
    expected = sorted((f["file"], f["project"]) for f in sample["files"])
    cases = canonical_cases(report)
    return (report["reason"] == "passed" and not report["errors"]
            and sorted((r["file"], r["project"]) for r in records) == expected
            and all(r["state"] == "passed" and r["pool"] == pool and r["tests"] for r in records)
            and all(t["state"] in ("passed", "skipped") and t["mode"] in ("run", "skip", "todo") for t in cases)
            and (expected_cases is None or cases == expected_cases) and report["runtime"] == runtime
            and runtime["node"] == "v24.22.0" and runtime["vitest"] == "4.1.11"
            and runtime["platform"] == "linux" and runtime["availableParallelism"] == runtime["cpuCount"] == 8
            and not runtime["nodeOptions"] and options["rootEnvironment"] == "jsdom"
            and options["maxWorkers"] == 7 and options["pool"] == pool
            and options["isolate"] is True and options["watch"] is False and not options["shuffle"]
            and [(p["name"], p["environment"]) for p in projects] == [("node", "node"), ("jsdom", "jsdom")]
            and all([Path(f).name for f in p["setupFiles"]] == (["setupNodeTests.ts"] if p["name"] == "node" else ["setupTests.ts"]) for p in projects)
            and all(p["maxWorkers"] == 7 and p["pool"] == pool and p["isolate"] for p in projects)
            and all(Path(p).is_relative_to(cache) for p in [options["cacheDir"], *(v["cacheDir"] for v in projects)])
            and options["coverage"]["include"] == ["src/**/*.{js,ts,vue}"]
            and [r[0] for r in options["coverage"]["reporters"]] == ["json", "json-summary"]
            and options["coverage"]["provider"] == "v8" and options["coverage"]["thresholds"] is None)


def web_matches(web, commit):
    subprocess.run(["git", "diff", "--quiet", commit, "--", "."], cwd=web, check=True, timeout=15)


def coverage_difference(a, b, sa, sb):
    result = {"accepted": False, "scopeEqual": set(a) == set(b), "mapChanges": [],
              "denominatorChanges": [], "coveredDifferences": {}, "counterDifferences": {}, "negativeCounterSources": []}
    scope_valid = bool(a) and bool(b) and set(sa) - {"total"} == set(a) and set(sb) - {"total"} == set(b)
    for file in sorted(set(a) & set(b)):
        x, y = a[file], b[file]
        maps_equal = all(x[k] == y[k] for k in ("statementMap", "fnMap", "branchMap"))
        if not maps_equal:
            result["mapChanges"].append(file)
        if any(sa[file][m]["total"] != sb[file][m]["total"] for m in ("lines", "statements", "functions", "branches")):
            result["denominatorChanges"].append(file)
        counters = {m: {"original": x[m], "candidate": y[m]} for m in ("s", "f", "b") if x[m] != y[m]}
        if counters:
            result["counterDifferences"][file] = counters
        if any(v < 0 for source in (x, y) for metric in ("s", "f", "b") for value in source[metric].values() for v in (value if isinstance(value, list) else [value])):
            result["negativeCounterSources"].append(file)
        differences = []
        for metric in ("s", "f", "b"):
            if set(x[metric]) != set(y[metric]):
                differences.append({"metric": metric, "counterKeysDiffer": True})
                continue
            for key, left in x[metric].items():
                right = y[metric][key]
                if metric != "b":
                    if (left > 0) != (right > 0):
                        differences.append({"metric": metric, "id": key, "original": left, "candidate": right})
                    continue
                if len(left) != len(right):
                    differences.append({"metric": metric, "id": key, "armCountDiffers": True})
                    continue
                for arm, (before, after) in enumerate(zip(left, right)):
                    if (before > 0) == (after > 0):
                        continue
                    change = {"metric": metric, "id": key, "arm": arm, "original": before, "candidate": after}
                    differences.append(change)
        if differences:
            result["coveredDifferences"][file] = differences
    result["accepted"] = (scope_valid and result["scopeEqual"] and not result["mapChanges"]
                          and not result["denominatorChanges"] and not result["coveredDifferences"]
                          and not result["negativeCounterSources"])
    return result


def compare(output, left, right):
    a, b = [json.loads((output / (n + "-coverage/coverage-final.json")).read_text()) for n in (left, right)]
    sa, sb = [json.loads((output / (n + "-coverage/coverage-summary.json")).read_text()) for n in (left, right)]
    difference = coverage_difference(a, b, sa, sb)
    save(output / (left + "--" + right + "-differences.json"), difference)
    return {"left": left, "right": right, **{k: v for k, v in difference.items() if k != "counterDifferences"},
            "rawCounterDifferenceSources": len(difference["counterDifferences"])}


def resources(path):
    values = {}
    for line in path.read_text().splitlines():
        for label, key in (("User time (seconds)", "userSeconds"), ("System time (seconds)", "systemSeconds"),
                           ("Maximum resident set size (kbytes)", "maxRssKiB")):
            if line.strip().startswith(label + ":"):
                values[key] = float(line.split(":", 1)[1].strip())
    if set(values) != {"userSeconds", "systemSeconds", "maxRssKiB"}:
        raise ValueError("Missing complete-process resource accounting")
    values["cpuSeconds"] = values["userSeconds"] + values["systemSeconds"]
    return values


def assess_performance(trials, correctness):
    result = {"sampledWallAndCpuImprovement": False, "memoryRegressionAssurance": "unverified",
              "memoryComparisonUsedForAcceptance": False}
    by_name = {t["name"]: t for t in trials}
    if not correctness or [t["name"] for t in trials] != [t[0] for t in TRIALS]:
        return result
    result["sampledWallAndCpuImprovement"] = all(
        by_name[c]["run"]["wallSeconds"] <= 0.85 * by_name[a]["run"]["wallSeconds"]
        and by_name[c]["resources"]["cpuSeconds"] <= by_name[a]["resources"]["cpuSeconds"]
        for a, c in (("original-first", "candidate-first"), ("original-last", "candidate-second")))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overall-timeout", type=int, default=540)
    args = parser.parse_args()
    if not 30 < args.overall_timeout <= 540:
        parser.error("Overall budget must be31..540 seconds")
    started = time.monotonic()
    process.DEADLINE = started + args.overall_timeout - 20
    web, output = args.web.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result = {"success": False, "complete": False, "screenAccepted": False,
              "fullSuiteAndBillingUnverified": True,
              "memoryRegressionAssurance": "unverified", "memoryComparisonUsedForAcceptance": False}
    trials = []
    try:
        raw = Path(__file__).with_name("sample.json").read_bytes()
        assert digest(raw) == SAMPLE_DIGEST, "Cohort changed"
        sample = json.loads(raw)
        assert sample["sourceCommit"] == SOURCE and sample["webTree"] == WEB_TREE
        assert len(sample["files"]) == len({f["file"] for f in sample["files"]}) == 76
        assert sum(f["project"] == "node" for f in sample["files"]) == 4
        assert sum(f["project"] == "jsdom" for f in sample["files"]) == 72
        web_matches(web, SOURCE)
        assert not capture(["git", "status", "--porcelain", "--", "."], web).strip(), "Dirty initial web tree"
        assert capture(["git", "rev-parse", "HEAD:web"], web).decode().strip() == WEB_TREE
        for entry in sample["files"]:
            file = entry["file"]
            assert not Path(file).is_absolute() and ".." not in Path(file).parts and file.startswith("src/")
            assert digest((web / file).read_bytes()) == entry["sourceSha256"]
        assert not os.environ.get("NODE_OPTIONS"), "Default production heap required"
        assert "VITEST_MAX_WORKERS" not in os.environ
        env = os.environ | {"TZ": "UTC"}
        node = str(Path(shutil.which("node")).resolve())
        assert capture([node, "--version"], web).decode().strip() == "v24.22.0"
        assert capture(["npm", "--version"], web).decode().strip() == "11.19.1"
        runtime = json.loads(capture([node, "-e", RUNTIME], web))
        assert runtime["platform"] == "linux" and runtime["availableParallelism"] == runtime["cpuCount"] == 8
        assert runtime["vitest"] == "4.1.11"
        save(output / "environment.json", {"runtime": runtime, "npm": "11.19.1", "configuredRunner": "ubicloud-standard-8",
             "actualVmFamily": "requires this run's Set up job log review", "overallBudgetSeconds": args.overall_timeout,
             "trialLimitSeconds": 150, "executionLimitSeconds": 144, "cleanupReserveSeconds": 20,
             "memoryMetric": "Diagnostic only: summed RSS counts shared pages repeatedly across forks; GNUtime maxRSS is per-process. Neither establishes comparable physical memory usage.",
             "memoryRegressionAssurance": "unverified", "nodeExecutableSha256": digest(Path(node).read_bytes())})
        save(output / "source-inventory.json", {"sourceCommit": SOURCE, "webTree": WEB_TREE, "files": sample["files"]})
        save(output / "sample.json", sample)
        frozen_options, expected_cases = None, None
        with tempfile.TemporaryDirectory(prefix=".pool-proof-", dir=web) as temporary:
            temporary = Path(temporary)
            reporter = temporary / "reporter.mjs"
            shutil.copyfile(Path(__file__).with_name("reporter.mjs"), reporter)
            config = temporary / "config.mts"
            config.write_text("import config from " + json.dumps(str(web / "vitest.config.ts")) + ";\n" + CONFIG.replace("__FILES__", json.dumps([r["file"] for r in sample["files"]])).replace("__REPORTER__", json.dumps(str(reporter))))
            shutil.copyfile(config, output / "effective-config.mts")
            shutil.copyfile(reporter, output / "effective-reporter.mjs")
            for name, pool in TRIALS:
                assert time.monotonic() < process.DEADLINE, "Overall trial budget exhausted"
                web_matches(web, SOURCE)
                cache = temporary / "cache" / name
                assert not cache.exists()
                trial_env = env | {"BENCH_POOL": pool, "BENCH_CACHE": str(cache), "BENCH_REPORT": str(output / (name + ".json")),
                                   "BENCH_COVERAGE": str(output / (name + "-coverage"))}
                print("Starting " + name + " " + pool, flush=True)
                run = process.run([node, "node_modules/vitest/vitest.mjs", "run", "--config", str(config),
                                   "--pool", pool, "--maxWorkers", "7", "--coverage"], web, trial_env, output / (name + ".log"), 144)
                trial = {"name": name, "pool": pool, "sourceCommit": SOURCE, "run": run, "reportVerified": False}
                trials.append(trial)
                save(output / "trials.json", trials)
                web_matches(web, SOURCE)
                assert run["exit"] == 0 and not run["remainingOwnedProcesses"] and run["wallSeconds"] <= 150, "Trial failed or exceeded budget"
                assert run["processGroupPeakRssKiB"] > 0 and not run["memorySamplingErrors"], "Memory measurement failed"
                report = json.loads((output / (name + ".json")).read_text())
                trial["reportVerified"] = validate_report(report, sample, runtime, cache, pool, expected_cases)
                trial["resources"] = resources(output / (name + ".resources.txt"))
                save(output / "trials.json", trials)
                assert trial["reportVerified"], "Inventory/runtime/config/error gate failed"
                options = comparable_options(report["options"])
                if frozen_options is None:
                    frozen_options, expected_cases = options, canonical_cases(report)
                    save(output / "baseline-cases.json", expected_cases)
                assert options == frozen_options, "Resolved options changed across trials"
            comparisons = [compare(output, a, b) for a, b in (
                ("original-first", "candidate-first"), ("original-last", "candidate-second"),
                ("original-first", "original-last"), ("candidate-first", "candidate-second"))]
            correct = all(c["accepted"] for c in comparisons)
            assessment = assess_performance(trials, correct)
            accepted = assessment["sampledWallAndCpuImprovement"]
            result.update(success=accepted, screenAccepted=accepted, correctnessAccepted=correct, complete=True,
                          comparisons=comparisons, **assessment, actualVmFamilyAndSetupLogReviewRequired=True,
                          measuredBoundary="Fresh Vitest process through full stock V8 JSON coverage completion; excludes install/job/upload and production blob merge")
    except BaseException as error:
        result["error"] = repr(error)
    finally:
        try:
            web_matches(web, SOURCE)
            assert not capture(["git", "status", "--porcelain", "--", "."], web).strip()
            result["sourceUnchangedAndWebClean"] = True
        except BaseException as error:
            result["sourceUnchangedAndWebClean"] = False
            result["sourceError"] = repr(error)
            result["success"] = result["screenAccepted"] = False
        result["elapsedSeconds"] = time.monotonic() - started
        if result["elapsedSeconds"] > args.overall_timeout:
            result["success"] = result["screenAccepted"] = False
            result["budgetExceeded"] = True
        save(output / "result.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result["success"] else 1


RUNTIME = "const os=require('node:os');console.log(JSON.stringify({node:process.version,vitest:require('./node_modules/vitest/package.json').version,platform:process.platform,architecture:process.arch,heapLimit:require('node:v8').getHeapStatistics().heap_size_limit,nodeOptions:process.env.NODE_OPTIONS??null,availableParallelism:os.availableParallelism(),cpuCount:os.cpus().length,cpuModels:[...new Set(os.cpus().map(c=>c.model))].sort()}))"
CONFIG = '''const files = __FILES__;
export default { ...config, cacheDir: process.env.BENCH_CACHE, test: { ...config.test,
  isolate: true, pool: process.env.BENCH_POOL, sequence: { ...config.test.sequence, shuffle: false },
  projects: config.test.projects.map(p => ({ ...p, test: { ...p.test,
    include: p.test.name === "node" ? p.test.include.filter(f => files.includes(f)) : files } })),
  reporters: ["default", __REPORTER__], coverage: { ...config.test.coverage, thresholds: undefined,
    reportOnFailure: true, reporter: ["json", "json-summary"], reportsDirectory: process.env.BENCH_COVERAGE }
} };
'''


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
