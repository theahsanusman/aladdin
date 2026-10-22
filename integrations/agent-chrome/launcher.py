#!/usr/bin/env python3
"""Launch or validate the private, persistent Agent Chrome. Never discover Chrome."""

import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

DIRECTORY = Path.home() / ".agent-chrome"
APP = Path.home() / "Applications/Agent Chrome.app"
CHROME = APP / "Contents/MacOS/Google Chrome"
ENDPOINT = "http://127.0.0.1:9222"
FLAGS = [
    f"--user-data-dir={DIRECTORY}",
    "--remote-debugging-port=9222",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
]


def checked_listener():
    result = subprocess.run(
        ["/usr/sbin/lsof", "-nP", "-a", "-iTCP:9222", "-sTCP:LISTEN", "-Fpn"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 1 and not result.stdout:
        return None
    if result.returncode != 0:
        raise RuntimeError("Cannot verify port 9222 ownership; refusing browser access")
    pids = {line[1:] for line in result.stdout.splitlines() if line.startswith("p")}
    addresses = {line[1:] for line in result.stdout.splitlines() if line.startswith("n")}
    if len(pids) != 1 or addresses != {"127.0.0.1:9222"}:
        raise RuntimeError("Port 9222 is not one IPv4 loopback listener; refusing browser access")
    pid = pids.pop()
    command = subprocess.check_output(["/bin/ps", "-ww", "-p", pid, "-o", "command="], text=True).strip()
    if not command.startswith(f"{CHROME} "):
        raise RuntimeError("Port 9222 is not owned by standard Google Chrome")
    arguments = command[len(str(CHROME)) + 1:].split()
    if any(arguments.count(flag) != 1 for flag in FLAGS):
        raise RuntimeError("Chrome does not have the required isolated data directory and flags")
    for prefix in ["--user-data-dir=", "--remote-debugging-port=", "--remote-debugging-address="]:
        if sum(argument.startswith(prefix) or argument == prefix[:-1] for argument in arguments) != 1:
            raise RuntimeError("Chrome has conflicting isolation flags")
    # Never contact even a localhost CDP endpoint until its OS process is verified.
    request = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with request.open(f"{ENDPOINT}/json/version", timeout=2) as response:
        version = json.load(response)
    if not version.get("webSocketDebuggerUrl", "").startswith("ws://127.0.0.1:9222/devtools/browser/"):
        raise RuntimeError("Chrome returned a different debugger endpoint")
    return int(pid)


def main():
    os.umask(0o077)
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] != "--check"):
        raise RuntimeError("Only --check is supported; custom Chrome arguments are forbidden")
    if DIRECTORY.is_symlink() or DIRECTORY.resolve() != DIRECTORY:
        raise RuntimeError("Agent Chrome data directory must not redirect to another directory")
    if DIRECTORY.exists() and (not DIRECTORY.is_dir() or DIRECTORY.stat().st_uid != os.getuid()):
        raise RuntimeError("Agent Chrome data directory must be owned by the current user")
    if len(sys.argv) == 2:
        pid = checked_listener()
        if not pid:
            raise RuntimeError("Agent Chrome is not running")
        print(f"Agent Chrome ready: {ENDPOINT} (PID {pid}, data {DIRECTORY}, Sync disabled)", file=sys.stderr)
        return
    DIRECTORY.mkdir(mode=0o700, exist_ok=True)
    DIRECTORY.chmod(0o700)
    # Each workspace starts its own MCP. Share one launch until Chrome is ready.
    with (DIRECTORY / ".launch.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid = checked_listener()
        if pid:
            print(f"Agent Chrome ready: {ENDPOINT} (PID {pid}, data {DIRECTORY}, Sync disabled)", file=sys.stderr)
            return
        if not CHROME.is_file():
            raise RuntimeError("Standard Google Chrome is not installed")
        preferences = DIRECTORY / "Default" / "Preferences"
        if not preferences.exists():
            preferences.parent.mkdir(mode=0o700, exist_ok=True)
            preferences.write_text(json.dumps({
                "profile": {"name": "Agent Chrome"},
                "sync": {"requested": False},
                "session": {"restore_on_startup": 1},
            }))
        # The native exec launcher needs a fresh LaunchServices open event.
        subprocess.run(["/usr/bin/open", "-na", str(APP)], check=True)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                pid = checked_listener()
            except (TimeoutError, urllib.error.URLError):
                pid = None
            if pid:
                print(f"Agent Chrome ready: {ENDPOINT} (PID {pid}, data {DIRECTORY}, Sync disabled)", file=sys.stderr)
                return
            time.sleep(0.2)
        raise RuntimeError("Agent Chrome did not open its verified endpoint; no fallback browser was used")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Agent Chrome: {error}", file=sys.stderr)
        sys.exit(1)
