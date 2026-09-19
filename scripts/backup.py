"""Export a completed PocketBase backup, never copy a live SQLite database."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile


def main():
    os.umask(0o077)
    base = os.environ.get("PB_URL", "http://127.0.0.1:8090").rstrip("/")
    email = os.environ.get("PB_ADMIN_EMAIL")
    password = os.environ.get("PB_ADMIN_PASSWORD")
    if not email or not password:
        raise RuntimeError("Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD before backing up.")

    def api(path, body=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = token
        req = urllib.request.Request(base + path, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()
            return json.loads(data) if data else None

    token = api("/api/collections/_superusers/auth-with-password",
                {"identity": email, "password": password})["token"]
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    suffix = uuid.uuid4().hex[:8]
    name = f"pb_backup_{stamp.replace('-', '_')}_{suffix}.zip"
    api("/api/backups", {"name": name}, token)
    deadline = time.monotonic() + 300
    while not any(item["key"] == name for item in api("/api/backups", token=token)):
        if time.monotonic() >= deadline:
            raise RuntimeError("PocketBase backup did not finish within five minutes.")
        time.sleep(1)

    destination = Path(os.environ.get("BACKUP_DIR", "data/backups")).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".partial-", dir=destination))
    try:
        file_token = api("/api/files/token", {}, token)["token"]
        url = base + "/api/backups/" + name + "?token=" + urllib.parse.quote(file_token)
        archive = staging / "pocketbase.zip"
        with urllib.request.urlopen(url, timeout=300) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        with zipfile.ZipFile(archive) as backup:
            if backup.testzip() is not None or "data.db" not in backup.namelist():
                raise RuntimeError("PocketBase backup failed integrity validation.")
        # Explicit directories avoid recursion when BACKUP_DIR is under data/.
        for directory in ("places", "gtfs", "recordings"):
            source = Path("data") / directory
            if source.exists():
                if destination == source.resolve() or source.resolve() in destination.parents:
                    raise RuntimeError("BACKUP_DIR cannot be inside a supplementary data directory.")
                shutil.copytree(source, staging / directory)
        (staging / "manifest.json").write_text(json.dumps({
            "created_utc": stamp, "pocketbase_version": "0.40.4", "source_backup": name
        }, indent=2) + "\n")
        snapshot = destination / f"snapshot-{stamp}-{suffix}"
        staging.rename(snapshot)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    # Only prune snapshots created by this script, after a successful backup.
    snapshots = sorted((p for p in destination.iterdir()
                        if re.fullmatch(r"snapshot-\d{8}-\d{6}-[0-9a-f]{8}", p.name)
                        and p.is_dir() and not p.is_symlink()
                        and (p / "manifest.json").is_file()), reverse=True)
    for old in snapshots[7:]:
        shutil.rmtree(old)
    print(f"Backup written to {snapshot}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        # HTTPError strings include the download URL's token; do not print it.
        sys.exit(f"Backup failed: PocketBase returned HTTP {error.code}.")
    except Exception as error:
        sys.exit(f"Backup failed: {error}")
