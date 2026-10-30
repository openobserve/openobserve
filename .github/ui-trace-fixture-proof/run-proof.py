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

BASE = "569270ac8513b42aa81bd8be97f1f63f562bb229"
CANDIDATE = "35935550400a172f6ef98cddec21660046ed7563"
WEB_TREE = "e31ae7cb42763fe78377266f056467d6a88a3423"
FILES = ("src/plugins/traces/TraceDetails.spec.ts", "src/plugins/traces/TraceDetailsSidebar.spec.ts")
TRIALS = (("original-first", BASE), ("candidate-first", CANDIDATE),
          ("candidate-second", CANDIDATE), ("original-last", BASE))
CASE_DIGEST = "3e9c687754e44cf7a7c7914f09a00c779fc4b33aade51533d6210f5fda5c864b"
EXCEPTION_MAP = {"line": 494, "loc": {"start": {"line": 494, "column": 20}, "end": {"line": 494, "column": 90}},
                 "locations": [{"start": {"line": 494, "column": 20}, "end": {"line": 494, "column": 81}},
                               {"start": {"line": 494, "column": 81}, "end": {"line": 494, "column": 90}}], "type": "binary-expr"}


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def capture(command, cwd):
    return subprocess.check_output(command, cwd=cwd, timeout=15)


def canonical_cases(report):
    rows = [dict(file=r["file"], project=r["project"], **t) for r in report["records"] for t in r["tests"]]
    return sorted(rows, key=lambda t: tuple(t[k] for k in ("file", "project", "name", "mode", "state")))


def validate_report(report, sample, runtime, cache):
    records, options = report["records"], report["options"]
    projects = options["projects"]
    return (report["reason"] == "passed" and not report["errors"]
            and sorted(r["file"] for r in records) == sorted(FILES)
            and all(r["state"] == "passed" and r["pool"] == "forks" for r in records)
            and canonical_cases(report) == sample["cases"] and report["runtime"] == runtime
            and runtime["node"] == "v24.22.0" and runtime["vitest"] == "4.1.11"
            and runtime["platform"] == "linux" and runtime["availableParallelism"] == runtime["cpuCount"] == 8
            and not runtime["nodeOptions"] and options["rootEnvironment"] == "jsdom"
            and options["maxWorkers"] == 7 and options["pool"] == "forks"
            and options["isolate"] is True and options["watch"] is False and not options["shuffle"]
            and [(p["name"], p["environment"]) for p in projects] == [("node", "node"), ("jsdom", "jsdom")]
            and all([Path(f).name for f in p["setupFiles"]] == (["setupNodeTests.ts"] if p["name"] == "node" else ["setupTests.ts"]) for p in projects)
            and all(p["maxWorkers"] == 7 and p["pool"] == "forks" and p["isolate"] for p in projects)
            and all(Path(p).is_relative_to(cache) for p in [options["cacheDir"], *(v["cacheDir"] for v in projects)])
            and options["coverage"]["include"] == ["src/**/*.{js,ts,vue}"]
            and [r[0] for r in options["coverage"]["reporters"]] == ["json", "json-summary"]
            and options["coverage"]["provider"] == "v8" and options["coverage"]["thresholds"] is None)


def web_matches(web, commit):
    subprocess.run(["git", "diff", "--quiet", commit, "--", "."], cwd=web, check=True, timeout=15)


def restore(web, contents):
    for file, data in contents.items():
        (web / file).write_bytes(data)


def coverage_difference(a, b, sa, sb, allow_exception=False):
    result = {"accepted": False, "scopeEqual": set(a) == set(b), "mapChanges": [],
              "denominatorChanges": [], "coveredDifferences": {}, "counterDifferences": {}, "negativeCounterSources": [], "acceptedExceptions": []}
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
                    permitted = (allow_exception and maps_equal and file.endswith("/src/components/CodeQueryEditor.vue")
                                 and key == "15" and arm == 1 and before > 0 and after == 0
                                 and x["branchMap"][key] == EXCEPTION_MAP)
                    if permitted:
                        result["acceptedExceptions"].append({"file": file, **change})
                    else:
                        differences.append(change)
        if differences:
            result["coveredDifferences"][file] = differences
    result["accepted"] = (scope_valid and result["scopeEqual"] and not result["mapChanges"]
                          and not result["denominatorChanges"] and not result["coveredDifferences"]
                          and not result["negativeCounterSources"] and len(result["acceptedExceptions"]) <= 1)
    return result


def compare(output, left, right, allow_exception):
    a, b = [json.loads((output / (n + "-coverage/coverage-final.json")).read_text()) for n in (left, right)]
    sa, sb = [json.loads((output / (n + "-coverage/coverage-summary.json")).read_text()) for n in (left, right)]
    difference = coverage_difference(a, b, sa, sb, allow_exception)
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


def performance_eligible(trials, correctness):
    by_name = {t["name"]: t for t in trials}
    if not correctness or [t["name"] for t in trials] != [t[0] for t in TRIALS]:
        return False
    return all(by_name[c]["run"]["wallSeconds"] < by_name[a]["run"]["wallSeconds"]
               and by_name[c]["resources"]["cpuSeconds"] <= by_name[a]["resources"]["cpuSeconds"]
               for a, c in (("original-first", "candidate-first"), ("original-last", "candidate-second")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overall-timeout", type=int, default=480)
    args = parser.parse_args()
    if not 30 < args.overall_timeout <= 480:
        parser.error("Overall budget must be31..480 seconds")
    started = time.monotonic()
    process.DEADLINE = started + args.overall_timeout - 20
    web, output = args.web.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result = {"success": False, "complete": False, "sampledImprovementEligible": False,
              "performanceAcceptance": False, "fullSuiteAndBillingUnverified": True}
    candidate = {}
    trials = []
    try:
        sample = json.loads(Path(__file__).with_name("sample.json").read_text())
        assert sample["baseline"]["commit"] == BASE and sample["candidate"]["commit"] == CANDIDATE
        assert sample["candidate"]["webTree"] == WEB_TREE
        assert digest(json.dumps(sample["cases"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()) == CASE_DIGEST
        assert len(sample["cases"]) == 369
        assert not capture(["git", "status", "--porcelain", "--", "."], web).strip(), "Dirty initial web tree"
        assert capture(["git", "rev-parse", "HEAD:web"], web).decode().strip() == WEB_TREE
        changed = capture(["git", "diff", "--name-only", BASE, CANDIDATE, "--", "."], web).decode().splitlines()
        assert sorted(changed) == sorted("web/" + f for f in FILES), changed
        contents = {}
        for label, commit in (("baseline", BASE), ("candidate", CANDIDATE)):
            assert capture(["git", "rev-parse", commit + ":web"], web).decode().strip() == sample[label]["webTree"]
            contents[commit] = {}
            for file in FILES:
                meta = sample[label]["files"]["web/" + file]
                data = capture(["git", "show", commit + ":web/" + file], web)
                assert digest(data) == meta["sha256"]
                assert capture(["git", "rev-parse", commit + ":web/" + file], web).decode().strip() == meta["blob"]
                contents[commit][file] = data
        candidate = contents[CANDIDATE]
        web_matches(web, CANDIDATE)
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
             "trialLimitSeconds": 120, "cleanupReserveSeconds": 20, "nodeExecutableSha256": digest(Path(node).read_bytes())})
        save(output / "source-inventory.json", {"baseline": sample["baseline"], "candidate": sample["candidate"], "onlyTwoTrackedWebFilesDiffer": True})
        save(output / "sample.json", sample)
        frozen_options = None
        with tempfile.TemporaryDirectory(prefix=".trace-fixture-proof-", dir=web) as temporary:
            temporary = Path(temporary)
            reporter = temporary / "reporter.mjs"
            shutil.copyfile(Path(__file__).with_name("reporter.mjs"), reporter)
            config = temporary / "config.mts"
            config.write_text("import config from " + json.dumps(str(web / "vitest.config.ts")) + ";\n" + CONFIG.replace("__FILES__", json.dumps(FILES)).replace("__REPORTER__", json.dumps(str(reporter))))
            shutil.copyfile(config, output / "effective-config.mts")
            shutil.copyfile(reporter, output / "effective-reporter.mjs")
            for name, commit in TRIALS:
                assert time.monotonic() < process.DEADLINE, "Overall trial budget exhausted"
                restore(web, contents[commit])
                web_matches(web, commit)
                cache = temporary / "cache" / name
                assert not cache.exists()
                trial_env = env | {"BENCH_CACHE": str(cache), "BENCH_REPORT": str(output / (name + ".json")),
                                   "BENCH_COVERAGE": str(output / (name + "-coverage"))}
                print("Starting " + name, flush=True)
                run = process.run([node, "node_modules/vitest/vitest.mjs", "run", "--config", str(config),
                                   "--pool", "forks", "--maxWorkers", "7", "--coverage"], web, trial_env, output / (name + ".log"), 120)
                trial = {"name": name, "sourceCommit": commit, "run": run, "reportVerified": False}
                trials.append(trial)
                save(output / "trials.json", trials)
                web_matches(web, commit)
                assert run["exit"] == 0 and not run["remainingOwnedProcesses"], "Trial failed or exceeded budget"
                report = json.loads((output / (name + ".json")).read_text())
                options = json.loads(json.dumps(report["options"]))
                options.pop("cacheDir")
                for project in options["projects"]:
                    project.pop("cacheDir")
                if frozen_options is None:
                    frozen_options = options
                assert options == frozen_options, "Resolved options changed across trials"
                trial["reportVerified"] = validate_report(report, sample, runtime, cache)
                trial["resources"] = resources(output / (name + ".resources.txt"))
                save(output / "trials.json", trials)
                assert trial["reportVerified"], "Inventory/runtime/config/error gate failed"
            comparisons = [compare(output, a, b, exception) for a, b, exception in (
                ("original-first", "candidate-first", True), ("original-last", "candidate-second", True),
                ("original-first", "original-last", False), ("candidate-first", "candidate-second", False))]
            correct = all(c["accepted"] for c in comparisons)
            result.update(success=correct, complete=True, comparisons=comparisons,
                          sampledImprovementEligible=performance_eligible(trials, correct),
                          actualVmFamilyAndSetupLogReviewRequired=True,
                          measuredBoundary="One fresh Vitest process through full stock V8 JSON coverage completion; excludes install/job/upload and production blob merge")
    except BaseException as error:
        result["error"] = repr(error)
    finally:
        try:
            restore(web, candidate)
            web_matches(web, CANDIDATE)
            assert not capture(["git", "status", "--porcelain", "--", "."], web).strip()
            result["candidateRestoredAndWebClean"] = True
        except BaseException as error:
            result["candidateRestoredAndWebClean"] = False
            result["restorationError"] = repr(error)
            result["success"] = result["sampledImprovementEligible"] = False
        result["elapsedSeconds"] = time.monotonic() - started
        if result["elapsedSeconds"] > args.overall_timeout:
            result["success"] = result["sampledImprovementEligible"] = False
            result["budgetExceeded"] = True
        save(output / "result.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result["success"] else 1


RUNTIME = "const os=require('node:os');console.log(JSON.stringify({node:process.version,vitest:require('./node_modules/vitest/package.json').version,platform:process.platform,architecture:process.arch,heapLimit:require('node:v8').getHeapStatistics().heap_size_limit,nodeOptions:process.env.NODE_OPTIONS??null,availableParallelism:os.availableParallelism(),cpuCount:os.cpus().length,cpuModels:[...new Set(os.cpus().map(c=>c.model))].sort()}))"
CONFIG = '''const files = __FILES__;
export default { ...config, cacheDir: process.env.BENCH_CACHE, test: { ...config.test,
  isolate: true, pool: "forks", sequence: { ...config.test.sequence, shuffle: false },
  projects: config.test.projects.map(p => ({ ...p, test: { ...p.test,
    include: p.test.name === "jsdom" ? files : ["__trace_proof_no_matches__/**/*.spec.ts"] } })),
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
