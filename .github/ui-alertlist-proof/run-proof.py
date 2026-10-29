#!/usr/bin/env python3
import argparse
import collections
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

DEADLINE = None
BASE = '743990d3839a4fa8de4f3fcf31b8d7ca3f00c282'
WEB_TREE = '337d85bc38dec7e0e17afea5108d96d4b4a2c0c0'
TRIALS = [('workers-7-first', 7), ('workers-6-first', 6), ('workers-6-second', 6), ('workers-7-last', 7)]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, indent=2, default=str) + '\n')


def capture(command, cwd, env):
    return subprocess.check_output(command, cwd=cwd, env=env, text=True).strip()


def inventory(web):
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=web).decode().split('\0')
    return {name: digest((web / name).read_bytes()) for name in sorted(set(names)) if name}


def owned_group(pgid):
    output = subprocess.check_output(['ps', '-eo', 'pid=,pgid=,stat=,args='], text=True)
    return [line.strip() for line in output.splitlines() if len(line.split(None, 3)) >= 3 and line.split(None, 3)[1] == str(pgid) and not line.split(None, 3)[2].startswith('Z')]


def stop_group(pgid):
    if not owned_group(pgid):
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 5
    while owned_group(pgid) and time.monotonic() < deadline:
        time.sleep(0.1)
    if owned_group(pgid):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run(command, web, env, log, timeout):
    if sys.platform == 'linux':
        command = ['/usr/bin/time', '-v', '-o', str(log.with_suffix('.resources.txt')), *command]
    started = time.monotonic()
    before = {'load': os.getloadavg(), 'time': time.time()}
    remaining = DEADLINE - time.monotonic() if DEADLINE is not None else timeout
    effective_timeout = min(timeout, remaining)
    save(log.with_suffix('.launch.json'), {'command': command, 'timeout': timeout, 'effectiveTimeout': max(0, effective_timeout), 'before': before})
    if effective_timeout <= 0:
        return {'command': command, 'exit': 'deadline', 'wallSeconds': 0, 'before': before, 'reapedDescendants': [], 'remainingOwnedProcesses': []}
    with log.open('w') as output:
        child = subprocess.Popen(command, cwd=web, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            stop_group(child.pid)
            child.wait(timeout=10)
            code = 'deadline' if effective_timeout < timeout else 'timeout'
        finally:
            descendants = owned_group(child.pid)
            stop_group(child.pid)
            child.wait(timeout=10)
    return {'command': command, 'exit': code, 'wallSeconds': time.monotonic() - started, 'before': before, 'after': {'load': os.getloadavg(), 'time': time.time()}, 'reapedDescendants': descendants, 'remainingOwnedProcesses': owned_group(child.pid)}


def cases(report):
    return sorted((record['file'], record['project'], record['pool'], test['id'], test['name'], test['mode'], test['state']) for record in report['records'] for test in record['tests'])


def compare(output, left, right):
    result = {'baseline': left, 'candidate': right}
    try:
        a, b = [json.loads((output / (name + '.json')).read_text()) for name in (left, right)]
        ca, cb = cases(a), cases(b)
        result.update({'baselineCases': len(ca), 'candidateCases': len(cb), 'caseDispositionsEqual': ca == cb, 'baselineStates': dict(collections.Counter(x[-1] for x in ca)), 'candidateStates': dict(collections.Counter(x[-1] for x in cb)), 'baselineErrors': a['errors'], 'candidateErrors': b['errors']})
        sa, sb = [json.loads((output / (name + '-coverage') / 'coverage-summary.json').read_text()) for name in (left, right)]
        summary_differences = {key: {'baseline': sa.get(key), 'candidate': sb.get(key)} for key in sa.keys() | sb.keys() if sa.get(key) != sb.get(key)}
        save(output / (right + '-summary-differences.json'), summary_differences)
        result.update({'baselineSourceCount': len(sa) - 1, 'candidateSourceCount': len(sb) - 1, 'summaryObjectsEqual': not summary_differences})
        ma, mb = [json.loads((output / (name + '-coverage') / 'coverage-final.json').read_text()) for name in (left, right)]
        scope_valid = 'total' in sa and 'total' in sb and bool(ma) and bool(mb) and set(sa) - {'total'} == set(ma) and set(sb) - {'total'} == set(mb)
        result['coverageScopeValid'] = scope_valid
        covered_differences = {}
        for path in ma.keys() | mb.keys():
            if path not in ma or path not in mb:
                covered_differences[path] = {'missingMap': True}
                continue
            aa, bb = ma[path], mb[path]
            differences = {}
            for key in ('statementMap', 'fnMap', 'branchMap'):
                if aa.get(key) != bb.get(key):
                    differences[key] = 'locations differ'
            for key in ('s', 'f', 'b'):
                def covered(values):
                    return {k: [n > 0 for n in v] if isinstance(v, list) else v > 0 for k, v in values.items()}
                av, bv = covered(aa[key]), covered(bb[key])
                changed = {k: {'baseline': av.get(k), 'candidate': bv.get(k)} for k in av.keys() | bv.keys() if av.get(k) != bv.get(k)}
                if changed:
                    differences[key] = changed
            if differences:
                covered_differences[path] = differences
        save(output / (right + '-covered-location-differences.json'), covered_differences)
        result['coveredLocationsEqual'] = not covered_differences
        result['equivalent'] = scope_valid and ca == cb and bool(ca) and not a['errors'] and not b['errors'] and not summary_differences and not covered_differences
        result['allTestsPassedOrSkipped'] = all(x[-1] in ('passed', 'skipped') for x in ca + cb)
        result['comparisonVerified'] = result['equivalent'] and result['allTestsPassedOrSkipped']
    except (OSError, KeyError, ValueError) as error:
        result.update({'equivalent': False, 'comparisonVerified': False, 'error': str(error)})
    return result


def attach_runtime_status(comparison, trials):
    by_name = {trial['name']: trial for trial in trials}
    comparison['runtimeSucceeded'] = all(by_name.get(name, {}).get('test', {}).get('exit') == 0 and by_name.get(name, {}).get('merge', {}).get('exit') == 0 for name in (comparison['baseline'], comparison['candidate']))
    comparison['comparisonVerified'] = comparison['comparisonVerified'] and comparison['runtimeSucceeded']
    return comparison


def case_digest(tests):
    values = sorted((t['id'], t['name'], t['mode'], t['state']) for t in tests)
    return digest(json.dumps(values, separators=(',', ':')).encode())


def validate_report(report, sample, workers, runtime):
    records = report['records']
    actual = sorted((r['file'], r['project'], r['pool'], len(r['tests']), case_digest(r['tests'])) for r in records)
    expected = sorted((r['file'], r['project'], r['pool'], r['cases'], r['caseDigest']) for r in sample['files'])
    options = report['options']
    expected_projects = sorted(set(r['project'] for r in sample['files']))
    projects = options['projects']
    return (report['reason'] == 'passed' and not report['errors'] and actual == expected
            and report['runtime'] == runtime and runtime['availableParallelism'] == 8
            and runtime['node'] == 'v24.22.0' and runtime['vitest'] == '4.1.11'
            and options['maxWorkers'] == workers and options['pool'] == 'forks'
            and options['isolate'] is True and options['watch'] is False
            and sorted(p['name'] for p in projects) == expected_projects
            and all(p['maxWorkers'] == workers and p['pool'] == 'forks' and p['isolate'] is True
                    and p['environment'] == p['name'] for p in projects))


def verify_trials(trials, source_hash):
    return ([(t['name'], t['workers']) for t in trials] == TRIALS
            and all(t.get('reportVerified') is True and t.get('sourceBefore') == source_hash
                    and t.get('sourceAfter') == source_hash and t['test']['exit'] == 0
                    and t.get('merge', {}).get('exit') == 0 for t in trials))


def main():
    global DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--web', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--test-timeout', type=int, default=240)
    parser.add_argument('--merge-timeout', type=int, default=90)
    parser.add_argument('--overall-timeout', type=int, default=1320)
    args = parser.parse_args()
    assert args.overall_timeout > 15, 'Need time for proof and 15s cleanup reserve'
    DEADLINE = time.monotonic() + args.overall_timeout - 15
    web, output = args.web.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result = {'success': False, 'complete': False, 'comparisonVerified': False, 'performanceAcceptance': False}
    trials = []
    before = None
    try:
        node = Path(shutil.which('node')).resolve()
        env = os.environ | {'PATH': str(node.parent) + os.pathsep + os.environ['PATH']}
        assert 'VITEST_MAX_WORKERS' not in env, 'Unexpected worker environment override'
        assert capture([str(node), '-p', 'process.version'], web, env) == 'v24.22.0', 'Expected exact Node24.22.0'
        assert capture(['npm', '--version'], web, env) == '11.19.1', 'Expected exact npm11.19.1'
        assert not capture(['git', 'diff', BASE, '--', ':(top)web'], web, env), 'Probe web tree differs from pinned baseline'
        assert not capture(['git', 'status', '--porcelain', '--', '.'], web, env), 'Dirty web checkout'
        assert capture(['git', 'rev-parse', 'HEAD:web'], web, env) == WEB_TREE, 'Unexpected tracked web tree'
        sample = json.loads(Path(__file__).with_name('sample.json').read_text())
        assert sample['webTree'] == WEB_TREE and sample['referenceMerge'] == BASE
        assert len(sample['files']) == 76 and sum(f['cases'] for f in sample['files']) == 3772
        assert all(digest((web / f['file']).read_bytes()) == f['sourceSha256'] for f in sample['files'])
        before = inventory(web)
        source_hash = digest(json.dumps(before, sort_keys=True).encode())
        save(output / 'source-inventory.json', before)
        save(output / 'sample.json', sample)
        runtime_code = "const os=require('node:os'); console.log(JSON.stringify({node:process.version,vitest:require('./node_modules/vitest/package.json').version,platform:process.platform,architecture:process.arch,heapLimit:require('node:v8').getHeapStatistics().heap_size_limit,nodeOptions:process.env.NODE_OPTIONS ?? null,availableParallelism:os.availableParallelism(),cpuCount:os.cpus().length,cpuModels:[...new Set(os.cpus().map(c=>c.model))].sort()}))"
        runtime = json.loads(capture([str(node), '-e', runtime_code], web, env))
        assert runtime['availableParallelism'] == 8, 'This screen requires eight available CPUs'
        save(output / 'environment.json', {'baseline': BASE, 'webTree': WEB_TREE, 'probeHead': capture(['git', 'rev-parse', 'HEAD'], web, env), 'runtime': runtime, 'nodeExecutableSha256': digest(node.read_bytes()), 'npm': '11.19.1', 'sourceDigest': source_hash, 'overallTimeoutSeconds': args.overall_timeout, 'cleanupReserveSeconds': 15, 'configuredRunnerLabel': 'ubicloud-standard-8', 'familyEvidence': 'Inspect actual GitHub job setup VM Family log before assigning price'})
        with tempfile.TemporaryDirectory(prefix='.worker-proof-', dir=web) as temporary:
            temporary = Path(temporary)
            config, reporter = temporary / 'config.mts', temporary / 'reporter.mjs'
            reporter.write_text('import fs from "node:fs";\nimport os from "node:os";\nimport v8 from "node:v8";\nimport { reportedTest } from ' + json.dumps(str(web / 'scripts/ui-tests/reporter.ts')) + ';\n' + REPORTER)
            config.write_text('import config from ' + json.dumps(str(web / 'vitest.config.ts')) + ';\nconst sample = ' + json.dumps(sample['files']) + ';\n' + CONFIG.replace('__CACHE__', json.dumps(str(temporary / 'cache'))).replace('__REPORTER__', json.dumps(str(reporter))))
            shutil.copy2(config, output / 'effective-config.mts')
            shutil.copy2(reporter, output / 'effective-reporter.mjs')
            for name, workers in TRIALS:
                print('Starting ' + name, flush=True)
                current_hash = digest(json.dumps(inventory(web), sort_keys=True).encode())
                assert current_hash == source_hash, 'Source drift before trial'
                trial_env = env | {'BENCH_REPORT': str(output / (name + '.json')), 'BENCH_BLOB': str(output / (name + '-blobs/blob.json')), 'BENCH_COVERAGE': str(output / (name + '-coverage'))}
                command = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', str(config), '--pool', 'forks', '--maxWorkers', str(workers), '--coverage']
                cache = temporary / 'cache'
                if cache.exists():
                    shutil.rmtree(cache)
                trial = {'name': name, 'workers': workers, 'sourceBefore': current_hash, 'cachePolicy': 'clear tempfile-owned optimizer cache before every trial; merge reuses trial cache', 'test': run(command, web, trial_env, output / (name + '.log'), args.test_timeout)}
                trials.append(trial)
                trial['sourceAfter'] = digest(json.dumps(inventory(web), sort_keys=True).encode())
                report_path = Path(trial_env['BENCH_REPORT'])
                if report_path.is_file():
                    report = json.loads(report_path.read_text())
                    trial['reportVerified'] = validate_report(report, sample, workers, runtime) and all(Path(path).is_relative_to(cache) for path in [report['options']['cacheDir'], *(p['cacheDir'] for p in report['options']['projects'])])
                save(output / 'trials.json', trials)
                blob = Path(trial_env['BENCH_BLOB'])
                if blob.is_file() and trial['test']['exit'] not in ('timeout', 'deadline'):
                    trial['blobBytes'] = blob.stat().st_size
                    merge_env = {k: v for k, v in trial_env.items() if k != 'BENCH_BLOB'}
                    merge_command = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', str(config), '--pool', 'forks', '--maxWorkers', str(workers), '--coverage', '--merge-reports', str(blob.parent)]
                    trial['merge'] = run(merge_command, web, merge_env, output / (name + '-merge.log'), args.merge_timeout)
                save(output / 'trials.json', trials)
                print(name + ' test=' + str(trial['test']['exit']) + ' merge=' + str(trial.get('merge', {}).get('exit')), flush=True)
                if trial['test']['exit'] in ('timeout', 'deadline') or trial.get('merge', {}).get('exit') in ('timeout', 'deadline'):
                    break
            comparisons = [attach_runtime_status(compare(output, TRIALS[0][0], name), trials) for name, _ in TRIALS[1:]]
            verified = verify_trials(trials, source_hash) and all(c['comparisonVerified'] for c in comparisons)
            result.update({'success': verified, 'complete': len(trials) == 4 and all(t['test']['exit'] not in ('timeout', 'deadline') and t.get('merge', {}).get('exit') not in (None, 'timeout', 'deadline') for t in trials), 'comparisonVerified': verified, 'comparisons': comparisons, 'trials': [{'name': t['name'], 'workers': t['workers'], 'reportVerified': t.get('reportVerified', False), 'testExit': t['test']['exit'], 'mergeExit': t.get('merge', {}).get('exit')} for t in trials], 'cachePolicy': 'symmetric cold optimizer cache per trial'})
    except Exception as error:
        result['error'] = repr(error)
    finally:
        try:
            result['sourceInventoryUnchanged'] = before is not None and inventory(web) == before
        except (OSError, subprocess.SubprocessError) as error:
            result['sourceInventoryUnchanged'] = False
            result['sourceAuditError'] = repr(error)
        if not result['sourceInventoryUnchanged']:
            result['success'] = result['comparisonVerified'] = False
        if not result['complete']:
            result['incompleteReason'] = 'Deadline, failed preflight or missing trial; no retries'
        save(output / 'result.json', result)
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result['success'] else 1


REPORTER = r'''export default class Measure {
  onInit(ctx) { this.ctx = ctx; this.start = performance.now(); }
  onTestRunStart() {
    const c = this.ctx.config;
    this.options = { cacheDir: this.ctx.vite.config.cacheDir, maxWorkers: c.maxWorkers, pool: c.pool, isolate: c.isolate, watch: c.watch, projects: this.ctx.projects.map(p => ({ name: p.name, configuredMaxWorkers: p.config.maxWorkers ?? null, maxWorkers: p.config.maxWorkers || c.maxWorkers, pool: p.config.pool, isolate: p.config.isolate, environment: p.config.environment, cacheDir: p.vite.config.cacheDir })).sort((a,b) => a.name.localeCompare(b.name)) };
  }
  onTestModuleEnd() { this.lastModuleMs = performance.now() - this.start; }
  onCoverage() { this.coverageMs = performance.now() - this.start; }
  onTestCaseResult(test) { fs.appendFileSync(process.env.BENCH_REPORT + '.progress.jsonl', JSON.stringify({ at: new Date().toISOString(), name: test.fullName, result: test.result() }) + '\n'); }
  onTestRunEnd(modules, errors, reason) {
    const runtime = { node: process.version, vitest: JSON.parse(fs.readFileSync(new URL('../node_modules/vitest/package.json', import.meta.url))).version, platform: process.platform, architecture: process.arch, heapLimit: v8.getHeapStatistics().heap_size_limit, nodeOptions: process.env.NODE_OPTIONS ?? null, availableParallelism: os.availableParallelism(), cpuCount: os.cpus().length, cpuModels: [...new Set(os.cpus().map(c => c.model))].sort() };
    fs.writeFileSync(process.env.BENCH_REPORT, JSON.stringify({ reason, errors, runtime, options: this.options, wallMs: performance.now() - this.start, lastModuleMs: this.lastModuleMs, coverageMs: this.coverageMs, resources: process.resourceUsage(), memory: process.memoryUsage(), records: modules.map(m => ({ file: m.relativeModuleId, project: m.project.name, pool: m.toTestSpecification().pool, state: m.state(), diagnostic: m.diagnostic(), tests: [...m.children.allTests()].map(reportedTest) })) }, null, 2));
  }
}
'''

CONFIG = '''export default { ...config, cacheDir: __CACHE__, test: { ...config.test, isolate: true, pool: "forks", sequence: { ...config.test.sequence, shuffle: false }, projects: config.test.projects.map(p => ({ ...p, test: { ...p.test, include: sample.filter(f => f.project === p.test.name).map(f => f.file) } })), logHeapUsage: true, reporters: process.env.BENCH_BLOB ? ["default", __REPORTER__, ["blob", { outputFile: process.env.BENCH_BLOB }]] : ["default"], coverage: { ...config.test.coverage, thresholds: undefined, reportOnFailure: true, reporter: process.env.BENCH_BLOB ? [] : ["json-summary", "json"], reportsDirectory: process.env.BENCH_COVERAGE } } };
'''


def interrupted(signum, frame):
    raise SystemExit(128 + signum)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
