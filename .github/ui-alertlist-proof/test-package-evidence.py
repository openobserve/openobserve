import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("packager", Path(__file__).with_name("package-evidence.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.destination = self.root / "artifact"

    def manifest(self):
        return json.loads((self.destination / "manifest.json").read_text())

    def test_archive_preserves_bytes_and_hash_inventory(self):
        (self.source / "failure.log").write_text("baseline timeout\n")
        (self.source / "nested").mkdir()
        (self.source / "nested" / "result.json").write_text('{"success":false}\n')
        self.assertTrue(packager.package(self.source, self.destination))
        manifest = self.manifest()
        self.assertTrue(manifest["complete"])
        self.assertEqual(len(manifest["files"]), 2)
        with tarfile.open(self.destination / "evidence.tar.gz", "r:gz") as archive:
            self.assertEqual(archive.getnames(), [entry["path"] for entry in manifest["files"]])
            self.assertEqual(archive.extractfile("failure.log").read(), b"baseline timeout\n")
        self.assertEqual(manifest["files"][0]["sha256"], packager.hashlib.sha256(b"baseline timeout\n").hexdigest())

    def test_empty_evidence_fails_with_diagnostic(self):
        self.assertFalse(packager.package(self.source, self.destination))
        self.assertIn("No evidence", self.manifest()["error"])

    def test_missing_evidence_fails_with_diagnostic(self):
        self.assertFalse(packager.package(self.root / "missing", self.destination))
        self.assertFalse(self.manifest()["complete"])

    def test_symlink_cannot_upload_external_content(self):
        (self.source / "external").symlink_to(__file__)
        self.assertFalse(packager.package(self.source, self.destination))
        self.assertIn("regular files", self.manifest()["error"])

    def test_symlink_directory_is_rejected(self):
        (self.source / "directory").symlink_to(self.root, target_is_directory=True)
        self.assertFalse(packager.package(self.source, self.destination))

    def test_raw_limit_retains_manifest_without_partial_archive(self):
        (self.source / "large").write_bytes(b"0123456789")
        self.assertFalse(packager.package(self.source, self.destination, max_raw=9))
        self.assertIn("raw size", self.manifest()["error"])
        self.assertFalse((self.destination / "evidence.tar.gz").exists())

    def test_compressed_limit_retains_manifest_without_partial_archive(self):
        (self.source / "small").write_text("evidence")
        self.assertFalse(packager.package(self.source, self.destination, max_archive=20))
        self.assertIn("Compressed", self.manifest()["error"])
        self.assertFalse((self.destination / "evidence.tar.gz").exists())

    def write_diagnostics(self):
        files = {
            "proof/result.json": b'{"success":false,"comparisonVerified":false}\n',
            "proof/workers-6-second.json": b'{"tests":[{"name":"case","state":"failed"}]}\n',
            "proof/workers-6-second.json.progress.jsonl": b'{"name":"case","error":"expected row"}\n',
            "proof/workers-6-second.log": b"AssertionError: expected row\n",
            "proof/workers-6-second.resources.txt": b"Maximum resident set size: 123\n",
            "proof/workers-6-second-coverage/coverage-summary.json": b'{"total":{"lines":{"covered":3,"total":5}}}\n',
        }
        for name, data in files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return files

    def assert_diagnostics_preserved(self, files):
        manifest = self.manifest()
        self.assertFalse(manifest["complete"])
        self.assertEqual(manifest["archiveStatus"], "failed")
        self.assertTrue(manifest["diagnostics"]["complete"])
        for name, data in files.items():
            self.assertEqual((self.destination / "diagnostics" / name).read_bytes(), data)
        self.assertFalse((self.destination / "evidence.tar.gz").exists())

    def test_raw_overflow_preserves_failure_details_and_source_counts(self):
        files = self.write_diagnostics()
        (self.source / "optional-blob.json").write_bytes(b"x" * 1024)
        self.assertFalse(packager.package(self.source, self.destination, max_raw=512))
        self.assert_diagnostics_preserved(files)

    def test_compressed_overflow_preserves_failure_details_and_source_counts(self):
        files = self.write_diagnostics()
        self.assertFalse(packager.package(self.source, self.destination, max_archive=20))
        self.assert_diagnostics_preserved(files)

    def test_fallback_rejects_symlinked_parent(self):
        external = self.root / "outside"
        external.mkdir()
        (external / "result.json").write_text("private external content")
        (self.source / "proof").symlink_to(external, target_is_directory=True)
        self.assertFalse(packager.package(self.source, self.destination))
        self.assertEqual(self.manifest()["diagnostics"]["files"], [])
        self.assertFalse(self.manifest()["diagnostics"]["complete"])
        self.assertFalse((self.destination / "diagnostics" / "proof" / "result.json").exists())

    def test_fallback_byte_limits_mark_partial_files_explicitly(self):
        self.write_diagnostics()
        with patch.object(packager, "MAX_DIAGNOSTIC_FILE_BYTES", 8), patch.object(packager, "MAX_DIAGNOSTIC_BYTES", 10):
            self.assertFalse(packager.package(self.source, self.destination, max_raw=1))
        diagnostics = self.manifest()["diagnostics"]
        self.assertFalse(diagnostics["complete"])
        self.assertEqual(diagnostics["bytes"], 10)
        self.assertTrue(diagnostics["omitted"])
        for entry in diagnostics["files"]:
            self.assertTrue(entry["truncated"])
            self.assertTrue(entry["retainedPath"].endswith(".truncated"))
            self.assertLessEqual(entry["bytes"], 8)

    def test_fallback_and_full_archive_file_limits_remain_enforced(self):
        self.write_diagnostics()
        with patch.object(packager, "MAX_DIAGNOSTIC_FILES", 1), patch.object(packager, "MAX_FILES", 1):
            self.assertFalse(packager.package(self.source, self.destination))
        diagnostics = self.manifest()["diagnostics"]
        self.assertEqual(len(diagnostics["files"]), 1)
        self.assertFalse(diagnostics["complete"])
        self.assertIn("file count limit", self.manifest()["error"])

    def test_diagnostic_paths_are_bounded_and_relative(self):
        paths = packager.diagnostic_paths()
        self.assertEqual(len(paths), len(set(paths)))
        self.assertLessEqual(len(paths), packager.MAX_DIAGNOSTIC_FILES)
        self.assertTrue(all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in paths))


if __name__ == "__main__":
    unittest.main()
