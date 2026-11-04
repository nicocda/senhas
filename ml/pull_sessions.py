"""Copies the recorded sessions from every phone connected by USB into
ml/languages/<language>/data/, without going through any cloud service.

    .venv\\Scripts\\python pull_sessions.py

Reads the app's SQLite database directly (no need to press "Exportar sesión") and
writes each session in the same JSON format the app exports (app/src/dataset/
export.ts, formatVersion 2). Uses `adb exec-out run-as`, which only works with
debug builds of the app.
"""

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from signs.catalog import LANGUAGES_DIR

PACKAGE = "com.nicogiordano.senhas"
DATABASE_DIR = "files/SQLite"
DATABASE_FILES = ("dataset.db", "dataset.db-wal", "dataset.db-shm")
FORMAT_VERSION = 2


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


def copy_database(adb_path: str, serial: str, target: Path) -> Path | None:
    """Copies dataset.db and its WAL files (recent writes live there until SQLite
    checkpoints them). Only the files that exist: `run-as cat` of a missing file
    prints an error message, which would corrupt the copy."""
    try:
        listing = adb(adb_path, serial, "exec-out", "run-as", PACKAGE, "ls", DATABASE_DIR).decode().split()
    except subprocess.CalledProcessError:
        return None
    if "dataset.db" not in listing:
        return None
    for name in DATABASE_FILES:
        if name in listing:
            (target / name).write_bytes(
                adb(adb_path, serial, "exec-out", "run-as", PACKAGE, "cat", f"{DATABASE_DIR}/{name}")
            )
    return target / "dataset.db"


def sessions_from_database(path: Path) -> list[dict]:
    """Same shape as SessionExport in app/src/dataset/export.ts. Sessions without
    takes (abandoned at the start) are skipped; discarded takes are left out."""
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        exports = []
        for session in connection.execute("SELECT * FROM sessions ORDER BY created_at"):
            takes = connection.execute(
                """SELECT id, entry_id, round, started_at, frames, image_width, image_height FROM takes
                   WHERE session_id = ? AND discarded = 0 ORDER BY started_at""",
                (session["id"],),
            ).fetchall()
            if not takes:
                continue
            exports.append(
                {
                    "format": "senhas-session",
                    "formatVersion": FORMAT_VERSION,
                    "exportedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
                    "session": {
                        "id": session["id"],
                        "participant": session["participant"],
                        "dominantHand": session["dominant_hand"],
                        "language": session["language"],
                        "catalogSchema": session["catalog_schema"],
                        "consentAt": session["consent_at"],
                        "createdAt": session["created_at"],
                    },
                    "takes": [
                        {
                            "id": take["id"],
                            "entryId": take["entry_id"],
                            "round": take["round"],
                            "startedAt": take["started_at"],
                            "imageWidth": take["image_width"],
                            "imageHeight": take["image_height"],
                            "frames": json.loads(take["frames"]),
                        }
                        for take in takes
                    ],
                }
            )
        return exports
    finally:
        connection.close()


def file_name(export: dict) -> str:
    """Same name the app gives its exports (UTC date, like JS toISOString)."""
    session = export["session"]
    date = datetime.fromtimestamp(session["createdAt"] / 1000, timezone.utc).strftime("%Y-%m-%d")
    return f"{session['language']}-{session['participant']}-{date}-{session['id'][:8]}.json"


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
        with tempfile.TemporaryDirectory() as temp:
            database = copy_database(adb_path, serial, Path(temp))
            if database is None:
                print(f"{serial}: no database (app not installed, not a debug build, or nothing recorded)")
                continue
            exports = [e for e in sessions_from_database(database) if e["session"]["language"] == args.language]
        for export in exports:
            name = file_name(export)
            if name in excluded:
                print(f"{serial}: {name} (excluded, skipped)")
                continue
            target = data_dir / name
            status = "updated" if target.exists() else "new"
            target.write_text(json.dumps(export), encoding="utf-8", newline="\n")
            print(f"{serial}: {name} ({len(export['takes'])} takes, {status})")
        if not exports:
            print(f"{serial}: no sessions")


if __name__ == "__main__":
    main()
