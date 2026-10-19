# 简历工坊 · Resume Studio

上传简历（图片 / PDF），识别并整理成网页简历，由管理员编辑和批注，再通过独立密码分享给本人在线查看。

- **管理员**：用管理员密码登录，可上传、编辑、批注、配置模型和管理分享密码。
- **游客**：在首页只输入查看密码，或打开某份简历的分享链接后输入密码，只能阅读对应简历、批注与原件。不能查看简历列表、上传或修改。
- 每份简历使用不同的查看密码。已有简历默认锁定；在简历页的「分享与密码」中设置密码后开放查看。重设密码或关闭分享，会撤销此前的查看会话。查看密码以加盐哈希保存，无法回显。
- 不提供 PDF 导出，PDF 仍可作为上传格式。

## 本地运行

需要 Python 3.11 或更新版本。解压项目后，在项目目录执行：

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

在根目录 `.env` 或部署环境变量中配置：

```dotenv
ADMIN_PASSWORD=请换成自己设置的长随机管理员密码
DASHSCOPE_API_KEY=...
DEEPSEEK_API_KEY=...
```

```sh
./run.sh
```

打开 [本地站点](http://localhost:8765)，点击「管理员登录」。管理员密码未配置时不会启用默认密码。模型密钥也可在管理员页面的「设置」中填写；没有模型密钥时，管理员仍可用示例简历体验。

## 部署到站点

这是包含 FastAPI 后端的站点，需要运行 Python 服务，不能只上传 `static/` 到静态托管。用反向代理将同一域名下的全部请求转发到应用：

```sh
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8765 --workers 1
```

部署环境需设置 `ADMIN_PASSWORD`；启用 HTTPS 后同时设置 `COOKIE_SECURE=true`。`data/`（或 `RESUME_DATA_DIR` 指定目录）必须使用持久化磁盘，保存简历、原件和查看密码哈希；不要将其额外挂为静态目录。将 `.env`、数据目录排除在公开文件和版本库之外。

部署压缩包包含项目代码、字体、示例、依赖清单与 `.env.example`，不包含本地 `.env`、虚拟环境和已上传的简历数据。新服务器需要重新填写配置；如需迁移已有简历及批注，单独迁移整个数据目录。

当前会话、登录限流和识别任务保存在单进程内存中，使用 **一个 worker**。会话有效期为 8 小时，重启后需重新登录或输入查看密码；已保存的简历、批注与查看密码保留。更换管理员密码后，原有管理员会话失效。

可选配置：`QWEN_MODEL`（默认 `qwen3.6-plus`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`RESUME_DATA_DIR`（默认 `./data`）、`COOKIE_SECURE`（本地默认 `false`）。

## 验证

```sh
.venv/bin/python -m unittest discover -s tests -v
```

`shoot.py` 可在配置管理员密码后用 Playwright 走查页面（需要 Node.js，执行 `npm install --no-save playwright` 并安装 Chromium，或设置 `CHROME_PATH` 指向已有 Chrome），仅使用示例简历，不调用模型。

浏览器回归脚本还包括 `tests/browser_dialogs.cjs`（弹窗尺寸与滚动）和 `tests/browser_annotation_size.cjs`（长批注完整显示）。使用隔离的测试服务运行，设置 `BASE_URL` 和对应的 `ADMIN_PASSWORD`，再通过 Node.js 执行脚本；测试会删除自己创建的示例简历。
