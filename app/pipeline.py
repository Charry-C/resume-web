"""Recognize (Qwen-VL) -> Structure (DeepSeek JSON mode)."""
import base64
import json
import re

import httpx

from . import config

TRANSCRIBE_PROMPT = """你是一名严谨的简历誊写员。请把图片中的简历内容**逐字、完整、忠实**地转写为 Markdown。
要求：
1. 不改写、不润色、不总结、不补全，保留原有措辞、数字、英文大小写与标点。
2. 原文中所有加粗的文字都用 **加粗** 标出：不仅是条目开头的小标题，**句子中间夹杂的加粗关键短语也必须逐一标出**（加粗字的笔画明显比周围文字更粗更黑）。请逐句检查，不要遗漏。
3. 用 Markdown 标题表示板块（如 ## 实习经历），用 - 表示列表项；“日期 / 名称 / 角色”这类同一行信息用 “ | ” 分隔写在同一行。
4. 图片中被打码、马赛克、灰色或黑色色块遮挡的区域：直接忽略，不要猜测被遮挡的内容，也不要输出“[遮挡]”之类的占位符；被部分遮挡的字只转写能确定的部分。
5. 忽略页眉页脚、页码、水印。
只输出转写结果，不要任何解释。"""

SCHEMA_DOC = r"""
输出一个 JSON 对象，结构严格如下（没有的字段用空字符串或空数组，不要编造）：
{
  "basics": {"name": "", "title": "", "phone": "", "email": "", "location": "",
             "links": [{"label": "", "url": ""}], "summary": ""},
  "sections": [
    {"type": "entries", "kind": "education|experience|project|other", "title": "板块原标题，如 教育背景/实习经历/项目经历",
     "items": [{"start": "2026.07", "end": "2026.10 或 至今", "title": "学校/公司/项目名", "role": "职位/学位专业/角色",
                "location": "", "details": [{"label": "项目介绍/项目背景/技术栈 等原文标签", "text": "该行正文"}],
                "bullets": ["每条要点原文"]}]},
    {"type": "keyvalue", "kind": "skills|other", "title": "技能特长",
     "items": [{"label": "原文标签，如 语言", "text": "原文内容"}]},
    {"type": "list", "kind": "awards|other", "title": "荣誉奖项", "items": ["原文条目"]}
  ]
}
规则：
- 板块顺序、板块标题与原文一致；所有文本逐字取自原文，不得改写、翻译或补充。
- 保留原文中的 **加粗** Markdown 标记（例如要点开头的“**服务端链路**：”和句中加粗短语）。
- 条目开头的“标签：”如果是独立一行的说明（项目介绍、项目背景、技术栈、主修课程等），放进 details，label 不含冒号。
- 日期拆成 start / end；只有一个时间就放 start。
- 条目行若只有“日期 | 职位/岗位”（公司名缺失或被遮挡），把职位放 role，title 留空；不要臆造公司名。
- 要点（bullets）中不要包含行首的“•”“●”“-”符号。
"""


def _img_data_url(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


async def transcribe(pages_png: list[bytes], log) -> str:
    key = config.get("DASHSCOPE_API_KEY")
    if not key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY")
    base = config.get("DASHSCOPE_BASE_URL").rstrip("/")
    model = config.get("QWEN_MODEL")
    parts = []
    candidates = [model] + [m for m in ("qwen3.6-plus", "qwen3-vl-plus", "qwen-vl-max") if m != model]
    async with httpx.AsyncClient(timeout=240) as cli:
        for i, png in enumerate(pages_png):
            for mi, m in enumerate(candidates):
                log(f"Qwen 正在识别第 {i + 1}/{len(pages_png)} 页（{m}）")
                r = await cli.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json={
                    "model": m,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": _img_data_url(png)}},
                        {"type": "text", "text": TRANSCRIBE_PROMPT},
                    ]}],
                })
                if r.status_code == 404 and "model" in r.text and mi + 1 < len(candidates):
                    log(f"模型 {m} 不可用，自动改用 {candidates[mi + 1]}")
                    continue
                if r.status_code != 200:
                    raise RuntimeError(f"Qwen 接口错误 {r.status_code}: {r.text[:300]}")
                candidates = [m]  # stick with the working model for later pages
                break
            parts.append(r.json()["choices"][0]["message"]["content"])
    return "\n\n".join(parts)


async def structure(markdown: str, log) -> dict:
    key = config.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("缺少 DEEPSEEK_API_KEY")
    base = config.get("DEEPSEEK_BASE_URL").rstrip("/")
    model = config.get("DEEPSEEK_MODEL")
    log(f"DeepSeek 正在结构化（{model}）")
    async with httpx.AsyncClient(timeout=180) as cli:
        r = await cli.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json={
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "你把简历文本抽取为 JSON。" + SCHEMA_DOC},
                {"role": "user", "content": "简历原文（Markdown）：\n\n" + markdown + "\n\n请输出 JSON。"},
            ],
        })
    if r.status_code != 200:
        raise RuntimeError(f"DeepSeek 接口错误 {r.status_code}: {r.text[:300]}")
    content = r.json()["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?|```$", "", content.strip()).strip()
    return normalize(json.loads(content))


def normalize(d: dict) -> dict:
    """Make model output safe for the renderer: fill defaults, coerce types, strip bullet glyphs."""
    b = d.get("basics") or {}
    basics = {k: _plain(b.get(k)) if k != "summary" else str(b.get(k) or "") for k in ["name", "title", "phone", "email", "location", "summary"]}
    basics["links"] = [{"label": str(l.get("label", "")), "url": str(l.get("url", ""))}
                       for l in (b.get("links") or []) if isinstance(l, dict)]
    secs = []
    for s in d.get("sections") or []:
        t = s.get("type") if s.get("type") in ("entries", "keyvalue", "list") else "list"
        sec = {"type": t, "kind": str(s.get("kind") or "other"), "title": _plain(s.get("title")), "items": []}
        for it in s.get("items") or []:
            if t == "entries" and isinstance(it, dict):
                sec["items"].append({
                    **{k: _plain(it.get(k)) for k in ["start", "end", "title", "role", "location"]},
                    "details": [{"label": _plain(x.get("label")).rstrip("：:"), "text": str(x.get("text", ""))}
                                for x in (it.get("details") or []) if isinstance(x, dict)],
                    "bullets": [re.sub(r"^\s*[•●·\-\*]\s+", "", str(x)) for x in (it.get("bullets") or [])],
                })
            elif t == "keyvalue" and isinstance(it, dict):
                sec["items"].append({"label": _plain(it.get("label")).rstrip("：:"), "text": str(it.get("text", ""))})
            elif t == "list":
                sec["items"].append(re.sub(r"^\s*[•●·\-]\s+", "", it if isinstance(it, str) else json.dumps(it, ensure_ascii=False)))
        secs.append(sec)
    return {"basics": basics, "sections": secs}


def _plain(v) -> str:
    """Header-ish fields carry no inline formatting."""
    return re.sub(r"\*\*", "", str(v or "")).strip()
