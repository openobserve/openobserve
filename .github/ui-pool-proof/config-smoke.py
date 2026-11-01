import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
proof_dir = root / '.github/ui-pool-proof'
sys.path.insert(0, str(proof_dir))
spec = importlib.util.spec_from_file_location('proof', proof_dir / 'run-proof.py')
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)
sample = json.loads((proof_dir / 'sample.json').read_text())
SMOKE = '''import { createVitest } from 'vitest/node';
import path from 'node:path';
import fs from 'node:fs';
import Measure from './reporter.mjs';
const pool = process.env.BENCH_POOL;
const ctx = await createVitest('test', {config:process.env.SMOKE_CONFIG, watch:false, pool, maxWorkers:7, coverage:{enabled:true}});
try {
 const r=new Measure();r.onInit(ctx);r.onTestRunStart();
 if(process.version!=='v24.22.0')throw Error('Node drift');
 if(r.options.projects.map(p=>p.name).join(',')!=='node,jsdom')throw Error('project drift');
 if(r.options.projects.some(p=>p.pool!==pool||p.maxWorkers!==7||!p.isolate))throw Error('pool/worker/isolation drift');
 const actual=(await ctx.globTestSpecifications()).map(s=>[path.relative(process.cwd(),s.moduleId),s.project.name]).sort();
 const expected=JSON.parse(process.env.SMOKE_FILES).map(s=>[s.file,s.project]).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('cohort differs');
 fs.writeFileSync(process.env.SMOKE_OPTIONS,JSON.stringify(r.options));
 console.log(pool+': CONFIG_SMOKE_PASS_76_FILES_NO_TEST_EXECUTION');
} finally {await ctx.close();}
'''
with tempfile.TemporaryDirectory(prefix='.pool-config-smoke-', dir=root / 'web') as directory:
    directory = Path(directory)
    reporter = directory / 'reporter.mjs'
    shutil.copyfile(proof_dir / 'reporter.mjs', reporter)
    config = directory / 'config.mts'
    config.write_text('import config from ' + json.dumps(str(root / 'web/vitest.config.ts')) + ';\n' + proof.CONFIG.replace('__FILES__', json.dumps([f['file'] for f in sample['files']])).replace('__REPORTER__', json.dumps(str(reporter))))
    script = directory / 'smoke.mjs'
    script.write_text(SMOKE)
    options = []
    for pool in ('forks', 'threads'):
        output = directory / (pool + '.json')
        subprocess.run([shutil.which('node'), str(script)], cwd=root / 'web', timeout=45, check=True,
                       env=os.environ | {'NODE_ENV':'test','TZ':'UTC','SMOKE_CONFIG':str(config),
                           'SMOKE_FILES':json.dumps(sample['files']),'SMOKE_OPTIONS':str(output),
                           'BENCH_POOL':pool,'BENCH_CACHE':str(directory / pool / 'cache'),
                           'BENCH_REPORT':str(directory / 'unused-report.json'),'BENCH_COVERAGE':str(directory / pool / 'coverage')})
        options.append(proof.comparable_options(json.loads(output.read_text())))
    assert options[0] == options[1], 'Unintended resolved-config differences'
