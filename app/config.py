"""Settings: API keys / models from process env, overridable via ./.env (written by the settings modal)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
KEYS = ["DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "QWEN_MODEL", "DEEPSEEK_MODEL", "DASHSCOPE_BASE_URL", "DEEPSEEK_BASE_URL"]
DEFAULTS = {
    "QWEN_MODEL": "qwen3.6-plus",
    "DEEPSEEK_MODEL": "deepseek-chat",
    "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
}


def _read_env_file():
    out = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get(key):
    """process env wins, then .env, then defaults."""
    v = os.environ.get(key)
    if v:
        return v
    return _read_env_file().get(key) or DEFAULTS.get(key, "")


def save(updates: dict):
    cur = _read_env_file()
    for k, v in updates.items():
        if k not in KEYS or v is None:
            continue
        v = str(v).strip()
        if v:
            cur[k] = v
        else:
            cur.pop(k, None)
    ENV_FILE.write_text("".join(f"{k}={v}\n" for k, v in cur.items()))
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass


def mask(v):
    if not v:
        return ""
    return v[:3] + "••••" + v[-4:] if len(v) > 10 else "••••"


def public():
    return {
        "dashscope": bool(get("DASHSCOPE_API_KEY")),
        "deepseek": bool(get("DEEPSEEK_API_KEY")),
        "dashscope_masked": mask(get("DASHSCOPE_API_KEY")),
        "deepseek_masked": mask(get("DEEPSEEK_API_KEY")),
        "qwen_model": get("QWEN_MODEL"),
        "deepseek_model": get("DEEPSEEK_MODEL"),
        "ready": bool(get("DASHSCOPE_API_KEY") and get("DEEPSEEK_API_KEY")),
    }
