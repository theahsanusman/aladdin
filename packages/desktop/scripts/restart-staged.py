"""Restart a verified staged update once; safe if a launcher retries the job.

Use Python 3.11+ and pass the staging manifest path. A failed attempt remains
claimed so a retry can never send another Quit command to the user's app.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path


def digest(bundle):
    with (bundle / "Contents/Resources/app.asar").open("rb") as archive:
        return hashlib.file_digest(archive, "sha256").hexdigest()


def main(manifest_path):
    root = manifest_path.parent
    manifest = json.loads(manifest_path.read_text())
    installed = Path(manifest["installed"])
    actual = digest(installed)
    # A completed install must never be interpreted as permission to quit again.
    if actual == manifest["asarSha256"]:
        return
    if actual != manifest["originalAsarSha256"]:
        raise RuntimeError("Installed application changed since staging; refusing to quit it")
    status = json.loads((root / "activation-status.json").read_text())
    if status["status"] != "waiting-for-user-quit":
        raise RuntimeError("Activation is not awaiting a quit; refusing to restart")
    pending = Path(manifest["pending"])
    if digest(pending) != manifest["asarSha256"]:
        raise RuntimeError("Staged application changed; refusing to quit")
    try:
        with (root / "restart-attempt.json").open("x") as attempt:
            json.dump({"startedAt": time.time(), "asarSha256": manifest["asarSha256"]}, attempt)
    except FileExistsError:
        return

    receipt = {"authorizedByUser": True, "forceKilled": False}
    try:
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(pending)], check=True)
        subprocess.run(["osascript", "-e", 'tell application id "ai.opencode.desktop.dev" to quit'], check=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            status = json.loads((root / "activation-status.json").read_text())
            if status["status"] == "installed-awaiting-user-open":
                break
            if status["status"].startswith("failed"):
                raise RuntimeError(status)
            time.sleep(0.1)
        else:
            raise RuntimeError("Normal quit/update did not finish; application was not force-killed")
        actual = digest(installed)
        if actual != manifest["asarSha256"]:
            raise RuntimeError("Updated archive hash mismatch; refusing to launch")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(installed)], check=True)
        subprocess.run(["open", "-a", str(installed)], check=True)
        receipt.update(installedAsarSha256=actual, openedNormally=True, backup=manifest["backup"])
    except Exception as error:
        receipt.update(error=str(error), openedNormally=False)
        raise
    finally:
        (root / "authorized-restart.json").write_text(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("manifest.json"))
