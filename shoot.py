"""UI walkthrough: pip dependencies + Node.js with Playwright are required.

ADMIN_PASSWORD=... python shoot.py
Optional: BASE_URL, SCREENSHOT_DIR, CHROME_PATH, NODE_PATH.
Only the demo created by the walkthrough is deleted afterwards.
"""
import os
import subprocess
from pathlib import Path

from app import config

if __name__ == "__main__":
    env = dict(os.environ)
    env.setdefault("ADMIN_PASSWORD", config.get("ADMIN_PASSWORD"))
    raise SystemExit(subprocess.call(["node", str(Path(__file__).parent / "tests/browser_access.cjs")], env=env))
