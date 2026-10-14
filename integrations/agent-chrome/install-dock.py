#!/usr/bin/env python3
"""Build the local Agent Chrome app, or install it and append its Dock shortcut."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import secrets
import shlex
import shutil
import subprocess
import tempfile
import time
from urllib.parse import unquote, urlparse
import zipfile

SOURCE = Path(__file__).resolve().parent
BUNDLE_ID = "ai.aladdin.agent-chrome"
ROOT = Path.home() / "Library/Application Support/Agent Chrome/automation"
APP = Path.home() / "Applications/Agent Chrome.app"


@contextmanager
def signing_search_list(keychain):
    original = shlex.split(subprocess.check_output([
        "/usr/bin/security", "list-keychains", "-d", "user",
    ], text=True))
    # codesign requires membership even when --keychain is explicit. Expose
    # only our build keychain while signing; never change the default keychain.
    try:
        subprocess.run([
            "/usr/bin/security", "list-keychains", "-d", "user", "-s",
            *original, *([] if str(keychain) in original else [str(keychain)]),
        ], check=True)
        yield
    finally:
        subprocess.run([
            "/usr/bin/security", "list-keychains", "-d", "user", "-s", *original,
        ], check=True)
        restored = shlex.split(subprocess.check_output([
            "/usr/bin/security", "list-keychains", "-d", "user",
        ], text=True))
        if restored != original:
            raise RuntimeError("The original keychain search list was not restored")


def signing_identity(build):
    directory = ROOT / "signing"
    if directory.is_symlink():
        raise RuntimeError("Signing directory must not redirect elsewhere")
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise RuntimeError("Signing directory must belong to the current user")
    directory.chmod(0o700)
    helper = build / "signing-identity"
    subprocess.run([
        "/usr/bin/swiftc", str(SOURCE / "signing-identity.swift"), "-O", "-framework", "Security",
        "-module-cache-path", str(build / "modules"), "-o", str(helper),
    ], check=True)
    keychain = directory / "identity.keychain-db"
    password = directory / "keychain-password"
    certificate = directory / "certificate.pem"
    state = directory / "identity.json"
    if state.exists():
        if any(path.is_symlink() or not path.is_file() for path in [keychain, password, certificate, state]):
            raise RuntimeError("Private signing identity files are missing or redirected")
        subprocess.run([str(helper), str(keychain), str(password)], check=True)
        identity = json.loads(state.read_text())["sha1"]
        fingerprint = subprocess.check_output([
            "/usr/bin/openssl", "x509", "-in", str(certificate), "-noout", "-fingerprint", "-sha1",
        ], text=True).strip().split("=", 1)[1].replace(":", "")
        if identity != fingerprint:
            raise RuntimeError("The persistent signing certificate changed")
        return keychain, identity
    if any(path.exists() for path in [keychain, password, certificate]):
        raise RuntimeError("An incomplete signing identity needs repair; refusing to replace its key")
    password.write_text(secrets.token_hex(32))
    password.chmod(0o600)
    config = build / "signing.cnf"
    config.write_text("""[req]
prompt = no
distinguished_name = name
x509_extensions = signing
[name]
CN = Aladdin Agent Chrome Local Signing
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
""")
    subprocess.run([
        "/usr/bin/openssl", "req", "-new", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "3650",
        "-config", str(config), "-keyout", str(build / "signing-key.pem"), "-out", str(certificate),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([
        "/usr/bin/openssl", "pkcs12", "-export", "-inkey", str(build / "signing-key.pem"),
        "-in", str(certificate), "-out", str(build / "signing.p12"),
        "-name", "Aladdin Agent Chrome Local Signing", "-passout", f"file:{password}",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([str(helper), str(keychain), str(password), str(build / "signing.p12")], check=True)
    identity = subprocess.check_output([
        "/usr/bin/openssl", "x509", "-in", str(certificate), "-noout", "-fingerprint", "-sha1",
    ], text=True).strip().split("=", 1)[1].replace(":", "")
    state.write_text(json.dumps({"sha1": identity}) + "\n")
    for path in [keychain, certificate, state]:
        path.chmod(0o600)
    return keychain, identity


def stage(target):
    if target.exists():
        raise RuntimeError("Stage output already exists; choose a new directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["/bin/cp", "-cR", "/Applications/Google Chrome.app", str(target)], check=True)
    executable = target / "Contents/MacOS/AgentChrome"
    resources = target / "Contents/Resources"
    with tempfile.TemporaryDirectory(prefix="agent-chrome-build-") as directory:
        build = Path(directory)
        subprocess.run([
            "/usr/bin/swiftc", str(SOURCE / "dock-launcher.swift"), "-O", "-swift-version", "5",
            "-target", "arm64-apple-macosx14.0", "-framework", "AppKit",
            "-module-cache-path", str(build / "modules"), "-o", str(executable),
        ], check=True)
        iconset = build / "AgentChrome.iconset"
        iconset.mkdir()
        for size in [16, 32, 128, 256, 512]:
            for scale in [1, 2]:
                pixels = str(size * scale)
                name = f"icon_{size}x{size}" + ("@2x" if scale == 2 else "") + ".png"
                subprocess.run([
                    "/usr/bin/sips", "-z", pixels, pixels,
                    str(SOURCE / "assets/agent-chrome-icon.png"), "--out", str(iconset / name),
                ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "/usr/bin/iconutil", "-c", "icns", str(iconset),
            "-o", str(resources / "AgentChromeBlue.icns"),
        ], check=True)
        keychain, identity = signing_identity(build)
    info = plistlib.loads((target / "Contents/Info.plist").read_bytes())
    info.update({
            "CFBundleIdentifier": BUNDLE_ID,
            "CFBundleName": "Agent Chrome",
            "CFBundleDisplayName": "Agent Chrome",
            "CFBundleExecutable": "AgentChrome",
            "CFBundleIconFile": "AgentChromeBlue",
            "CFBundlePackageType": "APPL",
            "LSMinimumSystemVersion": "14.0",
            "NSPrincipalClass": "NSApplication",
            "NSHighResolutionCapable": True,
        })
    for key in list(info):
        if key.startswith("KS") or key in ["CFBundleIconName", "CFBundleURLTypes", "CFBundleDocumentTypes"]:
            del info[key]
    (target / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    for localized in resources.glob("*.lproj/InfoPlist.strings"):
        localized.unlink()
    subprocess.run(["/usr/bin/xattr", "-cr", str(target)], check=True)
    with signing_search_list(keychain):
        subprocess.run([
            "/usr/bin/codesign", "--force", "--sign", identity, "--keychain", str(keychain),
            "--identifier", BUNDLE_ID, "--requirements", f'=designated => identifier "{BUNDLE_ID}" and certificate leaf = H"{identity}"',
            str(target / "Contents/MacOS/Google Chrome"),
        ], check=True)
        subprocess.run([
            "/usr/bin/codesign", "--force", "--sign", identity, "--keychain", str(keychain),
            "--requirements", f'=designated => identifier "{BUNDLE_ID}" and certificate leaf = H"{identity}"', str(target),
        ], check=True)
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(target)], check=True)
    print(json.dumps({"staged_app": str(target), "bundle_id": BUNDLE_ID}))


def install(source):
    if source == APP.resolve():
        raise RuntimeError("Installation requires a staged copy, not the currently installed app")
    info = plistlib.loads((source / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise RuntimeError("The staged app is not Agent Chrome")
    subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(source)], check=True)
    if not (ROOT / "launcher.py").is_file():
        raise RuntimeError("The isolated Chrome launcher must already be installed")
    if APP.exists():
        existing = plistlib.loads((APP / "Contents/Info.plist").read_bytes())
        if existing.get("CFBundleIdentifier") != BUNDLE_ID:
            raise RuntimeError("Refusing to replace an unrelated app")
        processes = subprocess.check_output(["/bin/ps", "-axww", "-o", "comm="], text=True).splitlines()
        executables = {str(APP / "Contents/MacOS" / name) for name in [existing["CFBundleExecutable"], "Google Chrome"]}
        if any(process.strip() in executables for process in processes):
            raise RuntimeError("Close only Agent Chrome before updating its signed app; no files were replaced")
    snapshot = subprocess.check_output(["/usr/bin/defaults", "export", "com.apple.dock", "-"])
    before = plistlib.loads(snapshot)
    tiles = before.get("persistent-apps", [])
    if not isinstance(tiles, list):
        raise RuntimeError("Dock preferences are not an app list")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = ROOT / f"dock-backup-{stamp}"
    backup.mkdir(mode=0o700)
    (backup / "com.apple.dock.plist").write_bytes(snapshot)
    temporary = APP.with_name(f".Agent Chrome.install-{stamp}.app")
    subprocess.run(["/bin/cp", "-cR", str(source), str(temporary)], check=True)
    previous = backup / "previous-bundle"
    if APP.exists():
        # A compressed rollback is not another launchable application.
        archive = backup / "AgentChrome-rollback.zip"
        subprocess.run([
            "/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(APP), str(archive),
        ], check=True)
        with zipfile.ZipFile(archive) as saved:
            if saved.testzip() is not None:
                raise RuntimeError("The app rollback archive failed validation")
        APP.rename(previous)
    try:
        temporary.rename(APP)
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(APP)], check=True)
    except Exception:
        if APP.exists():
            shutil.rmtree(APP)
        if previous.exists():
            previous.rename(APP)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    (backup / "launcher.py").write_bytes((ROOT / "launcher.py").read_bytes())
    pending_launcher = ROOT / f".launcher-{stamp}.py"
    pending_launcher.write_bytes((SOURCE / "launcher.py").read_bytes())
    pending_launcher.chmod(0o600)
    pending_launcher.replace(ROOT / "launcher.py")
    register = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    subprocess.run([register, "-f", str(APP)], check=True)

    def belongs_to_agent(tile):
        data = tile.get("tile-data", {})
        uri = data.get("file-data", {}).get("_CFURLString", "")
        return data.get("bundle-identifier") == BUNDLE_ID or unquote(urlparse(uri).path).rstrip("/") == str(APP)

    matching = [tile for tile in tiles if belongs_to_agent(tile)]
    if len(matching) > 1:
        raise RuntimeError("Multiple existing Agent Chrome shortcuts need inspection")
    # XML preserves numeric and boolean types. Rebuild our bookmark because
    # replacing the bundle moves the previous app into its private backup.
    tile = {
        "GUID": secrets.randbits(32),
        "tile-data": {
            "file-data": {"_CFURLString": APP.as_uri() + "/", "_CFURLStringType": 15},
            "file-label": "Agent Chrome",
            "bundle-identifier": BUNDLE_ID,
            "file-type": 41,
            "dock-extra": False,
            "is-beta": False,
        },
        "tile-type": "file-tile",
    }
    updated = [tile if belongs_to_agent(item) else item for item in tiles] if matching else tiles + [tile]
    subprocess.run([
        "/usr/bin/defaults", "write", "com.apple.dock", "persistent-apps", "-array",
        *[plistlib.dumps(item).decode() for item in updated],
    ], check=True)
    after = plistlib.loads(subprocess.check_output(["/usr/bin/defaults", "export", "com.apple.dock", "-"]))
    remaining_before = [tile for tile in tiles if not belongs_to_agent(tile)]
    remaining_after = [tile for tile in after["persistent-apps"] if not belongs_to_agent(tile)]
    if remaining_before != remaining_after:
        raise RuntimeError("Other Dock entries changed; preferences backup retained for inspection")
    if sum(belongs_to_agent(tile) for tile in after["persistent-apps"]) != 1:
        raise RuntimeError("The Agent Chrome Dock shortcut was not saved exactly once")
    subprocess.run(["/usr/bin/killall", "Dock"], check=True)
    # The running Dock validates tiles on startup; a pre-restart read is insufficient.
    time.sleep(8)
    restarted = plistlib.loads(subprocess.check_output(["/usr/bin/defaults", "export", "com.apple.dock", "-"]))
    if sum(belongs_to_agent(tile) for tile in restarted["persistent-apps"]) != 1:
        raise RuntimeError("Dock removed the Agent Chrome shortcut after restarting")
    def identity(tile):
        data = tile.get("tile-data", {})
        return data.get("bundle-identifier"), data.get("file-data", {}).get("_CFURLString")
    if [identity(tile) for tile in remaining_before] != [identity(tile) for tile in restarted["persistent-apps"] if not belongs_to_agent(tile)]:
        raise RuntimeError("Other Dock apps changed after restarting; inspect the saved backup")
    if source.is_relative_to(Path(tempfile.gettempdir()).resolve()) or source.is_relative_to(Path("/private/tmp")):
        subprocess.run([register, "-u", str(source)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(source)
    print(json.dumps({
        "app": str(APP), "pinned": True, "other_dock_apps_unchanged": True, "backup": str(backup),
    }))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--stage", type=Path)
    action.add_argument("--install", type=Path)
    args = parser.parse_args()
    if args.stage:
        stage(args.stage.resolve())
        return
    install(args.install.resolve())


if __name__ == "__main__":
    main()
