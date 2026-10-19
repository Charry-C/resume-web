"""End-to-end UI walkthrough + screenshots. usage: python shoot.py [demo|real]"""
import asyncio, sys, json, subprocess
from playwright.async_api import async_playwright
MODE = sys.argv[1] if len(sys.argv) > 1 else "demo"
B = "http://localhost:8765"
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await br.new_context(viewport={"width": 1480, "height": 940}, device_scale_factor=2, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto(B + "/#/"); await pg.wait_for_selector("#drop"); await pg.wait_for_timeout(900)
        if MODE == "demo":
            await pg.screenshot(path="shots/01-landing.png")
            await pg.click("[data-open-settings]"); await pg.wait_for_timeout(400)
            await pg.screenshot(path="shots/02-settings.png"); await pg.keyboard.press("Escape")
            await pg.click("#demoBtn")
        else:
            await pg.set_input_files("#file", "fixtures/sample.webp")
        await pg.wait_for_selector("#stepper li.active"); await pg.wait_for_timeout(1300)
        await pg.screenshot(path=f"shots/03-progress-recognize{'-real' if MODE=='real' else ''}.png")
        await pg.wait_for_selector("#stepper li[data-k=structure].active", timeout=240000); await pg.wait_for_timeout(700)
        await pg.screenshot(path=f"shots/04-progress-structure{'-real' if MODE=='real' else ''}.png")
        await pg.wait_for_selector(".a4 .f", timeout=240000); await pg.wait_for_timeout(1200)
        doc_id = pg.url.split("/")[-1]
        await pg.screenshot(path=f"shots/05-editor{'-real' if MODE=='real' else ''}.png")
        # annotate: one char, one phrase
        async def select_and_annotate(path, needle, note):
            await pg.evaluate("""([path,nd]) => { const el=document.querySelector(`.f[data-path="${path}"]`); const s=el.textContent.indexOf(nd), e=s+nd.length;
              const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let pos=0,n,sn,so,en,eo;
              while((n=w.nextNode())){const L=n.nodeValue.length; if(sn==null&&s<=pos+L){sn=n;so=s-pos} if(e<=pos+L){en=n;eo=e-pos;break} pos+=L}
              el.focus(); const r=document.createRange(); r.setStart(sn,so); r.setEnd(en,eo); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); }""", [path, needle])
            await pg.wait_for_selector(".selpop:not([hidden])"); await pg.wait_for_timeout(250)
            await pg.click(".selpop [data-pop=ann]")
            await pg.keyboard.type(note)
        await select_and_annotate("sections.0.items.0.bullets.0", "agent_hub 模块的设计与开发", "这一句信息量很大，建议拆成“职责 + 结果”两句，并补一个可量化的指标。")
        await select_and_annotate("sections.1.items.0.bullets.3", "92%", "“92%”是在什么基线下测的？面试很可能被追问，建议注明对比对象。")
        await pg.click(".ann-card .sw[data-c='#4f78c4']") if MODE == "demo" else None
        # inline edit: change the basics name
        await pg.click(".f[data-path='basics.name']"); await pg.keyboard.type("林知远")
        await pg.wait_for_timeout(300)
        # show the selection popover over a phrase for the screenshot
        await pg.evaluate("""() => { const el=document.querySelector('.f[data-path="sections.2.items.1.text"]'); const t=el.firstChild;
           el.focus(); const r=document.createRange(); r.setStart(t,2); r.setEnd(t,11); getSelection().removeAllRanges(); getSelection().addRange(r); }""")
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=f"shots/06-editor-annotations{'-real' if MODE=='real' else ''}.png")
        await pg.wait_for_timeout(900)  # autosave
        # reload -> persistence check
        await pg.reload(); await pg.wait_for_selector(".a4 mark.ann"); await pg.wait_for_timeout(600)
        n_marks = await pg.locator(".a4 mark.ann").count(); n_cards = await pg.locator(".ann-card").count()
        name = await pg.inner_text(".f[data-path='basics.name']")
        print("after reload: marks", n_marks, "cards", n_cards, "name", name)
        await pg.click("[data-tab=src]"); await pg.wait_for_timeout(500)
        await pg.click("[data-s=md]"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"shots/07-source-panel{'-real' if MODE=='real' else ''}.png")
        # exports through the UI
        await pg.click("#exportBtn"); await pg.wait_for_timeout(250)
        await pg.screenshot(path=f"shots/08-export-menu{'-real' if MODE=='real' else ''}.png")
        async with pg.expect_download(timeout=60000) as d: await pg.click("[data-exp=pdf]")
        await (await d.value).save_as(f"shots/resume{'-real' if MODE=='real' else ''}.pdf")
        await pg.click("#exportBtn")
        async with pg.expect_download(timeout=60000) as d: await pg.click("[data-exp=pdf-ann]")
        await (await d.value).save_as(f"shots/resume-annotated{'-real' if MODE=='real' else ''}.pdf")
        await pg.click("#exportBtn")
        async with pg.expect_download() as d: await pg.click("[data-exp=json]")
        await (await d.value).save_as(f"shots/resume{'-real' if MODE=='real' else ''}.json")
        print("doc", doc_id, "errors:", errs)
        await br.close()
asyncio.run(main())
