import asyncio
import io
import json
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from . import config, pipeline

ROOT = config.ROOT
DATA = ROOT / "data"
STATIC = ROOT / "static"
FIXTURE = ROOT / "fixtures" / "sample_resume.json"
FIXTURE_IMG = ROOT / "fixtures" / "sample.webp"
DATA.mkdir(exist_ok=True)
PORT = 8765

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


@app.post("/api/jobs")
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


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404)
    return {k: v for k, v in j.items() if k != "started"} | {"elapsed": round(time.time() - j["started"], 1)}


# ---------------------------------------------------------------- docs
@app.get("/api/docs")
def list_docs():
    out = []
    for f in sorted(DATA.glob("*/doc.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]:
        d = json.loads(f.read_text())
        out.append({"id": d["id"], "name": d.get("name"), "updated": d.get("updated"),
                    "annotations": len(d.get("annotations", [])), "demo": d.get("demo", False)})
    return out


@app.get("/api/docs/{did}")
def get_doc(did: str):
    f = doc_dir(did) / "doc.json"
    if not f.exists():
        raise HTTPException(404)
    return JSONResponse(json.loads(f.read_text()))


@app.put("/api/docs/{did}")
def put_doc(did: str, payload: dict = Body(...)):
    if not (doc_dir(did) / "doc.json").exists():
        raise HTTPException(404)
    fields = {k: payload[k] for k in ("resume", "annotations", "name", "template") if k in payload}
    if "resume" in fields:
        fields["resume"] = pipeline.normalize(fields["resume"])
    save_doc(did, **fields)
    return {"ok": True}


@app.delete("/api/docs/{did}")
def delete_doc(did: str):
    import shutil
    d = doc_dir(did)
    if d.exists():
        shutil.rmtree(d)
    return {"ok": True}


@app.get("/api/docs/{did}/transcript")
def transcript(did: str):
    f = doc_dir(did) / "transcript.md"
    return Response(f.read_text() if f.exists() else "", media_type="text/plain; charset=utf-8")


_pw = {"p": None, "b": None, "lock": asyncio.Lock()}


async def browser():
    async with _pw["lock"]:
        if _pw["b"] is None or not _pw["b"].is_connected():
            from playwright.async_api import async_playwright
            _pw["p"] = await async_playwright().start()
            _pw["b"] = await _pw["p"].chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        return _pw["b"]


@app.get("/api/docs/{did}/pdf")
async def export_pdf(did: str, annotations: int = 0):
    d = get_doc(did)
    b = await browser()
    page = await b.new_page()
    try:
        await page.goto(f"http://127.0.0.1:{PORT}/print.html?id={did}&ann={annotations}", wait_until="networkidle")
        await page.wait_for_function("window.__READY__ === true", timeout=20000)
        pdf = await page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
    finally:
        await page.close()
    from urllib.parse import quote
    name = quote((json.loads(d.body).get("name") or "resume") + ".pdf")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"})


# ---------------------------------------------------------------- settings
@app.get("/api/settings")
def get_settings():
    return config.public()


@app.post("/api/settings")
def post_settings(payload: dict = Body(...)):
    m = {"dashscope_key": "DASHSCOPE_API_KEY", "deepseek_key": "DEEPSEEK_API_KEY",
         "qwen_model": "QWEN_MODEL", "deepseek_model": "DEEPSEEK_MODEL"}
    config.save({m[k]: v for k, v in payload.items() if k in m and v is not None and not str(v).count("••")})
    return config.public()


app.mount("/data", StaticFiles(directory=DATA), name="data")
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
