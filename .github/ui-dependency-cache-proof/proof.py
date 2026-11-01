import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import signal
import stat
import subprocess
import time
import urllib.parse
import urllib.request

import process

PINNED_WEB = 'f8c602b5c7cc9da35f01592badd7354b3e215311'
PROBE = '''
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
(async()=>{const esbuild=require('esbuild');
if(!esbuild.transformSync('const answer: number = 42',{loader:'ts'}).code.includes('42')) throw Error('esbuild');
await import('vite'); await import('vitest/node');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dependency-native-'));
try {fs.writeFileSync(path.join(dir,'input'),'ready');await require('@parcel/watcher').writeSnapshot(dir,path.join(dir,'snapshot'));}
finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify({node:process.version,abi:process.versions.modules,arch:process.arch,platform:process.platform,vitest:require('vitest/package.json').version,vite:require('vite/package.json').version,esbuild:esbuild.version}));
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def exact_hit(hit, matched, primary, expected, outcome):
    return outcome == 'success' and hit == 'true' and matched == primary == expected


def amortized(install, restore, miss_lookup, preparation, cache_save, jobs, hit_rate):
    if jobs <= 0 or not 0 <= hit_rate <= 1 or min(install, restore, miss_lookup, preparation, cache_save) < 0:
        raise ValueError('Invalid cost inputs')
    return jobs * (hit_rate * (install - restore) - (1 - hit_rate) * miss_lookup) - preparation - cache_save


def remove_modules(web):
    target = web / 'node_modules'
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise ValueError('Refuse non-directory node_modules')
    if target.exists():
        shutil.rmtree(target)


def inventory(web):
    root = web / 'node_modules'
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Missing owned installed tree')
    started = time.monotonic()
    rows, packages, patched, total = [], [], {}, 0
    for path in sorted(root.rglob('*')):
        if len(rows) >= 200000 or total > 4 * 1024 ** 3 or time.monotonic() - started > 25:
            raise ValueError('Installed inventory exceeds proof bounds')
        info = path.lstat()
        relative = str(path.relative_to(root))
        mode = stat.S_IMODE(info.st_mode)
        if stat.S_ISLNK(info.st_mode):
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError('Dependency symlink escapes cached tree')
            rows.append([relative, 'link', mode, os.readlink(path)])
        elif stat.S_ISREG(info.st_mode):
            rows.append([relative, 'file', mode, info.st_size])
            total += info.st_size
            if path.name == 'package.json':
                packages.append([relative, digest(path.read_bytes())])
        elif stat.S_ISDIR(info.st_mode):
            rows.append([relative, 'directory', mode])
        else:
            raise ValueError('Unexpected special dependency entry')
    for patch in sorted((web / 'patches').glob('*.patch')):
        for line in patch.read_text().splitlines():
            if line.startswith('+++ b/node_modules/'):
                relative = line.removeprefix('+++ b/node_modules/').split('\t')[0]
                path = root / relative
                if not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError('Invalid patch target')
                patched[relative] = digest(path.read_bytes())
    return {'treeDigest': digest(json.dumps(rows).encode()), 'entries': len(rows), 'bytes': total,
            'packageManifests': packages, 'patchedFiles': patched}


class Proof:
    def __init__(self):
        self.repo = Path(os.environ['GITHUB_WORKSPACE']).resolve()
        self.web = self.repo / 'web'
        self.out = Path(os.environ['RUNNER_TEMP']) / 'dependency-cache-evidence'
        self.out.mkdir(exist_ok=True)
        self.deadline = int(os.environ['PROOF_STARTED']) + 390
        process.DEADLINE = time.monotonic() + max(0, self.deadline - time.time())

    def budget(self, minimum=15):
        if self.deadline - time.time() < minimum:
            raise RuntimeError('Proof budget exhausted; preserve diagnostics')

    def read(self, name):
        return json.loads((self.out / (name + '.json')).read_text())

    def begin(self, name, clean=False):
        self.budget(75 if name in ('save', 'restore-first', 'restore-second', 'cold') else 15)
        if name == 'save':
            for relative, expected in self.read('identity')['inputs'].items():
                path = self.repo / relative
                actual = digest(path.read_bytes()) if path.is_file() else 'absent'
                if actual != expected:
                    raise RuntimeError('Cache input changed before save: ' + relative)
        if clean:
            self.read('identity')
            remove_modules(self.web)
        save(self.out / (name + '-start.json'), {'monotonic': time.monotonic(), 'epoch': time.time()})

    def end(self, name, details):
        elapsed = time.monotonic() - self.read(name + '-start')['monotonic']
        save(self.out / (name + '.json'), {'wallSeconds': elapsed, **details})

    def initialize(self):
        if (self.web / 'node_modules').exists() or (self.web / 'node_modules').is_symlink():
            raise ValueError('Proof requires a fresh job-owned dependency path')
        assert subprocess.check_output(['node', '--version'], text=True, timeout=15).strip() == 'v24.22.0'
        assert subprocess.check_output(['npm', '--version'], text=True, timeout=15).strip() == '11.19.1'
        assert platform.system() == 'Linux'
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD:web'], cwd=self.repo, text=True, timeout=15).strip() == PINNED_WEB
        package = json.loads((self.web / 'package.json').read_text())
        assert package['scripts']['postinstall'] == 'patch-package --error-on-fail'
        assert not any(k in package['scripts'] for k in ('preinstall', 'install', 'prepare'))
        files = [self.repo / '.npmrc', self.web / '.npmrc', self.web / 'package.json', self.web / 'package-lock.json']
        files += sorted((self.web / 'patches').glob('*'))
        files += sorted(Path(__file__).parent.glob('*.py'))
        inputs = {str(p.relative_to(self.repo)): digest(p.read_bytes()) if p.is_file() else 'absent' for p in files}
        config = subprocess.check_output(['npm', 'config', 'list', '--json'], cwd=self.web, timeout=15)
        install_environment = {k: v for k, v in os.environ.items() if k.lower().startswith(('npm_', 'cypress_')) or k in ('NODE_ENV', 'NODE_OPTIONS', 'CI')}
        identity = {'inputs': inputs, 'node': '24.22.0', 'npm': '11.19.1', 'abi': subprocess.check_output(['node', '-p', 'process.versions.modules'], text=True, timeout=15).strip(),
                    'platform': platform.system(), 'architecture': platform.machine(), 'libc': platform.libc_ver(),
                    'osReleaseSha256': digest(Path('/etc/os-release').read_bytes()), 'imageOS': os.environ.get('ImageOS'), 'imageVersion': os.environ.get('ImageVersion'),
                    'npmConfigurationSha256': digest(config), 'installEnvironmentSha256': digest(json.dumps(install_environment, sort_keys=True).encode()),
                    'command': ['npm', 'ci'], 'configuredRunner': 'ubicloud-standard-8', 'actualFamilyNeedsJobLog': True}
        key = 'ui-dependency-proof-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'] + '-' + digest(json.dumps(identity, sort_keys=True).encode())
        identity['key'] = key
        save(self.out / 'identity.json', identity)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('key=' + key + '\n')

    def run(self, label, command, limit):
        self.budget()
        result = process.run(command, self.web, os.environ.copy(), self.out / (label + '.log'), limit)
        save(self.out / (label + '-process.json'), result)
        if result['exit'] != 0 or result['remainingOwnedProcesses']:
            raise RuntimeError(label + ' failed: ' + str(result['exit']))

    def readiness(self, label, reference=True):
        self.run(label + '-native', ['node', '-e', PROBE], 20)
        result = inventory(self.web)
        cache = Path(subprocess.check_output(['node', 'node_modules/cypress/bin/cypress', 'cache', 'path'], cwd=self.web, text=True, timeout=10).strip())
        version = json.loads((self.web / 'node_modules/cypress/package.json').read_text())['version']
        binary = cache / version / 'Cypress/Cypress'
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeError('Prepared Cypress external asset missing')
        result['externalCypress'] = {'cachePathDigest': digest(str(cache).encode()), 'version': version,
                                     'binaryBytes': binary.stat().st_size, 'executable': True}
        save(self.out / (label + '-inventory.json'), result)
        if reference and result != self.read('preparation-inventory'):
            raise RuntimeError('Installed inventory/patch/native readiness differs')
        return result

    def install(self, label):
        self.begin(label, clean=True)
        self.run(label + '-npm', ['npm', 'ci'], 80)
        self.readiness(label, reference=label != 'preparation')
        self.end(label, {'kind': 'install', 'ready': True})

    def restored(self, label, hit, matched, primary, outcome):
        key = self.read('identity')['key']
        exact = exact_hit(hit, matched, primary, key, outcome)
        error = None
        if exact:
            try:
                self.readiness(label)
            except Exception as problem:
                exact, error = False, str(problem)
        if not exact:
            remove_modules(self.web)
            self.run(label + '-fallback-npm', ['npm', 'ci'], 80)
            self.readiness(label + '-fallback')
        self.end(label, {'kind': 'restore', 'warmExactHit': exact, 'actionOutcome': outcome,
                         'cacheHit': hit, 'matchedKey': matched, 'primaryKey': primary, 'readinessError': error})

    def missed(self, hit, matched, primary, outcome):
        expected = self.read('identity')['key'] + '-deliberate-miss'
        lookup = time.monotonic() - self.read('cold-start')['monotonic']
        genuine = outcome == 'success' and hit != 'true' and not matched and primary == expected
        remove_modules(self.web)
        self.run('cold-fallback-npm', ['npm', 'ci'], 80)
        self.readiness('cold-fallback')
        self.end('cold', {'kind': 'cold-fallback', 'genuineMiss': genuine, 'lookupSeconds': lookup,
                          'actionOutcome': outcome, 'cacheHit': hit, 'matchedKey': matched, 'primaryKey': primary})

    def finish(self):
        result = {'complete': False, 'eligible': False, 'productionAcceptance': False, 'fullSuiteAndBillingUnverified': True}
        try:
            identity = self.read('identity')
            query = urllib.parse.urlencode({'key': identity['key'], 'ref': os.environ['GITHUB_REF']})
            request = urllib.request.Request('https://api.github.com/repos/openobserve/openobserve/actions/caches?' + query,
                headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'User-Agent': 'dependency-proof'})
            with urllib.request.urlopen(request, timeout=15) as response:
                entries = json.load(response)['actions_caches']
            entries = [{k: c[k] for k in ('id', 'key', 'ref', 'size_in_bytes')} for c in entries if c['key'] == identity['key'] and c['ref'] == os.environ['GITHUB_REF']]
            save(self.out / 'cache-entry.json', entries)
            a, b, c, d = [self.read(n) for n in ('install-first', 'restore-first', 'restore-second', 'install-last')]
            prep, saved, cold = [self.read(n) for n in ('preparation', 'save', 'cold')]
            paired = b['wallSeconds'] < a['wallSeconds'] and c['wallSeconds'] < d['wallSeconds']
            valid = b['warmExactHit'] and c['warmExactHit'] and cold['genuineMiss'] and len(entries) == 1 and saved['actionOutcome'] == 'success'
            install, restore = (a['wallSeconds'] + d['wallSeconds']) / 2, (b['wallSeconds'] + c['wallSeconds']) / 2
            net_four = amortized(install, restore, cold['lookupSeconds'], prep['wallSeconds'], saved['wallSeconds'], 4, 1.0)
            result.update(complete=True, eligible=bool(valid and paired and net_four > 0), bothPairsFaster=paired,
                eligibilityModel='Four consumers, 100% hits, includes this proof preparation and save cost', exactHitAndMissProof=bool(valid),
                archiveBytes=entries[0]['size_in_bytes'] if len(entries) == 1 else None,
                meanInstallWithValidation=install, meanRestoreWithValidation=restore,
                amortizedSecondsSaved=[{'consumers': n, 'hitRate': h, 'seconds': amortized(install, restore, cold['lookupSeconds'], prep['wallSeconds'], saved['wallSeconds'], n, h)} for n in (4, 20, 100) for h in (0.5, 0.8, 1.0)])
        except Exception as error:
            result['error'] = str(error)
        result['elapsedSecondsBeforeUpload'] = time.time() - int(os.environ['PROOF_STARTED'])
        result['roundedMinutesBeforeUpload'] = math.ceil(result['elapsedSecondsBeforeUpload'] / 60)
        save(self.out / 'result.json', result)
        artifact = Path(os.environ['RUNNER_TEMP']) / 'dependency-cache-artifact'
        artifact.mkdir(exist_ok=True)
        save(artifact / 'result.json', result)
        files = []
        for path in sorted(self.out.iterdir()):
            if not path.is_file() or path.is_symlink():
                raise RuntimeError('Unsafe evidence entry')
            files.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())})
        if len(files) > 128 or sum(f['bytes'] for f in files) > 32 * 1024 * 1024:
            raise RuntimeError('Evidence size limit exceeded')
        for entry in files:
            shutil.copyfile(self.out / entry['file'], artifact / entry['file'])
        save(artifact / 'manifest.json', files)
        print(json.dumps(result, indent=2))
        return result['complete']


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['init', 'install', 'begin', 'save-end', 'restored', 'missed', 'finish'])
    parser.add_argument('arguments', nargs='*')
    args = parser.parse_args()
    proof = Proof()
    if args.command == 'init': proof.initialize()
    elif args.command == 'install': proof.install(*args.arguments)
    elif args.command == 'begin': proof.begin(args.arguments[0], clean=args.arguments[0] != 'save')
    elif args.command == 'save-end': proof.end('save', {'actionOutcome': args.arguments[0]})
    elif args.command == 'restored': proof.restored(*args.arguments)
    elif args.command == 'missed': proof.missed(*args.arguments)
    elif args.command == 'finish': raise SystemExit(0 if proof.finish() else 1)
