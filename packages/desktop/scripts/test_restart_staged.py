import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RestartStagedTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copy(Path(__file__).with_name("restart-staged.py"), self.root / "restart.py")
        for name, contents in [("installed", b"old"), ("pending", b"new")]:
            archive = self.root / name / "Contents/Resources/app.asar"
            archive.parent.mkdir(parents=True)
            archive.write_bytes(contents)
        self.manifest = {
            "installed": str(self.root / "installed"),
            "pending": str(self.root / "pending"),
            "backup": str(self.root / "backup"),
            "originalAsarSha256": hashlib.sha256(b"old").hexdigest(),
            "asarSha256": hashlib.sha256(b"new").hexdigest(),
        }
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        self.status("installed-awaiting-user-open")
        commands = self.root / "bin"
        commands.mkdir()
        for name in ["osascript", "codesign", "open"]:
            command = commands / name
            command.write_text(f"#!{sys.executable}\n" + '''import json, os, shutil, sys
from pathlib import Path
root = Path(__file__).parent.parent
name = Path(sys.argv[0]).name
with (root / "commands").open("a") as log:
    log.write(name + "\\n")
if name == "codesign" and os.environ.get("FAIL_CODESIGN"):
    sys.exit(1)
if name == "osascript":
    manifest = json.loads((root / "manifest.json").read_text())
    shutil.copyfile(Path(manifest["pending"]) / "Contents/Resources/app.asar", Path(manifest["installed"]) / "Contents/Resources/app.asar")
    (root / "activation-status.json").write_text(json.dumps({"status": "installed-awaiting-user-open"}))
''')
            command.chmod(0o755)
        self.env = {**os.environ, "PATH": str(commands)}

    def status(self, state):
        (self.root / "activation-status.json").write_text(json.dumps({"status": state}))

    def run_restart(self):
        return subprocess.run([sys.executable, str(self.root / "restart.py")], env=self.env, capture_output=True, text=True, timeout=3)

    def commands(self):
        path = self.root / "commands"
        return path.read_text().splitlines() if path.exists() else []

    def test_already_installed_never_quits_or_opens(self):
        (self.root / "installed/Contents/Resources/app.asar").write_bytes(b"new")
        result = self.run_restart()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("osascript", self.commands())
        self.assertNotIn("open", self.commands())

    def test_changed_install_never_quits(self):
        (self.root / "installed/Contents/Resources/app.asar").write_bytes(b"different")
        self.run_restart()
        self.assertNotIn("osascript", self.commands())

    def test_failed_activation_never_quits(self):
        self.status("failed-original-preserved")
        self.run_restart()
        self.assertNotIn("osascript", self.commands())

    def test_repeated_attempt_never_quits(self):
        (self.root / "restart-attempt.json").write_text('{}')
        self.run_restart()
        self.assertNotIn("osascript", self.commands())

    def test_changed_pending_never_quits(self):
        self.status("waiting-for-user-quit")
        (self.root / "pending/Contents/Resources/app.asar").write_bytes(b"different")
        result = self.run_restart()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("osascript", self.commands())

    def test_failed_verification_is_claimed_and_never_quits(self):
        self.status("waiting-for-user-quit")
        self.env["FAIL_CODESIGN"] = "1"
        result = self.run_restart()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("osascript", self.commands())
        self.assertTrue((self.root / "restart-attempt.json").exists())
        result = self.run_restart()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands(), ["codesign"])

    def test_explicit_manifest_path(self):
        (self.root / "installed/Contents/Resources/app.asar").write_bytes(b"new")
        script = Path(__file__).with_name("restart-staged.py")
        result = subprocess.run([sys.executable, str(script), str(self.root / "manifest.json")], env=self.env, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands(), [])

    def test_valid_restart_runs_once(self):
        self.status("waiting-for-user-quit")
        result = self.run_restart()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands().count("osascript"), 1)
        self.assertEqual(self.commands().count("open"), 1)
        result = self.run_restart()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.commands().count("osascript"), 1)
        self.assertEqual(self.commands().count("open"), 1)


if __name__ == "__main__":
    unittest.main()
