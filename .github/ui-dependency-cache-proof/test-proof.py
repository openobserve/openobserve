import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('proof.py'))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class CacheGuards(unittest.TestCase):
    def test_setup_node_cannot_save_an_ordinary_package_cache(self):
        workflow = Path(__file__).parents[1] / 'workflows/ui-dependency-cache-proof.yml'
        source = workflow.read_text()
        setup = source.split('uses: actions/setup-node@v7', 1)[1].split('      - ', 1)[0]
        self.assertIn('package-manager-cache: false', setup)
        self.assertNotRegex(setup, r'(?m)^\s+cache(?:-dependency-path)?:')
        self.assertNotIn('uses: actions/cache@', source)
        self.assertEqual(source.count('uses: actions/cache/save@'), 1)
        saved = source.split('uses: actions/cache/save@v6', 1)[1].split('      - ', 1)[0]
        self.assertIn('key: ${{ steps.identity.outputs.key }}', saved)

    def test_only_exact_successful_hit_can_skip_install(self):
        self.assertTrue(proof.exact_hit('true', 'expected', 'expected', 'expected', 'success'))
        for hit, matched, primary, outcome in (
            ('', '', 'expected', 'success'), ('false', 'prefix', 'expected', 'success'),
            ('true', 'other', 'expected', 'success'), ('true', 'expected', 'other', 'success'),
            ('true', 'expected', 'expected', 'failure'), ('True', 'expected', 'expected', 'success'),
        ):
            self.assertFalse(proof.exact_hit(hit, matched, primary, 'expected', outcome))

    def test_restore_miss_partial_error_and_invalid_readiness_install_normally(self):
        for hit, matched, outcome, ready in (('', '', 'success', True), ('false', 'prefix', 'success', True), ('true', 'expected', 'failure', True), ('true', 'expected', 'success', False)):
            candidate = proof.Proof.__new__(proof.Proof)
            candidate.web = Path('/unused/web')
            candidate.read = Mock(return_value={'key': 'expected'})
            candidate.run = Mock()
            candidate.end = Mock()
            candidate.readiness = Mock(side_effect=[RuntimeError('invalid tree'), {}] if not ready else None)
            with patch.object(proof, 'remove_modules') as remove:
                candidate.restored('trial', hit, matched, 'expected', outcome)
                remove.assert_called_once_with(candidate.web)
            candidate.run.assert_called_once_with('trial-fallback-npm', ['npm', 'ci'], 80)
            self.assertFalse(candidate.end.call_args.args[1]['warmExactHit'])

    def test_miss_and_error_have_no_warm_savings(self):
        self.assertEqual(proof.amortized(40, 10, 2, 40, 20, 4, 0), -68)
        self.assertEqual(proof.amortized(40, 10, 2, 40, 20, 4, 1), 60)
        self.assertEqual(proof.amortized(40, 10, 2, 40, 20, 4, .5), -4)
        self.assertLess(proof.amortized(40, 50, 2, 40, 20, 4, 1), 0)
        for jobs, rate in ((0, 1), (4, -1), (4, 2)):
            with self.assertRaises(ValueError): proof.amortized(40, 10, 2, 40, 20, jobs, rate)

    def test_removal_refuses_shared_dependency_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory) / 'web'
            web.mkdir()
            shared = Path(directory) / 'shared'
            shared.mkdir()
            (shared / 'retained').write_text('safe')
            (web / 'node_modules').symlink_to(shared)
            with self.assertRaises(ValueError): proof.remove_modules(web)
            self.assertEqual((shared / 'retained').read_text(), 'safe')

    def test_inventory_covers_patch_bytes_modes_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            package = web / 'node_modules/pkg'
            package.mkdir(parents=True)
            (package / 'package.json').write_text('{"name":"pkg","version":"1"}')
            (package / 'patched.js').write_text('first')
            (web / 'patches').mkdir()
            (web / 'patches/pkg.patch').write_text('+++ b/node_modules/pkg/patched.js\n')
            before = proof.inventory(web)
            (package / 'patched.js').write_text('other')
            after = proof.inventory(web)
            self.assertEqual(before['treeDigest'], after['treeDigest'])
            self.assertNotEqual(before['patchedFiles'], after['patchedFiles'])
            (package / 'outside').symlink_to(Path(directory).parent)
            with self.assertRaises(ValueError): proof.inventory(web)


if __name__ == '__main__':
    unittest.main()
