import json
import os
import signal
import subprocess
import sys
import time
import threading

DEADLINE = None

def save(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")

def owned_group(pgid):
    output = subprocess.check_output(['ps', '-eo', 'pid=,pgid=,stat=,comm='], text=True)
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


def sample_group(pgid, stop, samples, errors):
    while not stop.is_set():
        try:
            output = subprocess.check_output(['ps', '-eo', 'pid=,pgid=,stat=,rss='], text=True, timeout=5)
            rows = [line.split() for line in output.splitlines()]
            rss = sum(int(row[3]) for row in rows if len(row) == 4 and row[1] == str(pgid) and not row[2].startswith('Z'))
            samples.append({'time': time.time(), 'rssKiB': rss})
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            errors.append(repr(error))
            return
        stop.wait(0.5)


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
        stop, samples, errors = threading.Event(), [], []
        sampler = threading.Thread(target=sample_group, args=(child.pid, stop, samples, errors))
        sampler.start()
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
            stop.set()
            sampler.join(timeout=6)
            if sampler.is_alive():
                errors.append("Memory sampler did not stop")
            save(log.with_suffix('.memory.json'), {'scope': 'Sum of resident KiB for live owned process-group members; sampled every0.5s, shared pages counted per process; not physical peak/PSS', 'samples': samples, 'errors': errors})
    return {'command': command, 'exit': code, 'wallSeconds': time.monotonic() - started, 'before': before, 'after': {'load': os.getloadavg(), 'time': time.time()}, 'reapedDescendants': descendants, 'remainingOwnedProcesses': owned_group(child.pid), 'processGroupPeakRssKiB': max((s['rssKiB'] for s in samples), default=0), 'memorySamplingErrors': errors}


