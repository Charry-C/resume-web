# 简历工坊 · Resume Studio

上传简历（图片 / PDF）→ 通义千问视觉模型逐字誊写（跳过打码区域）→ DeepSeek 结构化为 JSON → 套用模板排版成可编辑、可逐字批注的 A4 电子稿 → 导出矢量 PDF / JSON。

## 运行
    export DASHSCOPE_API_KEY=...  DEEPSEEK_API_KEY=...   # 或在页面右上角「设置」里填写（写入服务端 .env，chmod 600）
    ./run.sh                                              # http://localhost:8765
没有密钥时可以点「用示例简历体验」，示例使用 fixtures/sample_resume.json。

可选环境变量：QWEN_MODEL（默认 qwen3.6-plus，遇到 404 时自动依次回退到 qwen3-vl-plus、qwen-vl-max）、DEEPSEEK_MODEL（默认 deepseek-chat）。

## 结构
- app/pipeline.py：识别提示词、结构化 schema、normalize
- app/main.py：任务、文档、PDF 导出（playwright 渲染 static/print.html）、设置
- static/js/editor.js：可编辑渲染、JSON 绑定、批注锚定（path + 纯文本偏移 + quote 重新锚定）
- static/js/templates/：模板注册表。新增模板 = 写一个 {id,name,css,render(resume,h)} 并加入 index.js
- shoot.py：端到端 UI 走查 + 截图（`python shoot.py demo|real`）
