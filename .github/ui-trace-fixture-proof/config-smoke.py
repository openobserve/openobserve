import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
proof_dir = root / ".github/ui-trace-fixture-proof"
sys.path.insert(0, str(proof_dir))
spec = importlib.util.spec_from_file_location("proof", proof_dir / "run-proof.py")
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)
SMOKE = "import { createVitest } from 'vitest/node';\nimport { isFileServingAllowed } from 'vite';\nimport Measure from './reporter.mjs';\nconst ctx = await createVitest('test', { config: process.env.SMOKE_CONFIG, watch: false, pool: 'forks', maxWorkers: 7, coverage: {enabled: true} });\ntry { const r = new Measure(); r.onInit(ctx); r.onTestRunStart();\nif (process.version !== 'v24.22.0') throw Error('Node version drift');\nif (r.options.projects.map(p => p.name).join(',') !== 'node,jsdom') throw Error('project drift');\nif (r.options.projects.some(p => p.pool !== 'forks' || p.maxWorkers !== 7 || !p.isolate)) throw Error('runtime option drift');\nconsole.log(JSON.stringify(r.options,null,2));\nfor(const p of ctx.projects) {\n if(!isFileServingAllowed(p.config.setupFiles[0],p.vite)) throw Error('setup outside fs.allow');\n for(const file of ['src/plugins/traces/TraceDetails.spec.ts','src/plugins/traces/TraceDetailsSidebar.spec.ts']) {\n if(!isFileServingAllowed(process.cwd()+'/'+file,p.vite)) throw Error('spec outside fs.allow'); }\n}\nconsole.log('CONFIG_SMOKE_PASS_NO_TEST_EXECUTION');\n} finally { await ctx.close(); }\n"

with tempfile.TemporaryDirectory(prefix=".trace-fixture-smoke-", dir=root / "web") as directory:
    directory = Path(directory)
    reporter = directory / "reporter.mjs"
    shutil.copyfile(proof_dir / "reporter.mjs", reporter)
    config = directory / "config.mts"
    config.write_text("import config from " + json.dumps(str(root / "web/vitest.config.ts")) + ";\n"
                      + proof.CONFIG.replace("__FILES__", json.dumps(proof.FILES)).replace("__REPORTER__", json.dumps(str(reporter))))
    script = directory / "smoke.mjs"
    script.write_text(SMOKE)
    result = subprocess.run([shutil.which("node"), str(script)], cwd=root / "web", timeout=45,
                            env=os.environ | {"NODE_ENV": "test", "TZ": "UTC", "SMOKE_CONFIG": str(config),
                                              "BENCH_CACHE": str(directory / "cache"), "BENCH_REPORT": str(directory / "report.json"),
                                              "BENCH_COVERAGE": str(directory / "coverage")})
    sys.exit(result.returncode)
