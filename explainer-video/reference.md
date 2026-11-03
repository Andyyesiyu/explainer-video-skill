# 参考：模板结构、时间轴、手绘、Revideo 坑、豆包 TTS

## 目录

- [模板结构](#模板结构)
- [配音细节](#配音细节)
- [时间轴与 cues](#时间轴与-cues)
- [响应式布局](#响应式布局)
- [手绘：Sketch / Ink / draw](#手绘sketch--ink--draw)
- [动作 helper](#动作-helper)
- [QA](#qa)
- [Revideo 坑](#revideo-坑)
- [豆包 TTS 2.0 HTTP 接口](#豆包-tts-20-http-接口)
- [背景音乐](#背景音乐)

## 模板结构

| 文件 | 作用 |
|---|---|
| `script.json` | 旁白脚本：画幅、音色、语速、scenes → beats |
| `narrate.mjs` | TTS（带逐字时间戳）→ `src/timeline.json`、`build/narration.wav`、`build/captions.srt` |
| `render.mjs` | Revideo 无声渲染 → 混入自己的旁白和软字幕 → QA、开场画面条、接触表、封面 |
| `bgm.mjs` | 可选：给成片铺背景音乐（按人声响度校准、让开人声频段、自动避让），见[背景音乐](#背景音乐) |
| `setup.mjs` | 一次性：从 npm 包 `@excalidraw/excalidraw` 取 Excalifont / 小赖字体（OFL）到 `public/fonts`，写 `src/fonts.json` |
| `src/theme.ts` | 调色板（按角色命名）、字体、手绘参数 |
| `src/sketch.tsx` | 手绘组件 |
| `src/lib.tsx` | 字体加载、`frame`、`cues`、字幕、QA 探针、动作 helper |
| `src/scenes.tsx` | 场景（演示：二分查找） |
| `src/project.ts` | `ordered([...])` 按 `script.json` 的顺序排场景，缺失或多余都会报错 |

时间常量在 `narrate.mjs`：整片首句前 `LEAD 0.3`、整片末句后 `TAIL 0.15`，幕与幕之间只留 `CUT_TAIL 0.05` + `CUT_LEAD 0`，每段合成音频首尾自带的静音会裁掉，只各留 `EDGE 0.05`，段内超过 `MAX_GAP 0.2` 的静音去掉中间部分、压到 0.2s（只删静音，不动人声），`silent` beat 前后各 `GAP 0.12`。整篇连续的有声 beat 一次合成（跨幕），音频整段播放，不切；幕的起点是它第一句的时间标记，落在上一幕末句之后那段停顿的中间。接口拒绝时（报错以 `TTS ` 开头）按口播字数在幕边界均分成 2 段、最多 3 段重试，段与段之间留 `CUT_TAIL + CUT_LEAD`。每句的起点只是时间标记：在前句最后一个字的开始到后句第二个字的开始之间，找实际音频里最长的一段静音（10ms 一帧算 RMS，低于第 90 百分位语音音量的 5% 算静音），取它的中点；找不到才退回到两个时间戳的中点。每句的 `words` 时间相对于它自己的标记，算出负值时截到 0。需要这样做是因为时间戳可能不准：句尾字被标成 0.06s，句号后的英文词被标成 0.03s，然后空出近 1s。按字长判断音频好坏不可靠，数字和部分单字的时间戳本来就很短，会大量误报，所以 `audioIssues` 只看音频本身：两段声音之间超过 `STALL` 的静音，以及片段结尾还在出声。逐字时间戳覆盖的字数必须和文本（去掉空白和标点后）一致，否则无法定位每句的起点，`narrate.mjs` 会报错并列出这段的 beat id。字幕按标点切块，横屏每行不超过 22 个汉字宽，竖屏不超过 16（英文按 0.55 宽计）。单个分句超过一行时，用 `Intl.Segmenter` 在词边界处断成长度接近的两行（用 `\n` 连接，再长就拆成多块）：不拆英文词和 `fork-and-flush` 这类连字符词，行首不放标点，也不放「了的着过」这类助词。字幕的 `Txt` 用 `textWrap="pre"` 保留这些换行，不再自动折行，所以不会出现第二行只剩一两个字的情况。起止时间取逐字时间戳；`sub` 和 `say` 切出的块数不同时，按宽度比例分配。

## 配音细节

- **整篇一次合成，整段播放，不切音频**：所有有声的句子拼成一段，一次发给 TTS，音频整段原样放进成片。幕和句子都只是这段音频里的时间标记，用来驱动动画和字幕。这样句与句、幕与幕之间语调连贯，也不会有切点造成的卡顿或吞字。实测约 1200 字、140 秒的旁白一次请求即可（请求超时设为 300s）。只有接口拒绝时才在幕边界切成 2–3 段（`--requests N` 可直接从 N 段开始）。
- 句子之间、幕与幕之间的停顿都由模型决定，超过 `MAX_GAP 0.2`s 的会被压短；只有一次请求里最后一句的 `pause` 还会在句后补静音。`silent` beat 会把旁白分成前后两次合成，那一处语调不再连贯。
- 时间戳不准只会让某个动画早一点或晚一点出现，不会影响声音。
- **卡断检测**：每次请求合成后，都解码音频检查两段声音之间超过 `STALL = 1.0`s 的静音（模型卡住），以及片段结尾还在出声（被截断）。有问题就把这次请求整段重新合成（豆包每次输出不同），最多重试 `RETAKES = 2` 次，保留问题最少的一版，不在音频上做剪辑或补丁。剩下的问题写进 `build/audio-qa.json`，终端以 `AUDIO QA:` 开头打印。
- **缓存**：按「音色|语速|语气指令|整段文本」缓存在 `build/audio`。

## 时间轴与 cues

```tsx
export const intro = makeScene2D('intro', function* (view) {   // 名字 = script.json 的 scene id
  const f = frame(view), u = f.u, cue = cues('intro')
  view.add(<Rect ...>...</Rect>)
  cue.at(0.1, () => rise(title()), 'title')                     // 场景内秒数
  cue.at(cue.on('b1', '服务端'), () => draw(box()), 'box')       // 念到「服务端」前 0.25s
  cue.at(cue.on('b1', '它', { nth: 2, lead: 0 }), ...)           // 第 2 次出现、不提前
  yield* cue.run(view, fadeTransition(0.3))                      // 额外的生成器（转场等）并行跑
})
```

- `cue.on` 找不到字会直接抛错，并给出整句旁白。匹配前会去掉标点和空格、统一转小写，所以「Auto Router」和「autorouter」都能匹配。
- `cue.beat(id)` 返回 `{ start, dur, words, say }`，`cue.len` 是场景总长。
- `run()` 用 `any(waitFor(len), …)` 把场景卡在旁白长度上，到点时还没结束的动画会被截断，并在 QA 里报 `overrun … cut off`。
- 场景从第一帧起就把所有节点加进去（初始 `opacity={0}`），之后只改属性。这样布局一开始就固定，后出现的内容不会把已有内容挤走。

## 响应式布局

- `frame(view)` 返回：
  - `w`、`h`、`portrait`；
  - `u = min(w, h) / 1080`；
  - `cover = { x, y, w, h }`，封面窗口（以画面中心为原点）：竖屏是正中 1080×1440 再四周留 60u（信息流把竖屏封面裁成 3:4），横屏是四周留 5%。第一幕最后一帧的标题和主图放在这里面。
  - `safe = { x, y, w, h }`，内容区的中心和尺寸。横屏上留 60u、下留 200u；竖屏上留 15%、下留 26%（排版区下沿和字幕顶部大致对齐），字幕底边在约 76% 高度（底色约 60% 不透明，文字带阴影；横屏字幕仍在底部、底色 90% 不透明）。这是默认排版区，不是硬限制，QA 只检查文字是否被字幕挡住或出屏。
- 写法：
  - 尺寸写成 `n * u`；
  - 容器用 `layout` + `direction={f.portrait ? 'column' : 'row'}`；
  - 格子这类按宽度均分的元素用 `Math.min(上限 * u, (f.safe.w - 间距) / 个数)`；
  - 竖屏可以整体放大（演示里用 `big = 1.25`），再用 `justifyContent="space-evenly"` 把内容铺满高度。
- 跟随布局：
  - 浮在布局上方的东西（指针、高亮框）用响应式属性绑定目标，比如 `position={() => cells[i]().position()}`、`size={() => q().size().add([40 * u, 30 * u])}`。
  - 它们和目标处在同一个父节点坐标系，放进 `<Rect layout={false}>` 浮层里。

## 手绘：Sketch / Ink / draw

- `<Sketch>`：
  - 接受所有 Rect 属性（`layout`、`padding`、子节点……），另有 `shape: 'rect' | 'ellipse'`、`ink`（描边色）、`paper`（填充色）、`fillStyle: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag' | 'dots'`、`corner`、`seed`、`rough`（roughjs Options）。
  - 外形每帧按自身当前尺寸重新生成，所以随布局和文字变化自适应。
  - `contain`：把这个框标成容器。布局检查时，任何可见的 `Sketch`（框、椭圆）、`Circle` 或文字，只要一部分在框内、一部分在框外（容差 4u），就报 `crosses frame`。比框还大、整个把框包住的背景不算。`Ink` 不参与检查。报错里没有文字的图形用中心的屏幕坐标标注，比如 `shape at (214, 367)`。
- `<Ink points={[[x, y], ...]} arrow>`：手绘折线，`points` 可以是响应式函数。
- `draw(node, d)`：
  - 找出 `node` 下所有手绘部件，描边从 0 画到 1，然后淡入填充和文字。
  - 节点要先设 `opacity={0}`，`draw` 开始时会把它设为可见。
  - 可以对整组容器调用，比如 `draw(code())`。
- 抖动（boil）：`run()` 每秒把 `boil` 信号加 `BOIL_FPS` 次，所有手绘部件换一个 seed 重画，看起来像手绘动画在"呼吸"。默认 4 fps；设为 0 就是静止的手绘图。
- 参数在 `theme.ts` 的 `ROUGH`：
  - `roughness`：抖动幅度，0 为直线；
  - `bowing`：线条弯曲程度；
  - `strokeWidth`：线宽。
  - 单个组件可以用 `rough={{ ... }}` 覆盖。

## 动作 helper

`lib.tsx` 提供以下 helper，其余直接用 Revideo 的 tween：

- `rise(n)`：上浮淡入；
- `pop(n)`：回弹放大；
- `count(txt, to, d, fmt, from)`：数字滚动；
- `shake(n)`：左右抖动；
- `copyTo(view, src, dst)`：复制一份飞到目标处，原件保留，`dst` 先设 `opacity={0}`。

常用的 Revideo 写法：

- 改属性：`node().opacity(0.2, 0.5)`、`node().position([x, y], 0.6, easeInOutCubic)`；
- 并行和串行：`all(...)`、`chain(...)`、`delay(t, task)`；
- 驱动连续变化：`createSignal` 配合 `signal(to, d)`，指针沿格子移动就是这样做的。

## QA

`lib.tsx` 用 `console.log('QA {json}')` 上报事件，`render.mjs` 从 Revideo 转发的浏览器日志里收集，原始事件存在 `build/qa-events.json`。

| 类别 | 判断依据 |
|---|---|
| `overrun` | `cue.at` 的动画结束时间晚于下一句开始；或场景结束时动画还没跑完 |
| `cover` | 第一幕最后一句的结尾：可读文字（不含账号名、字幕、等宽代码）跑出 `cover` 窗口 |
| `hook` | 第一幕第 0.04 秒画面里没有任何文字或图形；第一个动画晚于 0.5s 开始 |
| `style` | 每个检查点：可见的手绘框（或椭圆）里只有一句话（判定阈值 12 个字，汉字算 1、字母数字算 0.5），没有任何手绘图形、圆点或图片 |
| `outro` | 最后一幕 `brand` 长于 2s |
| `layout` | 每句旁白的中点和结尾各检查一次可见文字（不透明度 ≥ 0.5）：出界、两段文字重叠超过 15%、屏幕字号小于 20u、被字幕盖住超过 40%、超出最近一层祖先 `Sketch` 的内容区（框减去 padding，不留容差，只允许 0.5px 浮点误差；报 `overflows box`） |

- layout 检查只看 `Txt`，图形之间的遮挡要靠接触表人工判断。
- `cover` / `hook` / `style` / `outro` 只是提示，不影响退出码；水印和字幕不参与任何检查。
- 第一幕在结束前 0.15s 撤掉字幕，所以 `-cover.png` 上没有字幕。`cues(id, { captions: false })` 可以让整幕不烧字幕（品牌卡用它）。
- `overflows box` 是硬性失败：`render.mjs` 照常产出所有文件，但最后以退出码 2 结束并列出溢出的文字。常见原因是给装文字的 `Sketch` 写死了 `width`，文字比框长；改成按内容撑开（只给 `padding`）、用 `minWidth`，或缩短标签。
- 包围盒按 `size × absoluteScale` 计算，不考虑旋转。

## Revideo 坑

这些都在 0.11.0 上实测确认过。

- 依赖：
  - 必须装 `@revideo/ui`，否则渲染时 vite 报找不到模块。
  - puppeteer 自带的 Chrome 在 macOS 上会崩（crashpad）。`render.mjs` 改用 Playwright 的 `chrome-headless-shell`，配 `headless: 'shell'`。
- 文本：
  - **`Txt` 的 `text` 不要写成响应式函数**。渲染时会报 "The scene is not available in the current context"，文字渲染成空白，但渲染仍算成功。动态文字用 `tween(d, p => txt().text(...))` 或在生成器里直接 `txt().text('...')`。
  - **`Txt` 在 flex 父节点里会忽略 `layout={false}`**，照样被排进布局。浮动文字要包在 `<Rect layout={false}>` 里。
  - Txt 内开头的空白会被折叠。代码缩进用 `marginLeft`（等宽字符约 0.6em）。
  - Canvas 文字在字体加载前会悄悄回退到系统字体。`lib.tsx` 用顶层 `await` 先 `FontFace.load()` 全部字体分片；分片按 `unicodeRange` 切，浏览器只解码用到的部分。
- 报错：场景里的异常和 `console.error` 只会出现在日志里（`Worker N: JSHandle:...`、`[vite] (client) [console.error]`），渲染照样"完成"。`render.mjs` 会扫描这些日志，一旦发现就以非零退出。
- 音频：Revideo 自己混音会把音量压低约 3dB。所以模板渲染无声视频，再用 ffmpeg 混入 `narration.wav`（`adelay` + `amix normalize=0` + `loudnorm -16 LUFS`）。
- 场景长度会对齐到整帧，每个场景约有 ±1 帧误差，不会累积成明显漂移。

## 豆包 TTS 2.0 HTTP 接口

- **请求**：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`
  - 请求头：`X-Api-Key`、`X-Api-Resource-Id: seed-tts-2.0`、`X-Api-Request-Id: <uuid>`
  - 请求体：`{user:{uid}, req_params:{text, speaker, audio_params:{format:'mp3', sample_rate:24000, speech_rate, enable_subtitle:true}}}`
- **逐字时间戳**：
  - 只有放在 `audio_params.enable_subtitle: true` 才生效；放在 `enable_timestamp` 或 `additions` 里时，`sentence.words` 返回空。
  - `sentence.words[]` 形如 `{ word, startTime, endTime, confidence }`，单位为秒，从整段音频开头算起，已按语速缩放。
  - 标点会粘在前一个字上（`"型，"`）；英文按整词返回，空格被丢掉；阿拉伯数字保持原样。
- **语气指令**：`req_params.additions = JSON.stringify({context_texts:['用轻松的语气']})`。`narrate.mjs` 每次都发 `BASE_CONTEXT`（固定的配音风格），再接上 `script.json` 里可选的 `context`。实测写明"中英文混读要连贯、英文词融入中文语流"以及停顿方式，对中英混读的连贯度有帮助。
- **响应**：逐行 JSON，可能带 `data:` 前缀。每行的 `data` 是 base64 音频分片；`code` 为 0 表示分片，20000000 表示结束，其他值是错误。出错时带上响应头 `x-tt-logid` 便于排查。
- **`speech_rate`** 取值范围 [-50, 100]：100 为 2 倍速，20 为 1.2 倍速（默认）。
- **2.0 音色**（`*_uranus_bigtts`）：xiaohe（小何，默认）、vv、m191（云舟）、taocheng、liufei、ruyayichen、dayi、qingcang、cancan、qingxinnvsheng、liuchangnv、shuangkuaisisi、yingyujiaoxue（Tina），以及英文的 `en_male_tim`、`en_female_dacey`。
- 批量调用 TTS 用 Node 脚本（`tts/batch.mjs`），不要写 shell 的 curl/jq 循环，后者容易卡死。

## 背景音乐

`bgm.mjs` 的做法：

- 曲子短于视频时，复制 N 份用 `acrossfade=d=4` 串起来；
- 音乐链：`equalizer=f=2500:t=q:w=1:g=-4` → `equalizer=f=150:t=q:w=1:g=1.5` → `volume`；
- 用成片自己的人声做 sidechain：`sidechaincompress=threshold=0.02:ratio=2.5:attack=30:release=500`；
- 校准：先用 0 dB 增益把压过的音乐单独导出，测它和人声的响度（各去掉首尾 3 秒），增益 = 人声 − `--under` − 音乐。压缩量只取决于人声，所以音乐响度对增益是线性的，测一次就准；
- 混音：`amix normalize=0` + `alimiter=limit=0.95`，视频和字幕轨 `-c copy`，音频 AAC 192k。混完再测一次，打印实际差值。

自带曲目（文件在 `$SKILL/music/`，署名见 [music/README.md](music/README.md)）：

| 曲名 / 作者 | 风格 | 时长 | 授权和来源 | 署名 |
|---|---|---|---|---|
| Horizons / Scott Buckley | 钢琴 + 弦乐 + 轻琶音，电影感 | 4:53 | CC BY 4.0，https://archive.org/details/soundcloud-767889406 | `"Horizons" by Scott Buckley, licensed under CC BY 4.0, www.scottbuckley.com.au` |
| Let That Sink In / Lee Rosevere | 暖色、播客式，平稳 | 2:05 | CC BY 4.0，https://archive.org/details/leerosevere_musicforpodcasts_6 | `"Let That Sink In" by Lee Rosevere, from Music For Podcasts 6, licensed under CC BY 4.0` |

找新曲子时：archive.org 上 Lee Rosevere 的 Music For Podcasts 系列、Scott Buckley、Chris Zabriskie 都是 CC BY；incompetech（Kevin MacLeod）的 mp3 能直接下载；Pixabay 拦截脚本下载，只能把链接给用户手动下。

