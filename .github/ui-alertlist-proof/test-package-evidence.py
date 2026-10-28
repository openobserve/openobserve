import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
