"""Check the installed app identity used by macOS keychain authorization."""

import importlib.util
import json
import os
import plistlib
from pathlib import Path
import shlex
import subprocess
import unittest


class AgentChromeIdentity(unittest.TestCase):
    def test_launcher_and_browser_have_the_same_designated_requirement(self):
        app = Path.home() / "Applications/Agent Chrome.app"
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        requirements = []
        for executable in [info["CFBundleExecutable"], "Google Chrome"]:
            result = subprocess.run(
                ["/usr/bin/codesign", "-d", "--requirements", "-", str(app / "Contents/MacOS" / executable)],
                capture_output=True,
                text=True,
                check=True,
            )
            requirements.append(next(
                line for line in (result.stdout + result.stderr).splitlines()
                if line.startswith("designated =>") or line.startswith("# designated =>")
            ))
        self.assertEqual(
            requirements[0], requirements[1],
            "The Dock launcher and running browser must represent the same signed app for keychain approval",
        )
        identity = json.loads((Path.home() / "Library/Application Support/Agent Chrome/automation/signing/identity.json").read_text())["sha1"]
        self.assertIn(f'certificate leaf = H"{identity.lower()}"', requirements[0])

    def test_only_one_launchable_agent_chrome_app_exists(self):
        found = []
        for location in [Path.home() / "Applications", Path("/Applications"), Path.home() / "Library/Application Support/Agent Chrome", Path("/private/tmp")]:
            for directory, names, _ in os.walk(location):
                for name in names[:]:
                    if not name.endswith(".app"):
                        continue
                    if name == "Agent Chrome.app" or name.startswith(".Agent Chrome"):
                        found.append(str(Path(directory) / name))
                    names.remove(name)
        self.assertEqual(found, [str(Path.home() / "Applications/Agent Chrome.app")])

    def test_failed_signing_restores_the_keychain_search_list(self):
        spec = importlib.util.spec_from_file_location("agent_dock_install", Path(__file__).with_name("install-dock.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        command = ["/usr/bin/security", "list-keychains", "-d", "user"]
        original = shlex.split(subprocess.check_output(command, text=True))
        with self.assertRaisesRegex(RuntimeError, "Deliberate signing failure"):
            with module.signing_search_list(module.ROOT / "signing/identity.keychain-db"):
                raise RuntimeError("Deliberate signing failure")
        self.assertEqual(shlex.split(subprocess.check_output(command, text=True)), original)


if __name__ == "__main__":
    unittest.main()
