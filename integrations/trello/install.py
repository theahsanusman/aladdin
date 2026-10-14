#!/usr/bin/env python3
"""Install the HQ workflow and configure Aladdin's official Trello connector."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import urllib.request
from urllib.parse import urlparse

SOURCE = Path(__file__).resolve().parent
ROOT = Path.home() / "Library/Application Support/Aladdin Trello"
BACKUPS = ROOT.parent / "Aladdin Trello Backups"
CONFIG = Path.home() / ".config/opencode/opencode.json"


def install(api, configure):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    skill = ROOT / "skills/trello-work"
    skill.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(SOURCE / "skills/trello-work", skill, dirs_exist_ok=True)
    shutil.copyfile(SOURCE / "policy.md", ROOT / "policy.md")
    workflow = ROOT / "workflow.json"
    manifest = json.loads((workflow if workflow.exists() else SOURCE / "workflow.json").read_text())
    for old, name in [("boardId", "board"), ("workspaceId", "workspace"),
                      ("automationMemberId", "automationMember"), ("ownerMemberId", "ownerMember")]:
        if old in manifest:
            manifest.setdefault("objectIds", {})[name] = manifest.pop(old)
    manifest.pop("projectLabelPrefix", None)
    manifest["projectLabelStyle"] = "plain project name"
    manifest.setdefault("lists", {})["pendingReview"] = "Pending Review"
    manifest["completionPolicy"] = "agent submits to Pending Review; human moves to Done"
    manifest["readRequests"] = {
        "boardCards": {"name": "trelloReadCard", "arguments": {
            "action": "list_by_board", "boardIdOrUrl": manifest["boardAri"], "limit": 50}},
        "boardLists": {"name": "trelloReadList", "arguments": {
            "action": "list_by_board", "boardId": manifest["boardAri"], "limit": 50}},
        "boardLabels": {"name": "trelloReadBoard", "arguments": {
            "action": "list_labels", "boardId": manifest["boardAri"], "limit": 100}},
    }
    workflow.write_text(json.dumps(manifest, indent=2) + "\n")
    for directory in [skill, *[item for item in skill.rglob("*") if item.is_dir()]]:
        directory.chmod(0o700)
    for file in [*[item for item in skill.rglob("*") if item.is_file()], ROOT / "policy.md", ROOT / "workflow.json"]:
        file.chmod(0o600)
    backups = list(ROOT.glob("opencode-backup-*.json"))
    if backups or configure:
        BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
        for backup in backups:
            target = BACKUPS / backup.name
            if target.exists():
                raise RuntimeError("A private configuration backup already exists at the destination")
            shutil.move(backup, target)
            target.chmod(0o600)
    if not configure:
        print(json.dumps({"workflow_installed": str(ROOT), "connector_configured": False}))
        return

    url = urlparse(api)
    if url.scheme != "http" or url.hostname != "127.0.0.1" or url.username or url.password or url.path not in ["", "/"]:
        raise RuntimeError("Configuration must target Aladdin's discovered loopback API")
    before = json.loads(CONFIG.read_text())
    permissions = before.get("permission", {})
    if not isinstance(permissions, dict):
        raise RuntimeError("A global permission action needs inspection before adding a scoped Trello rule")
    external = permissions.get("external_directory", "ask")
    external_rules = dict(external) if isinstance(external, dict) else {"*": external}
    external_rules[str(ROOT / "*")] = "allow"
    instructions = list(dict.fromkeys([*before.get("instructions", []), str(ROOT / "policy.md")]))
    skills = list(dict.fromkeys([*before.get("skills", {}).get("paths", []), str(ROOT / "skills")]))
    patch = {
        "mcp": {"trello": {"type": "remote", "url": "https://mcp.trello.com/v1", "enabled": True, "timeout": 20000}},
        "instructions": instructions,
        "skills": {"paths": skills},
        "permission": {"trello_*": "allow", "external_directory": external_rules},
    }
    backup = BACKUPS / ("opencode-backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
    shutil.copyfile(CONFIG, backup)
    backup.chmod(0o600)
    request = urllib.request.Request(api.rstrip("/") + "/global/config", data=json.dumps(patch).encode(),
                                     headers={"Content-Type": "application/json"}, method="PATCH")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=40) as response:
        result = json.load(response)
    assert result["mcp"]["trello"]["url"] == "https://mcp.trello.com/v1"
    assert result["permission"]["trello_*"] == "allow"
    after = json.loads(CONFIG.read_text())
    for key, value in before.items():
        if key not in ["mcp", "instructions", "skills", "permission"]:
            assert after[key] == value, f"Unrelated configuration changed: {key}"
    for key, value in before.get("mcp", {}).items():
        if key != "trello":
            assert after["mcp"][key] == value, f"Unrelated connector changed: {key}"
    for key, value in permissions.items():
        if key not in ["trello_*", "external_directory"]:
            assert after["permission"][key] == value, f"Unrelated permission changed: {key}"
    for key, value in (external if isinstance(external, dict) else {"*": external}).items():
        if key != str(ROOT / "*"):
            assert after["permission"]["external_directory"][key] == value, f"Unrelated folder rule changed: {key}"
    assert all(item in after["instructions"] for item in before.get("instructions", []))
    assert all(item in after["skills"]["paths"] for item in before.get("skills", {}).get("paths", []))
    print(json.dumps({"workflow_installed": str(ROOT), "connector_configured": True,
                      "official_endpoint": "https://mcp.trello.com/v1", "unrelated_settings_preserved": True,
                      "private_backup": str(backup)}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:50481")
    parser.add_argument("--configure", action="store_true")
    args = parser.parse_args()
    install(args.api, args.configure)


if __name__ == "__main__":
    main()
