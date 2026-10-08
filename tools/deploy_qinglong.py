#!/usr/bin/env python3
"""Sync maintained sources into an existing QingLong scripts directory."""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


SOURCE_ROOT = Path(__file__).resolve().parent.parent
MANIFESTS = ("package.json", "package-lock.json", "requirements.txt")
SOURCE_SUFFIXES = {".js", ".py", ".sh"}


def release_files():
    files = [p for p in SOURCE_ROOT.iterdir() if p.is_file() and p.suffix in SOURCE_SUFFIXES]
    for directory in ("function", "utils"):
        files.extend(
            p for p in (SOURCE_ROOT / directory).rglob("*")
            if p.is_file() and p.suffix in SOURCE_SUFFIXES
            and p.relative_to(SOURCE_ROOT).as_posix() != "function/user.js"
        )
    files.extend(SOURCE_ROOT / name for name in MANIFESTS)
    return sorted(files)


def sync_sources(target):
    if not target.is_absolute():
        raise ValueError("Target must be an absolute scripts directory")
    target = target.resolve()
    if target.parent.name != "scripts" or not re.fullmatch(r"[A-Za-z0-9._-]+", target.name):
        raise ValueError("Target must be a named directory directly under scripts")
    if target == SOURCE_ROOT or SOURCE_ROOT in target.parents:
        raise ValueError("Target must be outside the source checkout")

    files = release_files()
    if not all(p.is_file() for p in files):
        raise ValueError("Source checkout is missing a required manifest")
    target.mkdir(parents=True, exist_ok=True)
    changed = 0
    for source in files:
        destination = target / source.relative_to(SOURCE_ROOT)
        if destination.is_symlink() or not destination.parent.resolve().is_relative_to(target):
            raise ValueError(f"Refusing a destination outside the target directory: {destination}")
        content = source.read_bytes()
        if destination.is_file() and destination.read_bytes() == content:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".jdpro-sync-", delete=False
            ) as output:
                temporary = Path(output.name)
                output.write(content)
            os.chmod(temporary, source.stat().st_mode & 0o777)
            os.replace(temporary, destination)
            changed += 1
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    print(f"Synced {len(files)} release files ({changed} updated) to {target}", flush=True)
    return target


def install_dependencies(target):
    node = subprocess.check_output(["node", "--version"], text=True).strip()
    if int(node.lstrip("v").split(".")[0]) < 22:
        raise ValueError(f"Node.js >=22 is required; found {node}")
    lock_digest = hashlib.sha256((target / "package-lock.json").read_bytes()).hexdigest()
    marker = target / "node_modules" / ".jdpro-lock.sha256"
    changed = not marker.is_file() or marker.read_text().strip() != lock_digest
    backup = None
    if changed and marker.parent.exists():
        if marker.parent.is_symlink():
            raise ValueError("Refusing to replace a symlinked dependency directory")
        backup = Path(tempfile.mkdtemp(dir=target, prefix=".jdpro-deps-backup-"))
        os.replace(marker.parent, backup / "node_modules")

    try:
        version = importlib.metadata.version("requests")
        parts = tuple(int(x) for x in version.split(".")[:3])
        requests_ready = (2, 32, 4) <= parts < (3,)
    except (importlib.metadata.PackageNotFoundError, ValueError):
        requests_ready = False
    try:
        if changed:
            print(f"Installing locked Node dependencies with {node}", flush=True)
            subprocess.run(
                ["npm", "ci", "--ignore-scripts", "--omit=optional", "--omit=dev",
                 "--bin-links=false", "--no-audit", "--no-fund"], cwd=target, check=True,
            )
            marker.parent.mkdir(exist_ok=True)
            marker.write_text(lock_digest + "\n")
        else:
            print("Locked Node dependencies are already installed", flush=True)
        if not requests_ready:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                 "--no-input", "-r", str(target / "requirements.txt")], cwd=target, check=True,
            )
    except (OSError, subprocess.SubprocessError):
        if changed:
            shutil.rmtree(marker.parent, ignore_errors=True)
            if backup:
                os.replace(backup / "node_modules", marker.parent)
        raise
    finally:
        if backup:
            shutil.rmtree(backup, ignore_errors=True)
    print("Runtime dependencies ready", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--install-deps", action="store_true")
    args = parser.parse_args()
    snapshot = {}
    target = args.target.resolve()
    try:
        # Snapshot only managed release files; account caches/configuration never
        # enter the transaction. Validation in sync_sources precedes any mutation.
        if args.target.is_absolute() and target.parent.name == "scripts" and re.fullmatch(r"[A-Za-z0-9._-]+", target.name) and target != SOURCE_ROOT and SOURCE_ROOT not in target.parents:
            for source in release_files():
                relative = source.relative_to(SOURCE_ROOT)
                destination = target / relative
                if destination.is_file() and not destination.is_symlink():
                    snapshot[relative] = (destination.read_bytes(), destination.stat().st_mode & 0o777)
                else:
                    snapshot[relative] = None
        target = sync_sources(args.target)
        if args.install_deps:
            install_dependencies(target)
        for source in release_files():
            if (target / source.relative_to(SOURCE_ROOT)).read_bytes() != source.read_bytes():
                raise ValueError("Post-deployment source verification failed")
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE_ROOT, text=True).strip()
        marker = {"commit": commit, "deployedAt": datetime.now(timezone.utc).isoformat(),
                  "sourceCount": len(release_files()),
                  "files": {p.relative_to(SOURCE_ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in release_files()}}
        temporary = target / ".jdpro-deployment.pending"
        temporary.write_text(json.dumps(marker, indent=2) + "\n")
        os.replace(temporary, target / ".jdpro-deployment.json")
        print(f"Verified deployed commit {commit}", flush=True)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        if snapshot and target.is_dir() and not target.is_symlink():
            for relative, previous in snapshot.items():
                destination = target / relative
                if destination.is_symlink() or not destination.parent.resolve().is_relative_to(target):
                    continue
                if previous is None:
                    destination.unlink(missing_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".jdpro-rollback-", delete=False) as output:
                        output.write(previous[0])
                        restored = Path(output.name)
                    os.chmod(restored, previous[1])
                    os.replace(restored, destination)
            print("Managed sources rolled back; runtime caches/configuration preserved", file=sys.stderr)
        print(f"Deployment failed: {error}", file=sys.stderr)
        return getattr(error, "returncode", 1) or 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
