#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import stat
import sys
import tarfile

MAX_FILES = 5000
MAX_RAW_BYTES = 1024 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_DIAGNOSTIC_BYTES = 32 * 1024 * 1024
MAX_DIAGNOSTIC_FILE_BYTES = 4 * 1024 * 1024
MAX_DIAGNOSTIC_FILES = 128


def diagnostic_paths():
    paths = ["proof/result.json", "proof/trials.json", "proof/sample.json", "proof/environment.json", "proof/baseline-cases.json"]
    for version in ("original-first", "candidate-first", "candidate-second", "original-last"):
        paths.extend("proof/" + version + suffix for suffix in (
            ".json", ".json.progress.jsonl", ".log", ".resources.txt", ".launch.json", ".memory.json",
            "-coverage/coverage-summary.json",
        ))
    paths.extend(("host.txt", "install.resources.txt", "install.log",
                  "proof-driver.log", "final-web-diff.txt", "proof/source-inventory.json",
                  "proof/effective-config.mts", "proof/effective-reporter.mjs", "job-timing.json", "source-verification.json", "final-source-verification.json"))
    paths.extend("proof/" + a + "--" + b + "-differences.json" for a, b in (("original-first", "candidate-first"), ("original-last", "candidate-second"), ("original-first", "original-last"), ("candidate-first", "candidate-second")))
    return paths


def retain_diagnostics(source, destination):
    result = {"complete": True, "bytes": 0, "files": [], "omitted": []}
    for name in diagnostic_paths():
        path = source
        try:
            for part in Path(name).parts:
                path = path / part
                mode = path.lstat().st_mode
                if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                    raise ValueError("Diagnostic path must not contain symlinks or special files")
            if not stat.S_ISREG(mode):
                raise ValueError("Diagnostic must be a regular file")
            size = path.stat().st_size
            limit = min(MAX_DIAGNOSTIC_FILE_BYTES, MAX_DIAGNOSTIC_BYTES - result["bytes"])
            if limit <= 0 or len(result["files"]) >= MAX_DIAGNOSTIC_FILES:
                raise ValueError("Diagnostic byte or file count limit reached")
            with path.open("rb") as stream:
                data = stream.read(limit)
            truncated = len(data) < size
            retained = name + (".truncated" if truncated else "")
            target = destination / "diagnostics" / retained
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            result["files"].append({"path": name, "retainedPath": "diagnostics/" + retained,
                                    "originalBytes": size, "bytes": len(data), "truncated": truncated,
                                    "sha256": hashlib.sha256(data).hexdigest()})
            result["bytes"] += len(data)
            result["complete"] = result["complete"] and not truncated
        except FileNotFoundError:
            continue
        except (OSError, ValueError) as error:
            result["complete"] = False
            result["omitted"].append({"path": name, "error": str(error)})
    return result


class LimitedWriter:
    def __init__(self, stream, limit):
        self.stream = stream
        self.limit = limit

    def write(self, data):
        if self.stream.tell() + len(data) > self.limit:
            raise ValueError("Compressed evidence exceeds upload limit")
        return self.stream.write(data)

    def __getattr__(self, name):
        return getattr(self.stream, name)


def package(source, destination, max_raw=MAX_RAW_BYTES, max_archive=MAX_ARCHIVE_BYTES):
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {"complete": False, "archiveStatus": "not completed", "files": [], "rawBytes": 0}
    archive = destination / "evidence.tar.gz"
    try:
        if not source.is_dir() or source.is_symlink():
            raise ValueError("Evidence directory missing or is a symlink")
        manifest["diagnostics"] = retain_diagnostics(source, destination)
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        for path in sorted(source.rglob("*")):
            mode = path.lstat().st_mode
            if stat.S_ISDIR(mode):
                continue
            if not stat.S_ISREG(mode):
                raise ValueError("Evidence must contain only regular files")
            size = path.stat().st_size
            manifest["rawBytes"] += size
            if manifest["rawBytes"] > max_raw or len(manifest["files"]) >= MAX_FILES:
                raise ValueError("Evidence exceeds raw size or file count limit")
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            manifest["files"].append({"path": str(path.relative_to(source)), "bytes": size, "sha256": digest})
        if not manifest["files"]:
            raise ValueError("No evidence produced")
        with archive.open("wb") as stream:
            with tarfile.open(fileobj=LimitedWriter(stream, max_archive), mode="w|gz") as tar:
                for entry in manifest["files"]:
                    tar.add(source / entry["path"], arcname=entry["path"], recursive=False)
        manifest["archiveBytes"] = archive.stat().st_size
        manifest["complete"] = True
        manifest["archiveStatus"] = "complete"
    except (OSError, ValueError) as error:
        archive.unlink(missing_ok=True)
        manifest["error"] = str(error)
        manifest["archiveStatus"] = "failed"
    finally:
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest["complete"]


if __name__ == "__main__":
    sys.exit(0 if package(Path(sys.argv[1]), Path(sys.argv[2])) else 1)
