# video-gen

用 AI agent 生成手绘风格的知识讲解短视频。一个面向 Claude Code（或其他支持 Agent Skills 的 agent）的 skill：从旁白脚本出发，自动配音、按逐字时间戳驱动 Revideo 动画，渲染出带字幕的横屏或竖屏 MP4，并附带封面、开场画面条、接触表和自动 QA 报告。

An agent skill that turns a narration script into a hand-drawn (Excalidraw-style) explainer video: TTS with word timestamps → Revideo scenes → MP4 with subtitles, cover and QA. Docs are in Chinese.

## 能做什么

- 旁白脚本 → 豆包语音合成 2.0 配音（整篇一次合成，带逐字时间戳），动画按「念到哪个字」触发
- 没有 TTS key 也能用：`--no-voice` 按阅读速度排时间，字幕代替旁白，可配背景音乐
- 手绘风格图形（roughjs）、Excalifont / 小赖手写字体、按角色命名的调色板
- 横屏 1920×1080 / 竖屏 1080×1920 共用一套场景代码
- 硬字幕 + 软字幕 + `.srt`，封面图，前 5 秒画面条，每句一帧的接触表
- 自动 QA：动画超时、文字出界或重叠、文字溢出手绘框、封面是否居中、开场是否马上动起来、PPT 式文字框提示
- 可选背景音乐：按人声响度自动校准、避让人声

## 目录

```
explainer-video/
  SKILL.md        # 给 agent 的工作流程和规则（入口）
  reference.md    # 机制细节：时间轴、手绘组件、QA、Revideo 的坑、TTS 接口
  setup.md        # 环境准备和交付检查
  template/       # 每支片子从这里复制一份开始
  tts/            # 本地试听音色的小工具
  music/          # 两首 CC BY 4.0 配乐和署名
```

## 准备

- Node.js 22+、ffmpeg
- Playwright 的 `chromium-headless-shell`（`npx playwright install chromium-headless-shell`）
- 可选：火山引擎豆包语音合成 2.0 的 API key，放在环境变量 `DOUBAO_API_KEY`（macOS 也可以存进钥匙串，见 [setup.md](explainer-video/setup.md)）。key 不要写进任何文件。没有 key 时用无配音模式。

## 安装 skill

把 `explainer-video/` 复制（或软链接）到 agent 的 skills 目录，例如 Claude Code 的 `~/.claude/skills/explainer-video`，然后对 agent 说「帮我做一个讲解 xxx 的竖屏视频」。

第一次使用时，agent 会问你的账号名和片尾文案，用来替换模板里的示例品牌（`403-error` 是作者自己的频道）。

## 手动跑一遍模板演示

```bash
cp -R explainer-video/template /tmp/demo && cd /tmp/demo
npm install && node setup.mjs        # setup 下载手写字体（OFL）到 public/fonts
node narrate.mjs                     # 需要 DOUBAO_API_KEY；没有就用 node narrate.mjs --no-voice
node render.mjs --out renders/demo.mp4
```

## 第三方素材

- 字体：Excalifont、小赖（Xiaolai），均为 SIL Open Font License，由 `setup.mjs` 从 npm 包 `@excalidraw/excalidraw` 下载，不随仓库分发。
- 配乐：Scott Buckley「Horizons」、Lee Rosevere「Let That Sink In」，CC BY 4.0，署名见 [music/README.md](explainer-video/music/README.md)。用到的视频需要在简介里署名。
