#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import stat
import sys
import tarfile

MAX_FILES = 5000
MAX_RAW_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


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
    manifest = {"complete": False, "files": [], "rawBytes": 0}
    archive = destination / "evidence.tar.gz"
    try:
        if not source.is_dir() or source.is_symlink():
            raise ValueError("Evidence directory missing or is a symlink")
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
    except (OSError, ValueError) as error:
        archive.unlink(missing_ok=True)
        manifest["error"] = str(error)
    finally:
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest["complete"]


if __name__ == "__main__":
    sys.exit(0 if package(Path(sys.argv[1]), Path(sys.argv[2])) else 1)
