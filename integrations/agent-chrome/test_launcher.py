"""Exercise launcher startup with independent processes and a delayed browser."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name("launcher.py")


def load_launcher():
    spec = importlib.util.spec_from_file_location("agent_chrome_launcher", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def worker():
    root = Path(sys.argv[2])
    module = load_launcher()
    module.DIRECTORY = root / "profile"
    module.APP = root / "Agent Chrome.app"
    module.CHROME = root / "chrome"

    def listener():
        started = root / "started"
        if started.exists() and time.monotonic() >= float(started.read_text()) + 0.5:
            return 12345
        return None

    def launch(command, **kwargs):
        if command[0] != "/usr/bin/open" or command[-1] != str(module.APP):
            raise AssertionError(f"Unexpected external command: {command}")
        with (root / "launches").open("a") as file:
            file.write(json.dumps(command) + "\n")
        if (root / "fail").exists():
            raise subprocess.CalledProcessError(1, command)
        (root / "started").write_text(str(time.monotonic()))

    module.checked_listener = listener
    module.subprocess.run = launch
    module.sys.argv = [str(SOURCE), *sys.argv[3:]]
    (root / f"waiting-{os.getpid()}").touch()
    deadline = time.monotonic() + 10
    while not (root / "go").exists():
        if time.monotonic() >= deadline:
            raise RuntimeError("Test workers did not receive the start signal")
        time.sleep(0.01)
    module.main()


class AgentChromeLauncher(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="agent-chrome-launcher-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        (self.root / "chrome").touch()

    def run_launchers(self, count=1, arguments=()):
        (self.root / "go").unlink(missing_ok=True)
        for waiting in self.root.glob("waiting-*"):
            waiting.unlink()
        processes = [subprocess.Popen(
            [sys.executable, "-B", str(Path(__file__).resolve()), "--worker", str(self.root), *arguments],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ) for _ in range(count)]
        try:
            deadline = time.monotonic() + 10
            while len(list(self.root.glob("waiting-*"))) < count:
                if time.monotonic() >= deadline or any(process.poll() is not None for process in processes):
                    self.fail("Launcher workers failed before the start signal")
                time.sleep(0.01)
            (self.root / "go").touch()
            results = [process.communicate(timeout=10) for process in processes]
            return [(process.returncode, result[1]) for process, result in zip(processes, results)]
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def launches(self):
        path = self.root / "launches"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_concurrent_startup_opens_one_browser(self):
        results = self.run_launchers(8)
        self.assertTrue(all(code == 0 for code, _ in results), results)
        self.assertEqual(len(self.launches()), 1, "Simultaneous MCP startups must share one browser launch")

    def test_cold_launch_delivers_the_initial_macos_open_event(self):
        self.assertEqual(self.run_launchers()[0][0], 0)
        self.assertEqual(self.launches(), [["/usr/bin/open", "-na", str(self.root / "Agent Chrome.app")]])

    def test_existing_browser_is_reused_without_a_launch(self):
        (self.root / "started").write_text(str(time.monotonic() - 1))
        results = self.run_launchers(4)
        self.assertTrue(all(code == 0 for code, _ in results), results)
        self.assertEqual(self.launches(), [])

    def test_check_does_not_create_a_profile_or_launch_a_browser(self):
        result = self.run_launchers(arguments=("--check",))[0]
        self.assertNotEqual(result[0], 0)
        self.assertIn("Agent Chrome is not running", result[1])
        self.assertEqual(self.launches(), [])
        self.assertFalse((self.root / "profile").exists())

    def test_failed_launch_does_not_block_the_next_attempt(self):
        (self.root / "fail").touch()
        self.assertNotEqual(self.run_launchers()[0][0], 0)
        (self.root / "fail").unlink()
        self.assertEqual(self.run_launchers()[0][0], 0)
        self.assertEqual(len(self.launches()), 2)

    def test_foreign_listener_is_rejected_before_contacting_cdp(self):
        module = load_launcher()
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess(
            [], 0, "p123\nn127.0.0.1:9222\n", "",
        )), patch.object(module.subprocess, "check_output", return_value="/other/browser --remote-debugging-port=9222"), \
                patch.object(module.urllib.request, "build_opener", side_effect=AssertionError("Unverified CDP access")):
            with self.assertRaisesRegex(RuntimeError, "not owned by standard Google Chrome"):
                module.checked_listener()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--worker"]:
        worker()
    else:
        unittest.main()
