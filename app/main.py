import asyncio
import io
import json
import time
import hmac
import secrets
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body, Request, Depends
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from . import config, pipeline, auth

ROOT = config.ROOT
DATA = Path(config.get("RESUME_DATA_DIR") or ROOT / "data")
STATIC = ROOT / "static"
FIXTURE = ROOT / "fixtures" / "sample_resume.json"
FIXTURE_IMG = ROOT / "fixtures" / "sample.webp"
DATA.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Resume Studio")
JOBS: dict[str, dict] = {}


# ---------------------------------------------------------------- helpers
def doc_dir(did: str) -> Path:
    if not did.isalnum():
        raise HTTPException(404)
    return DATA / did


def to_pngs(raw: bytes, filename: str) -> list[bytes]:
    if filename.lower().endswith(".pdf") or raw[:4] == b"%PDF":
        import pymupdf
        doc = pymupdf.open(stream=raw, filetype="pdf")
        out = []
        for page in list(doc)[:6]:
            out.append(page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).tobytes("png"))
        return out
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if max(im.size) > 2600:
        im.thumbnail((2600, 2600))
    elif max(im.size) < 1600:  # small screenshots: upscale for better recognition of small/bold glyphs
        f = 1800 / max(im.size)
        im = im.resize((int(im.width * f), int(im.height * f)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "PNG")
    return [buf.getvalue()]


def fixture_markdown(d: dict) -> str:
    lines = []
    for s in d["sections"]:
        lines.append(f"## {s['title']}")
        for it in s["items"]:
            if s["type"] == "entries":
                date = "-".join(x for x in [it["start"], it["end"]] if x)
                lines.append(" | ".join(x for x in [date, it["title"], it["role"]] if x))
                lines += [f"**{x['label']}：**{x['text']}" for x in it["details"]]
                lines += [f"- {b}" for b in it["bullets"]]
            elif s["type"] == "keyvalue":
                lines.append(f"- **{it['label']}**：{it['text']}")
            else:
                lines.append(f"- {it}")
        lines.append("")
    return "\n".join(lines)


def save_doc(did, **fields):
    d = doc_dir(did); d.mkdir(exist_ok=True)
    f = d / "doc.json"
    cur = json.loads(f.read_text()) if f.exists() else {}
    cur.update(fields); cur["updated"] = time.time()
    f.write_text(json.dumps(cur, ensure_ascii=False, indent=1))
    return cur


@app.middleware("http")
async def private_responses(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if not auth.same_origin(request):
            return JSONResponse({"detail": "不允许跨站请求"}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith(("/api/", "/data/")):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def access_record(did: str) -> dict:
    f = doc_dir(did) / "access.json"
    return json.loads(f.read_text()) if f.exists() else {}


def require_doc(request: Request, did: str):
    user = auth.session(request)
    if user.get("role") == "admin":
        return
    record = access_record(did)
    if (user.get("role") == "guest" and user.get("doc_id") == did
            and record.get("password_hash") and user.get("version") == record.get("version")):
        return
    raise HTTPException(403, "请输入这份简历的查看密码")


@app.get("/api/auth/session")
def current_session(request: Request):
    user = auth.session(request)
    result = {"role": user.get("role", "anonymous"), "admin_configured": bool(config.get("ADMIN_PASSWORD"))}
    if user.get("role") == "guest":
        try:
            require_doc(request, user["doc_id"])
            result["doc_id"] = user["doc_id"]
        except HTTPException:
            result["role"] = "anonymous"
    return result


@app.post("/api/auth/login")
def admin_login(request: Request, payload: dict = Body(...)):
    auth.throttle(request, "login")
    expected = config.get("ADMIN_PASSWORD")
    if not expected:
        raise HTTPException(503, "请先在服务器 .env 中配置 ADMIN_PASSWORD，再登录管理员")
    password = str(payload.get("password", ""))
    if len(password) > 256 or not hmac.compare_digest(password.encode(), expected.encode()):
        raise HTTPException(401, "管理员密码错误")
    response = JSONResponse({"ok": True})
    auth.issue(request, response, "admin", credential=auth.admin_fingerprint())
    return response


@app.post("/api/auth/logout")
def logout(request: Request):
    auth.SESSIONS.pop(request.cookies.get(auth.COOKIE, ""), None)
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE, path="/")
    return response


@app.post("/api/auth/unlock")
def unlock_doc(request: Request, payload: dict = Body(...)):
    auth.throttle(request, "unlock")
    password = str(payload.get("password", ""))
    did = payload.get("doc_id")
    if not password or len(password) > 128:
        raise HTTPException(401, "查看密码错误或分享已关闭")
    candidates = [doc_dir(str(did)) / "access.json"] if did else DATA.glob("*/access.json")
    for f in candidates:
        if not f.exists() or not (f.parent / "doc.json").exists():
            continue
        record = json.loads(f.read_text())
        if record.get("password_hash") and auth.verify(password, record["password_hash"]):
            response = JSONResponse({"doc_id": f.parent.name})
            auth.issue(request, response, "guest", doc_id=f.parent.name, version=record["version"])
            return response
    raise HTTPException(401, "查看密码错误或分享已关闭")


@app.get("/api/docs/{did}/access", dependencies=[Depends(auth.require_admin)])
def get_access(did: str):
    if not (doc_dir(did) / "doc.json").exists():
        raise HTTPException(404)
    return {"enabled": bool(access_record(did).get("password_hash"))}


@app.put("/api/docs/{did}/access", dependencies=[Depends(auth.require_admin)])
def set_access(did: str, payload: dict = Body(...)):
    if not (doc_dir(did) / "doc.json").exists():
        raise HTTPException(404)
    enabled = payload.get("enabled", True)
    password = str(payload.get("password") or "")
    if enabled and not 8 <= len(password) <= 128:
        raise HTTPException(400, "查看密码需要 8–128 个字符")
    if enabled:
        for f in DATA.glob("*/access.json"):
            if f.parent.name != did and auth.verify(password, json.loads(f.read_text()).get("password_hash", "")):
                raise HTTPException(400, "这个密码已用于另一份简历，请为每份简历设置不同密码")
    record = {"version": secrets.token_hex(16), "password_hash": auth.hash_password(password) if enabled else ""}
    f = doc_dir(did) / "access.json"
    f.write_text(json.dumps(record))
    f.chmod(0o600)
    return {"enabled": bool(enabled)}


# ---------------------------------------------------------------- jobs
async def run_job(jid: str, raw: bytes | None, filename: str, demo: bool):
    job = JOBS[jid]
    did = job["doc_id"]
    def log(msg):
        job["log"].append({"t": round(time.time() - job["started"], 1), "msg": msg})
    try:
        d = doc_dir(did); d.mkdir(exist_ok=True)
        job["stage"] = "recognize"
        if demo:
            pngs = to_pngs(FIXTURE_IMG.read_bytes(), "sample.webp")
        else:
            pngs = await asyncio.to_thread(to_pngs, raw, filename)
        for i, p in enumerate(pngs):
            (d / f"page-{i}.png").write_bytes(p)
        job["pages"] = [f"/data/{did}/page-{i}.png" for i in range(len(pngs))]
        log(f"已读取 {len(pngs)} 页")
        if demo:
            log("示例模式：使用预置识别结果（不调用模型）")
            await asyncio.sleep(2.4)
            resume = json.loads(FIXTURE.read_text())
            md = fixture_markdown(resume)
        else:
            md = await pipeline.transcribe(pngs, log)
        (d / "transcript.md").write_text(md)
        log(f"识别完成，共 {len(md)} 字")
        job["stage"] = "structure"
        if demo:
            await asyncio.sleep(2.0)
        else:
            resume = await pipeline.structure(md, log)
        n = sum(len(s["items"]) for s in resume["sections"])
        log(f"结构化完成：{len(resume['sections'])} 个板块，{n} 个条目")
        save_doc(did, id=did, name=job["name"], created=time.time(), template="navy", resume=resume,
                 annotations=[], pages=job["pages"], demo=demo)
        job["stage"] = "done"
    except Exception as e:  # noqa
        job["stage"] = "error"; job["error"] = str(e); log("出错：" + str(e))


@app.post("/api/jobs", dependencies=[Depends(auth.require_admin)])
async def create_job(file: UploadFile | None = File(None), demo: str = Form("")):
    is_demo = demo in ("1", "true")
    raw = None; name = "示例简历"
    if not is_demo:
        if file is None:
            raise HTTPException(400, "请上传文件")
        if not config.public()["ready"]:
            raise HTTPException(400, "尚未配置 API Key")
        raw = await file.read()
        name = file.filename or "简历"
    jid = uuid.uuid4().hex[:12]
    did = uuid.uuid4().hex[:10]
    JOBS[jid] = {"id": jid, "doc_id": did, "stage": "queued", "log": [], "started": time.time(),
                 "name": name.rsplit(".", 1)[0], "pages": [], "demo": is_demo}
    asyncio.create_task(run_job(jid, raw, name, is_demo))
    return {"job_id": jid, "doc_id": did}


@app.get("/api/jobs/{jid}", dependencies=[Depends(auth.require_admin)])
def job_status(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404)
    return {k: v for k, v in j.items() if k != "started"} | {"elapsed": round(time.time() - j["started"], 1)}


# ---------------------------------------------------------------- docs
@app.get("/api/docs", dependencies=[Depends(auth.require_admin)])
def list_docs():
    out = []
    for f in sorted(DATA.glob("*/doc.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]:
        d = json.loads(f.read_text())
        out.append({"id": d["id"], "name": d.get("name"), "updated": d.get("updated"),
                    "annotations": len(d.get("annotations", [])), "demo": d.get("demo", False)})
    return out


@app.get("/api/docs/{did}")
def get_doc(did: str, request: Request):
    require_doc(request, did)
    f = doc_dir(did) / "doc.json"
    if not f.exists():
        raise HTTPException(404)
    return JSONResponse(json.loads(f.read_text()))


@app.put("/api/docs/{did}", dependencies=[Depends(auth.require_admin)])
def put_doc(did: str, payload: dict = Body(...)):
    if not (doc_dir(did) / "doc.json").exists():
        raise HTTPException(404)
    fields = {k: payload[k] for k in ("resume", "annotations", "name", "template") if k in payload}
    if "resume" in fields:
        fields["resume"] = pipeline.normalize(fields["resume"])
    save_doc(did, **fields)
    return {"ok": True}


@app.delete("/api/docs/{did}", dependencies=[Depends(auth.require_admin)])
def delete_doc(did: str):
    import shutil
    d = doc_dir(did)
    if d.exists():
        shutil.rmtree(d)
    return {"ok": True}


@app.get("/api/docs/{did}/transcript")
def transcript(did: str, request: Request):
    require_doc(request, did)
    f = doc_dir(did) / "transcript.md"
    return Response(f.read_text() if f.exists() else "", media_type="text/plain; charset=utf-8")


# ---------------------------------------------------------------- settings
@app.get("/api/settings", dependencies=[Depends(auth.require_admin)])
def get_settings():
    return config.public()


@app.post("/api/settings", dependencies=[Depends(auth.require_admin)])
def post_settings(payload: dict = Body(...)):
    m = {"dashscope_key": "DASHSCOPE_API_KEY", "deepseek_key": "DEEPSEEK_API_KEY",
         "qwen_model": "QWEN_MODEL", "deepseek_model": "DEEPSEEK_MODEL"}
    config.save({m[k]: v for k, v in payload.items() if k in m and v is not None and not str(v).count("••")})
    return config.public()


@app.get("/data/{did}/{filename}")
def source_page(did: str, filename: str, request: Request):
    require_doc(request, did)
    # Only original page images are readable; document and credential files stay private.
    import re
    if not re.fullmatch(r"page-\d+\.png", filename):
        raise HTTPException(404)
    f = doc_dir(did) / filename
    if not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, media_type="image/png")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
