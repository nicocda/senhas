"""Copies the sessions exported in the app ("Exportar sesión") from every phone
connected by USB into ml/languages/<language>/data/, without going through any
cloud service.

    .venv\\Scripts\\python pull_sessions.py

Uses `adb exec-out run-as`, which only works with debug builds of the app.
"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path

from signs.catalog import LANGUAGES_DIR

PACKAGE = "com.nicogiordano.senhas"
EXPORTS_DIR = "cache/exports"


def find_adb() -> str:
    for variable in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        sdk = os.environ.get(variable)
        if sdk:
            candidate = Path(sdk) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
            if candidate.exists():
                return str(candidate)
    found = shutil.which("adb")
    if found is None:
        raise SystemExit("adb not found: set ANDROID_HOME or add platform-tools to PATH")
    return found


def adb(adb_path: str, serial: str, *args: str) -> bytes:
    return subprocess.run([adb_path, "-s", serial, *args], capture_output=True, check=True).stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="aed")
    args = parser.parse_args()

    adb_path = find_adb()
    devices = subprocess.run([adb_path, "devices"], capture_output=True, text=True, check=True).stdout
    serials = [line.split()[0] for line in devices.splitlines()[1:] if line.endswith("\tdevice")]
    if not serials:
        raise SystemExit("No devices connected")

    data_dir = LANGUAGES_DIR / args.language / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    # Sessions moved to data/excluded/ (e.g. while learning the letters) are kept
    # out of training: don't bring them back.
    excluded = {path.name for path in (data_dir / "excluded").glob("*.json")}
    for serial in serials:
        try:
            listing = adb(adb_path, serial, "exec-out", "run-as", PACKAGE, "ls", EXPORTS_DIR).decode()
        except subprocess.CalledProcessError:
            print(f"{serial}: app not installed, or not a debug build")
            continue
        names = [name for name in listing.split() if name.startswith(f"{args.language}-") and name.endswith(".json")]
        for name in names:
            if name in excluded:
                print(f"{serial}: {name} (excluded, skipped)")
                continue
            target = data_dir / name
            content = adb(adb_path, serial, "exec-out", "run-as", PACKAGE, "cat", f"{EXPORTS_DIR}/{name}")
            status = "updated" if target.exists() else "new"
            target.write_bytes(content)
            print(f"{serial}: {name} ({len(content) // 1024} KB, {status})")
        if not names:
            print(f"{serial}: no exported sessions")


if __name__ == "__main__":
    main()
