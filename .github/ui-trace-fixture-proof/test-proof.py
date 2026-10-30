import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('run-proof.py'))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class CoverageGuards(unittest.TestCase):
    def setUp(self):
        self.file = '/web/src/components/CodeQueryEditor.vue'
        self.a = {self.file: {'statementMap': {'0': {}}, 'fnMap': {}, 'branchMap': {'15': proof.EXCEPTION_MAP}, 's': {'0': 2}, 'f': {}, 'b': {'15': [2, 2]}}}
        self.summary = {self.file: {k: {'total': 2} for k in ('lines', 'statements', 'functions', 'branches')}}

    def compare(self, b, allow=False, summary=None):
        return proof.coverage_difference(self.a, b, self.summary, summary or self.summary, allow)

    def test_exact_known_exception_only(self):
        b = copy.deepcopy(self.a)
        b[self.file]['b']['15'][1] = 0
        self.assertFalse(self.compare(b)['accepted'])
        self.assertTrue(self.compare(b, True)['accepted'])
        b[self.file]['b']['15'][0] = 0
        self.assertFalse(self.compare(b, True)['accepted'])

    def test_scope_map_denominator_loss_and_negative_rejected(self):
        for mutation in ('scope', 'map', 'denominator', 'statement', 'negative'):
            with self.subTest(mutation=mutation):
                b, summary = copy.deepcopy(self.a), copy.deepcopy(self.summary)
                if mutation == 'scope': b = {}
                if mutation == 'map': b[self.file]['statementMap']['0'] = {'line': 1}
                if mutation == 'denominator': summary[self.file]['lines']['total'] = 3
                if mutation == 'statement': b[self.file]['s']['0'] = 0
                if mutation == 'negative': b[self.file]['b']['15'][1] = -1
                self.assertFalse(self.compare(b, True, summary)['accepted'])

    def test_raw_counter_changes_retained(self):
        b = copy.deepcopy(self.a)
        b[self.file]['s']['0'] = 3
        result = self.compare(b)
        self.assertTrue(result['accepted'])
        self.assertEqual(result['counterDifferences'][self.file]['s']['candidate']['0'], 3)

    def test_both_directions_and_cpu_must_improve(self):
        trials = [{'name': name, 'run': {'wallSeconds': 20 if commit == proof.BASE else 19}, 'resources': {'cpuSeconds': 30}} for name, commit in proof.TRIALS]
        self.assertTrue(proof.performance_eligible(trials, True))
        self.assertFalse(proof.performance_eligible(trials, False))
        self.assertFalse(proof.performance_eligible(list(reversed(trials)), True))
        trials[2]['resources']['cpuSeconds'] = 31
        self.assertFalse(proof.performance_eligible(trials, True))


class InventoryGuards(unittest.TestCase):
    def setUp(self):
        self.sample = json.loads(Path(__file__).with_name('sample.json').read_text())
        self.runtime = {'node': 'v24.22.0', 'vitest': '4.1.11', 'platform': 'linux', 'availableParallelism': 8, 'cpuCount': 8, 'nodeOptions': None}
        self.cache = Path('/web/cache/trial')
        self.report = {'reason': 'passed', 'errors': [], 'runtime': self.runtime.copy(), 'records': [], 'options': {
            'rootEnvironment': 'jsdom', 'maxWorkers': 7, 'pool': 'forks', 'isolate': True, 'watch': False, 'shuffle': False, 'cacheDir': str(self.cache / 'root'),
            'coverage': {'provider': 'v8', 'thresholds': None, 'include': ['src/**/*.{js,ts,vue}'], 'reporters': [['json', {}], ['json-summary', {}]]}, 'projects': [{'name': name, 'environment': name, 'maxWorkers': 7, 'pool': 'forks', 'isolate': True, 'cacheDir': str(self.cache / name), 'setupFiles': [setup]} for name, setup in [('node', 'setupNodeTests.ts'), ('jsdom', 'setupTests.ts')]]}}
        for file in proof.FILES:
            self.report['records'].append({'file': file, 'project': 'jsdom', 'state': 'passed', 'pool': 'forks', 'tests': [{k: row[k] for k in ('name', 'mode', 'state')} for row in self.sample['cases'] if row['file'] == file]})

    def valid(self):
        return proof.validate_report(self.report, self.sample, self.runtime, self.cache)

    def test_exact_inventory_and_runtime_accepted(self):
        self.assertTrue(self.valid())
        self.assertEqual(len(proof.canonical_cases(self.report)), 369)

    def test_missing_or_skipped_case_rejected(self):
        self.report['records'][0]['tests'].pop()
        self.assertFalse(self.valid())
        self.setUp()
        self.report['records'][1]['tests'][0]['state'] = 'skipped'
        self.assertFalse(self.valid())

    def test_runtime_setup_cache_and_unhandled_errors_rejected(self):
        for mutation in ('workers', 'runtime', 'setup', 'cache', 'error'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == 'workers': self.report['options']['maxWorkers'] = 6
                if mutation == 'runtime': self.report['runtime']['vitest'] = '4.1.10'
                if mutation == 'setup': self.report['options']['projects'][1]['setupFiles'] = ['setupNodeTests.ts']
                if mutation == 'cache': self.report['options']['projects'][1]['cacheDir'] = '/shared-cache'
                if mutation == 'error': self.report['errors'] = [{}]
                self.assertFalse(self.valid())


class ProcessGuards(unittest.TestCase):
    def tearDown(self):
        proof.process.DEADLINE = None

    def test_timeout_reaps_child_and_grandchild(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            script = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); time.sleep(30)"
            result = proof.process.run([sys.executable, '-c', script], root, os.environ.copy(), root / 'run.log', 0.2)
            self.assertEqual(result['exit'], 'timeout')
            self.assertEqual(result['remainingOwnedProcesses'], [])
            self.assertLess(result['wallSeconds'], 7)

    def test_expired_budget_launches_nothing(self):
        proof.process.DEADLINE = time.monotonic() - 1
        with tempfile.TemporaryDirectory() as d:
            result = proof.process.run(['does-not-exist'], Path(d), {}, Path(d) / 'run.log', 120)
            self.assertEqual(result['exit'], 'deadline')

    def test_main_restores_actual_git_files_after_trial_failure(self):
        sample = json.loads(Path(__file__).with_name('sample.json').read_text())
        with tempfile.TemporaryDirectory() as d:
            root, web = Path(d), Path(d) / 'web'
            web.mkdir()
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root).decode().strip()
            for variant in ('baseline', 'candidate'):
                for file in proof.FILES:
                    path = web / file
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(variant)
                subprocess.run(['git', 'add', 'web'], cwd=root, check=True)
                subprocess.run(['git', '-c', 'user.name=Guard', '-c', 'user.email=guard@example.invalid', 'commit', '-qm', variant], cwd=root, check=True)
                sample[variant] = {'commit': git('rev-parse', 'HEAD'), 'webTree': git('rev-parse', 'HEAD:web'), 'files': {'web/' + file: {'blob': git('rev-parse', 'HEAD:web/' + file), 'sha256': proof.digest(variant.encode())} for file in proof.FILES}}
            baseline, candidate = sample['baseline']['commit'], sample['candidate']['commit']
            real_capture, real_read = proof.capture, Path.read_text
            runtime = {'platform': 'linux', 'availableParallelism': 8, 'cpuCount': 8, 'vitest': '4.1.11'}
            def capture(command, cwd):
                if command[-1] == '--version': return (b'11.19.1\n' if command[0] == 'npm' else b'v24.22.0\n')
                if '-e' in command: return json.dumps(runtime).encode()
                return real_capture(command, cwd)
            def read(path, *args, **kwargs):
                return json.dumps(sample) if path.name == 'sample.json' else real_read(path, *args, **kwargs)
            def fail(*args):
                self.assertEqual((web / proof.FILES[0]).read_text(), 'baseline')
                raise RuntimeError('Deliberate trial failure after baseline installation')
            with patch.object(proof, 'BASE', baseline), patch.object(proof, 'CANDIDATE', candidate), patch.object(proof, 'WEB_TREE', sample['candidate']['webTree']), patch.object(proof, 'TRIALS', [('original-first', baseline)]), patch.object(proof, 'capture', capture), patch.object(Path, 'read_text', read), patch.object(proof.process, 'run', fail), patch.dict(os.environ, {}, clear=True), patch.object(proof.shutil, 'which', return_value=sys.executable), patch.object(sys, 'argv', ['proof', '--web', str(web), '--output', str(root / 'out')]):
                self.assertEqual(proof.main(), 1)
            result = json.loads((root / 'out/result.json').read_text())
            self.assertIn('Deliberate trial failure', result['error'])
            self.assertTrue(result['candidateRestoredAndWebClean'])
            self.assertEqual(git('status', '--porcelain', '--', 'web'), '')
            self.assertEqual((web / proof.FILES[0]).read_text(), 'candidate')


if __name__ == '__main__':
    unittest.main()
