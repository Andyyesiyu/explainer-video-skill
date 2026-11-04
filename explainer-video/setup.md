# 环境准备和交付检查

## TTS key

`narrate.mjs` 和 `tts/server.mjs` 优先读环境变量 `DOUBAO_API_KEY`，没有就从 macOS 钥匙串取（条目名 `doubao-tts-api-key`），命令里不用带 key。没有 key 时可以用 `node narrate.mjs --no-voice` 做无配音版本（见 SKILL.md「无配音模式」）。

- 怎么获取：在火山引擎开通豆包语音合成 2.0，拿到 API key（请求头里的 `X-Api-Key`，资源 ID 是 `seed-tts-2.0`，接口细节见 reference.md）。
- 检查是否已存：`[ -n "$DOUBAO_API_KEY" ] && echo env`，或 macOS 上 `security find-generic-password -s doubao-tts-api-key >/dev/null && echo ok`。
- 没存时，让用户自己在终端执行 `security add-generic-password -U -a "$USER" -s doubao-tts-api-key -w`（交互输入，key 不会进 shell 历史）。
- key 不写进任何文件、skill、文档、提交或 shell 配置，也不要回显到输出里。
- 没有 key 时不要退回系统自带语音（`say`、espeak 等），用无配音模式或请用户提供其他高质量 TTS，见 SKILL.md「第一次使用：先配好语音」。

## 建片子目录

每支片子一个独立目录：用户指定了位置就用用户的，否则用当前工作目录下的 `videos/<slug>/`。`$SKILL` 是本 skill 所在的目录（比如 `~/.claude/skills/explainer-video`）。

```bash
SKILL=~/.claude/skills/explainer-video            # 换成 skill 实际安装的位置
W=videos/<slug> && mkdir -p $W && cp -R $SKILL/template/ $W/
cd $W && npm install && node setup.mjs          # setup 下载 Excalidraw 手写字体到 public/fonts
npx playwright install chromium-headless-shell   # 首次；render.mjs 自动在 Playwright 缓存里找
```

## 在 Linux 或云端容器里

没有钥匙串，key 走 `DOUBAO_API_KEY` 环境变量。

- 容器里的工作目录可能随会话清掉：片子目录放临时目录也可以，但成片和 QA 要复制到用户能拿到的持久目录。
- `render.mjs` 在 Linux 上自动处理：从 `/opt/pw-browsers` 找 headless shell（不要 `playwright install`）、改用系统 ffmpeg 导出（headless shell 没有 H.264 编码器）、root 下加 `--no-sandbox`、固定单 worker（多 worker 会卡在 99%）、启动前杀掉上次残留的 headless_shell（否则会报 `stream.push() after EOF`）。
- 杀进程用的是 `pkill -f headless_shell`，所以不要在同一条 shell 命令里写出这个词，否则会把当前 shell 也杀掉。

## 交付前检查

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of compact out.mp4
ffmpeg -nostats -i out.mp4 -map 0:a -af ebur128 -f null - 2>&1 | rg 'I:'   # 约 -16 LUFS
```
