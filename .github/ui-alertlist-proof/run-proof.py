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
BASE = '3960df0f12760f4e8628a5a9104fef65048ff369'
TARGET = 'src/components/alerts/AlertList.spec.ts'
EXPECTED = {'baseline': '82bfaec613aae3405ad9ea3575c7672be224c2aef47e6fb33ad5342ca774ae63', 'candidate': 'dcf2857d8fa0b23f7d3c7d6351cc5bc5b828f779328e1dcd6f95c62a53b36284'}


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
    return sorted((record['file'], test['name'], test['mode'], test['state']) for record in report['records'] for test in record['tests'])


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
        result['equivalent'] = scope_valid and ca == cb and len(ca) == 117 and not a['errors'] and not b['errors'] and not summary_differences and not covered_differences
        result['allTestsPassed'] = all(x[-1] == 'passed' for x in ca + cb)
        result['comparisonVerified'] = result['equivalent'] and result['allTestsPassed']
    except (OSError, KeyError, ValueError) as error:
        result.update({'equivalent': False, 'comparisonVerified': False, 'error': str(error)})
    return result


def attach_runtime_status(comparison, trials):
    by_name = {trial['name']: trial for trial in trials}
    comparison['runtimeSucceeded'] = all(by_name.get(name, {}).get('test', {}).get('exit') == 0 and by_name.get(name, {}).get('merge', {}).get('exit') == 0 for name in (comparison['baseline'], comparison['candidate']))
    comparison['comparisonVerified'] = comparison['comparisonVerified'] and comparison['runtimeSucceeded']
    return comparison


def main():
    global DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--web', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--seed', default='1729')
    parser.add_argument('--test-timeout', type=int, default=240)
    parser.add_argument('--merge-timeout', type=int, default=90)
    parser.add_argument('--overall-timeout', type=int, default=1320)
    args = parser.parse_args()
    assert args.overall_timeout > 15, 'Need time for proof and 15s cleanup reserve'
    DEADLINE = time.monotonic() + args.overall_timeout - 15
    web, output = args.web.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    node = Path(shutil.which('node')).resolve()
    env = os.environ | {'PATH': str(node.parent) + os.pathsep + os.environ['PATH']}
    assert capture([str(node), '-p', 'process.version'], web, env) == 'v24.22.0', 'Expected exact Node24.22.0'
    assert capture(['npm', '--version'], web, env) == '11.19.1', 'Expected exact npm11.19.1'
    inputs = {'baseline': args.baseline.read_bytes(), 'candidate': args.candidate.read_bytes()}
    assert {name: digest(data) for name, data in inputs.items()} == EXPECTED, 'Frozen inputs changed'
    original = (web / TARGET).read_bytes()
    assert original == inputs['baseline'], 'Probe checkout must start with exact baseline spec'
    assert subprocess.check_output(['git', 'show', BASE + ':web/' + TARGET], cwd=web) == original
    assert not capture(['git', 'diff', BASE, '--', ':(top)web'], web, env), 'Probe web tree differs from pinned baseline'
    assert capture(['git', 'rev-parse', 'HEAD:web'], web, env) == 'd51379f81d6f4521be4ae1bfe69fc6c5dba4a17d', 'Unexpected tracked web tree'
    before = inventory(web)
    save(output / 'source-inventory.json', before)
    save(output / 'environment.json', {'baseline': BASE, 'probeHead': capture(['git', 'rev-parse', 'HEAD'], web, env), 'node': capture([str(node), '-p', 'process.version'], web, env), 'nodeExecutable': str(node), 'nodeExecutableSha256': digest(node.read_bytes()), 'npm': capture(['npm', '--version'], web, env), 'platform': sys.platform, 'cpuCount': os.cpu_count(), 'uname': list(os.uname()), 'inputs': EXPECTED, 'seed': args.seed, 'overallTimeoutSeconds': args.overall_timeout, 'cleanupReserveSeconds': 15})
    for name, data in inputs.items():
        (output / ('AlertList.' + name + '.spec.ts')).write_bytes(data)
    verifier = Path(__file__).with_name('verify-bodies.mjs')
    body_check = run([str(node), str(verifier), str(web), str(args.baseline.resolve()), str(args.candidate.resolve())], web, env, output / 'body-parity.json', 60)
    assert body_check['exit'] == 0, 'Test body/assertion AST changed'
    trials = []
    gates = []
    result = {'success': False, 'complete': False, 'comparisonVerified': False}
    try:
        (web / TARGET).write_bytes(inputs['candidate'])
        for name, command, cap in [('format', ['npm', 'run', 'format:check'], 180), ('lint', [str(node), 'node_modules/eslint/bin/eslint.js', TARGET, '--no-fix'], 60)]:
            print('Starting candidate ' + name, flush=True)
            gates.append({'name': name, **run(command, web, env, output / ('candidate-' + name + '.log'), cap)})
            save(output / 'gates.json', gates)
        assert (web / TARGET).read_bytes() == inputs['candidate'], 'Read-only gates changed candidate'
        (web / TARGET).write_bytes(original)
        with tempfile.TemporaryDirectory(prefix='.alertlist-proof-', dir=web) as temporary:
            temporary = Path(temporary)
            config, reporter = temporary / 'config.mts', temporary / 'reporter.mjs'
            reporter.write_text('import fs from "node:fs";\nimport { reportedTest } from ' + json.dumps(str(web / 'scripts/ui-tests/reporter.ts')) + ';\n' + '''export default class Measure {
  onInit() { this.start = performance.now(); }
  onTestCaseResult(test) { fs.appendFileSync(process.env.BENCH_REPORT + '.progress.jsonl', JSON.stringify({ at: new Date().toISOString(), name: test.fullName, result: test.result() }) + '\\n'); }
  onTestRunEnd(modules, errors, reason) { fs.writeFileSync(process.env.BENCH_REPORT, JSON.stringify({ reason, errors, wallMs: performance.now() - this.start, resources: process.resourceUsage(), memory: process.memoryUsage(), records: modules.map(m => ({ file: m.relativeModuleId, project: m.project.name, state: m.state(), diagnostic: m.diagnostic(), tests: [...m.children.allTests()].map(reportedTest) })) }, null, 2)); }
}\n''')
            config.write_text('import config from ' + json.dumps(str(web / 'vitest.config.ts')) + ';\nexport default { ...config, cacheDir: ' + json.dumps(str(temporary / 'cache')) + ', test: { ...config.test, projects: undefined, include: [' + json.dumps(TARGET) + '], environment: "jsdom", isolate: true, setupFiles: ["src/test/unit/helpers/setupTests.ts"], logHeapUsage: true, reporters: process.env.BENCH_BLOB ? ["default", ' + json.dumps(str(reporter)) + ', ["blob", { outputFile: process.env.BENCH_BLOB }]] : ["default"], coverage: { ...config.test.coverage, thresholds: undefined, reportOnFailure: true, reporter: process.env.BENCH_BLOB ? [] : ["json-summary", "json"], reportsDirectory: process.env.BENCH_COVERAGE } } };\n')
            shutil.copy2(config, output / 'effective-config.mts')
            shutil.copy2(reporter, output / 'effective-reporter.mjs')
            for version, seed in [('baseline', None), ('candidate', None), ('baseline', args.seed), ('candidate', args.seed)]:
                name = version + ('-shuffle' if seed else '-normal')
                print('Starting ' + name, flush=True)
                (web / TARGET).write_bytes(inputs[version])
                current = inventory(web)
                assert {k: v for k, v in current.items() if k != TARGET} == {k: v for k, v in before.items() if k != TARGET}, 'Unchanged-source drift'
                trial_env = env | {'BENCH_REPORT': str(output / (name + '.json')), 'BENCH_BLOB': str(output / (name + '-blobs/blob.json')), 'BENCH_COVERAGE': str(output / (name + '-coverage'))}
                command = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', str(config), '--pool', 'forks', '--maxWorkers', '1', '--coverage', '--shard', '1/1']
                if seed:
                    command += ['--sequence.shuffle', '--sequence.seed', seed]
                cache = temporary / 'cache'
                if cache.exists():
                    shutil.rmtree(cache)
                cache_before = {str(f.relative_to(cache)): {'bytes': f.stat().st_size, 'sha256': digest(f.read_bytes())} for f in cache.rglob('*') if f.is_file()}
                trial = {'name': name, 'sourceHash': digest(inputs[version]), 'cachePolicy': 'clear tempfile-owned optimizer cache before every trial; merge reuses its own trial cache', 'cacheBefore': cache_before, 'environment': {k: v for k, v in trial_env.items() if k.startswith('BENCH_')}, 'test': run(command, web, trial_env, output / (name + '.log'), args.test_timeout)}
                if Path(trial_env['BENCH_BLOB']).is_file() and trial['test']['exit'] not in ('timeout', 'deadline'):
                    merge_env = {k: v for k, v in trial_env.items() if k != 'BENCH_BLOB'}
                    merge_command = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', str(config), '--coverage', '--merge-reports', str(output / (name + '-blobs'))]
                    trial['merge'] = run(merge_command, web, merge_env, output / (name + '-merge.log'), args.merge_timeout)
                trials.append(trial)
                save(output / 'trials.json', trials)
                print(name + ' test=' + str(trial['test']['exit']) + ' merge=' + str(trial.get('merge', {}).get('exit')), flush=True)
                if trial['test']['exit'] in ('timeout', 'deadline') or trial.get('merge', {}).get('exit') in ('timeout', 'deadline'):
                    break
            comparisons = [attach_runtime_status(compare(output, 'baseline-normal', 'candidate-normal'), trials), attach_runtime_status(compare(output, 'baseline-shuffle', 'candidate-shuffle'), trials)]
            result = {'success': len(gates) == 2 and all(g['exit'] == 0 for g in gates) and len(trials) == 4 and all(t['test']['exit'] == 0 and t.get('merge', {}).get('exit') == 0 for t in trials) and all(c['equivalent'] and c['allTestsPassed'] for c in comparisons), 'complete': len(trials) == 4 and all(t['test']['exit'] not in ('timeout', 'deadline') and t.get('merge', {}).get('exit') not in (None, 'timeout', 'deadline') for t in trials), 'comparisonVerified': all(c['comparisonVerified'] for c in comparisons), 'incompleteReason': 'overall deadline exhausted' if time.monotonic() >= DEADLINE else ('bounded command timeout' if any(t['test']['exit'] == 'timeout' or t.get('merge', {}).get('exit') == 'timeout' for t in trials) else None), 'comparisons': comparisons, 'trials': [{'name': t['name'], 'testExit': t['test']['exit'], 'mergeExit': t.get('merge', {}).get('exit')} for t in trials], 'gates': [{'name': g['name'], 'exit': g['exit']} for g in gates], 'cachePolicy': 'symmetric cold optimizer cache per trial', 'performanceAcceptance': False}
    except Exception as error:
        result['error'] = repr(error)
        raise
    finally:
        (web / TARGET).write_bytes(original)
        result['originalSpecRestored'] = (web / TARGET).read_bytes() == original
        result['sourceInventoryRestored'] = inventory(web) == before
        save(output / 'result.json', result)
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result['success'] and result['sourceInventoryRestored'] else 1


def interrupted(signum, frame):
    raise SystemExit(128 + signum)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
