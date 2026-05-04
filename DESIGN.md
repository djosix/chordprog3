# chordprog3

## 實作

- 全前端的網頁，使用 vue3 + tailwind4 實作
- 樂理邏輯使用 tonaljs（chord parsing、chord detect、roman numeral 分析等）
- 播放使用 Tone.js（sample piano）和 Web MIDI（midi out）；midi out 用 `send(data, timestamp)` 排程，避免 setTimeout 抖動
- 狀態管理使用 Pinia
- localStorage 持久化整份 score、output 設定、loop 開關

## 整體 layout

```
+------------------- TopBar (sticky top) ------------------+
| chordprog3 | title | ts | bpm | manual                   |
+--------------- Chord Editor (scrollable) ----------------+
|  row 1: title/desc | bar 1 | bar 2 | bar 3 | bar 4 | +   |
|  row 2: ...                                              |
|                              + new row                   |
+----------- Piano Roll (collapsible, sticky) -------------+
|  pitch col | bar 1 | bar 2 | bar 3 | bar 4               |
+------------------ BottomBar (sticky) --------------------+
| transport | loop | midi-in | position | output settings  |
+----------------------------------------------------------+
```

- 暗色系、不要圓角、軟體工程感、英文介面、`*` 強制 `border-radius: 0`
- 排版方式參考 `design.png`

## 和弦編輯器

- 可以設定拍號（top bar），例如 4/4、6/8 等
- 可以設定 tempo BPM
- 一個 line（row）可以放任意數量的 measure（bar），固定寬度，太多時可水平 scroll；title/desc column 在 sticky-left，不會跟 measure 一起滑動
- 每 measure 內每一拍（beat）都有自己的和弦輸入；一個 4/4 measure 最多 4 個和弦輸入
- 和弦解析失敗就標紅
- 每個 beat 各自有 style / voicing / range 設定（hover gear icon 開 popover）
- Layout
  - 換行：每個 measure 之間 hover 出現 `↵` 按鈕，按下後從這個 measure 開始另起一行
  - row menu (`⋯`) 可以 duplicate / move up·down / insert / delete / join with previous / regenerate all notes
  - 整行的 title 與 description（左邊欄）；optional 的 marker 顯示於 row header
  - 可以選取 N 個 measure（click 點選 + shift-click 延伸），用 cmd-c / cmd-x / cmd-v 剪貼，cmd-shift-v 取代
  - delete / backspace 刪除選取的 measure
- 為 row 標調性（key picker），下一個 row 沒設就 inherit；標上調性後 beat 上會顯示對應的羅馬數字級數
- `+ measure` / `+ row`、以及 `i / a / I / A` 快捷鍵都採「clone playhead 所在的 measure / row」策略：複製 style / voicing / range 等設定，但 chord 與 piano-roll notes 留空。沒有 top-bar defaults 概念。
- 每個 beat 的 range 用 **center + spread** 表達：`rangeCenter`（MIDI）+ `rangeSpread`（半徑、單位 semitone）。clamp 範圍是 `[center − spread, center + spread]`

## 和弦延續規則

如果一個 measure 裡只有第一個 beat 有和弦，後面的 beat 留空，那這個和弦會延續到下一個有和弦的 beat 為止（或者 measure 結束）。產生的 piano roll note 也跟著延續：

- block / sustain：整個 span 一個長 note
- arp / alberti：pattern 每拍 cycle 一次

## Piano roll

- 全域單一 piano roll，固定在 bottom bar 上方
- collapsible（chevron 可開合，收起後留下一條 stub bar）
- **永遠顯示完整 88 keys (A0–C8)**，body 內可垂直 scroll；頂端有 `↺ C4` 按鈕一鍵回到中央 C 附近
- 顯示「目前 playhead 所在的 line」的整排 measure，用 playhead 的垂直線標示目前 measure / beat
- 切換 row 用 `shift+↑/↓` 或 piano-roll header 上的 chevron up/down
- 高度可拖曳調整：panel 的最頂端有 `ns-resize` 條，往上拖會增高；存在 `score.pianoRollHeight`
- 1/32 音符網格，cells per beat = `32 / denominator`（4/4 ⇒ 8 cells/beat、6/8 ⇒ 4 cells/beat）
- pitch column sticky-left；不再需要 ±12 / 縮放範圍按鈕
- 互動
  - 在空 cell 上按住拖曳：建立 note，drag 控制 duration（相當於 note-on + 一連串 sustain cell）
  - 按住 alt 或 cmd：cursor 變成紅色 ⊘ X 圖示，進入刪除模式；單擊或拖曳經過的 note 都會被刪除
  - 每個 measure 右上角有 ↻ regenerate（從和弦重建）和 × clear all；overlay button 用 `mousedown.stop` 避免穿透到底下的 grid handler
- midi in 啟用時，目前按下的鍵在 piano roll 對應 pitch 的整排會亮起，pitch column 上對應的 key 也會反白
- 不能 toggle cell 變成「孤兒 sustain」：sustain 是 note 的延續，沒有 note-on 在前就不存在

## Navigation 快捷鍵

- 全域以 capture-phase 攔截，焦點在 button / select 時也會生效；INPUT / TEXTAREA 仍可正常輸入文字
- 播放
  - `space`：play / pause
  - `0`：stop & rewind to start
  - loop on/off：bottom bar 上的按鈕（不再用 keyboard shortcut，因為 `l` 給了「new line」）
- 編輯
  - `enter`：focus 到 playhead 所在 beat 的 chord input；input 內按 enter 提交並 blur，提交時會 reformat（`cmaj7` → `Cmaj7`）；無法解析的和弦顯示為紅色
  - `shift+enter`（input 內）：用 midi-in 偵測到的和弦填入
  - `i`：在 playhead 所在位置 insert 新 measure（原本的會往後推）
  - `a`：在 playhead 後 append 新 measure
  - `shift+i` / `shift+a`：同上但對 row 操作
  - `y` / `p`：yank / paste 當前 playhead beat 的 style / voicing / range 設定
- Playhead 移動（最低單位一拍）
  - `←` / `→`：前後一個 beat（會跨 measure / 跨 line）
  - `↑` / `↓`：往同一 measure 的上 / 下一個 beat；如果在 measure 邊界，跳到鄰近 line 的同一 x 軸 measure 的最後 / 第一個 beat
  - `shift+←` / `shift+→`：往同 line 的前 / 後一個 measure，beat-y 維持
  - `shift+↑` / `shift+↓`：往上 / 下 line 的同一 x 軸 measure，bar+beat 維持（會 clamp 到實際範圍）
  - `,` / `.`：刻意停用
- Selection / clipboard
  - `cmd-c / x / v`：copy / cut / paste（基於 measure 選取）；只有當有選取時才攔截，否則放行給輸入框
  - `cmd-shift-v`：取代選取
  - `delete / backspace`：刪除選取
  - `esc`：清除選取並 blur

## Beat settings strip

- 已不存在 per-beat gear button + popover；改成 piano roll 頭部一條橫向 strip
- 永遠操作「playhead 所在的 beat」；focus 任何 chord input 也會把 playhead 移過去，所以 strip 會跟著你正在編輯的 beat 自動更新
- strip 內容（攤平在一行）
  - beat 位置標記（`r1·b2·1`）+ 該 beat 的 chord（unparseable 為紅色）
  - style select / voicing select
  - rangeCenter slider（24..96）+ 顯示對應 note name
  - rangeSpread slider（0..36 semitones）
  - 推算出來的 voicing notes 預覽
  - yank / paste / regen 按鈕（鍵盤 y / p / 也可以從這裡按）

## Output

兩種模式可以切換並 persist 到 localStorage：

- **MIDI Out**：透過 Web MIDI 輸出到 macOS IAC driver 或外部 MIDI 裝置；用 `output.send(data, timestamp)` 把 timing 交給 MIDI subsystem，不用 setTimeout
- **Sample piano**：用 Tone.js Sampler 播放 Salamander Grand 的取樣（以 CDN 為主，未來可以換 local）；MIDI→Hz 預先計算成 lookup table，避免 scheduler 熱路徑分配

Volume slider、output mode、midi device id、loop 都會持久化。

## MIDI In

- bottom bar 有獨立的 midi-in toggle；按下後 enumerate 所有 MIDI input 並監聽
- 同時按住的 pitch 會在 piano roll 對應 row 整列亮起，pitch column 也會反白
- tonal `Chord.detect`（含轉位）即時推測和弦，顯示在 bottom bar
- focus 在某個 chord 輸入框且偵測到和弦時，輸入框右邊會冒出 `[♪ Chord]` 按鈕，點下或 `shift-enter` 把當前偵測到的和弦填進去

## UI 規範

- icon button 至少 24-28 px 點擊範圍，避免在桌面也難按
- transport 按鈕至少 36×32
- bottom bar 高 48 px、top bar 44 px
- 所有 dropdown / 文字輸入採用 `monospace`，數字小、緊密
- popover / menu 用陰影 + `border-radius: 0` 強制方角
- 文字一律小寫 (`tracking-wider` 處例外)、英文

## Manual / Help

top bar 右上角有 `manual` 按鈕，開啟覆蓋整個畫面的 dialog（透過 `Teleport`）：

- 顯示 transport / 編輯 / 導覽 / piano roll / beat options / output / note 規則
- `esc` 或點 backdrop 關閉
- 開啟時鎖住 body scroll
