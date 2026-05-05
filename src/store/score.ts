import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import type {
  Bar,
  Beat,
  BeatSettings,
  ClipboardData,
  PianoRollNote,
  Row,
  Score,
  TimeSignature,
} from '@/types'
import { uid } from '@/utils/id'
import { cellsPerBar, cellsPerBeat, notesFromBar, overlapsExistingNote } from '@/utils/cells'

const STORAGE_KEY = 'chordprog3:score:v5'

const HARD_DEFAULTS: BeatSettings = {
  // tasteful default: a sustained drop-2 voicing centered around middle C
  // sounds more pianistic than the older close+block out-of-the-box.
  style: 'block',
  voicing: 'drop2',
  rangeCenter: 64, // around E4
  rangeSpread: 18, // ±1.5 octaves
}

const PIANO_ROLL_DEFAULT_HEIGHT = 320

function defaultBeat(d: BeatSettings = HARD_DEFAULTS): Beat {
  return {
    chord: '',
    style: d.style,
    voicing: d.voicing,
    rangeCenter: d.rangeCenter,
    rangeSpread: d.rangeSpread,
  }
}

/** Clone a bar's settings (style/voicing/range) into a fresh blank bar — no chord, no notes. */
function cloneBarTemplate(b: Bar): Bar {
  return {
    id: uid('bar'),
    key: b.key,
    notes: [],
    beats: b.beats.map((bt) => ({
      chord: '',
      style: bt.style,
      voicing: bt.voicing,
      rangeCenter: bt.rangeCenter,
      rangeSpread: bt.rangeSpread,
    })),
  }
}

/** Clone a row's settings into a fresh blank row — title/desc/marker reset; key kept. */
function cloneRowTemplate(r: Row): Row {
  return {
    id: uid('row'),
    title: '',
    description: '',
    marker: '',
    key: r.key,
    bars: r.bars.map(cloneBarTemplate),
  }
}

export function makeBar(beatsPerBar: number, d: BeatSettings = HARD_DEFAULTS): Bar {
  return {
    id: uid('bar'),
    beats: Array.from({ length: beatsPerBar }, () => defaultBeat(d)),
    notes: [],
    key: null,
  }
}

export function makeRow(beatsPerBar: number, bars = 4, d: BeatSettings = HARD_DEFAULTS): Row {
  return {
    id: uid('row'),
    title: '',
    description: '',
    marker: '',
    key: null,
    bars: Array.from({ length: bars }, () => makeBar(beatsPerBar, d)),
  }
}

function defaultScore(): Score {
  const ts: TimeSignature = { numerator: 4, denominator: 4 }
  const r1 = makeRow(ts.numerator, 4)
  r1.title = 'verse'
  r1.marker = 'I  vi  IV  V'
  r1.key = 'C major'
  r1.bars[0].beats[0].chord = 'Cmaj7'
  r1.bars[1].beats[0].chord = 'Am7'
  r1.bars[2].beats[0].chord = 'Fmaj7'
  r1.bars[3].beats[0].chord = 'G7'
  for (const b of r1.bars) b.notes = notesFromBar(b, ts)
  const r2 = makeRow(ts.numerator, 4)
  r2.title = 'chorus'
  r2.bars[0].beats[0].chord = 'Cmaj7'
  r2.bars[1].beats[0].chord = 'Am7'
  r2.bars[2].beats[0].chord = 'Fmaj7'
  r2.bars[3].beats[0].chord = 'G7'
  for (const b of r2.bars) b.notes = notesFromBar(b, ts)
  return {
    title: 'untitled',
    bpm: 100,
    timeSignature: ts,
    rows: [r1, r2],
    pianoRollOpen: true,
    pianoRollHeight: PIANO_ROLL_DEFAULT_HEIGHT,
  }
}

function migrateRow(row: any, ts: TimeSignature): Row {
  const r: Row = {
    id: row.id ?? uid('row'),
    title: typeof row.title === 'string' ? row.title : '',
    description: typeof row.description === 'string' ? row.description : '',
    marker: typeof row.marker === 'string' ? row.marker : '',
    key: typeof row.key === 'string' ? row.key : null,
    bars: (Array.isArray(row.bars) ? row.bars : [])
      .filter((b: any) => b && typeof b === 'object')
      .map((b: any) => migrateBar(b, ts)),
  }
  if (r.bars.length === 0) r.bars.push(makeBar(ts.numerator))
  return r
}

function migrateBar(bar: any, ts: TimeSignature): Bar {
  const beats: Beat[] = []
  for (let i = 0; i < ts.numerator; i++) {
    const src = bar.beats?.[i] ?? {}
    let center: number
    let spread: number
    if (typeof src.rangeCenter === 'number' && typeof src.rangeSpread === 'number') {
      center = src.rangeCenter
      spread = src.rangeSpread
    } else if (typeof src.rangeLow === 'number' && typeof src.rangeHigh === 'number') {
      // legacy low/high → center+spread
      center = Math.round((src.rangeLow + src.rangeHigh) / 2)
      spread = Math.round((src.rangeHigh - src.rangeLow) / 2)
    } else {
      center = HARD_DEFAULTS.rangeCenter
      spread = HARD_DEFAULTS.rangeSpread
    }
    beats.push({
      chord: src.chord ?? '',
      style: src.style ?? 'block',
      voicing: src.voicing ?? 'close',
      rangeCenter: center,
      rangeSpread: spread,
    })
  }
  let notes: PianoRollNote[] = Array.isArray(bar.notes)
    ? bar.notes.filter(
        (n: any) =>
          typeof n.pitch === 'number' &&
          typeof n.startCell === 'number' &&
          typeof n.duration === 'number',
      )
    : []
  const out: Bar = {
    id: bar.id ?? uid('bar'),
    beats,
    notes,
    key: bar.key ?? null,
  }
  if (out.notes.length === 0) out.notes = notesFromBar(out, ts)
  return out
}

function loadScore(): Score {
  if (typeof localStorage === 'undefined') return defaultScore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultScore()
    const parsed = JSON.parse(raw)
    if (!parsed.rows || !Array.isArray(parsed.rows)) return defaultScore()
    const tsRaw = parsed.timeSignature ?? {}
    const ts: TimeSignature = {
      numerator: typeof tsRaw.numerator === 'number' && tsRaw.numerator >= 1 ? tsRaw.numerator : 4,
      denominator:
        typeof tsRaw.denominator === 'number' && tsRaw.denominator >= 1 ? tsRaw.denominator : 4,
    }
    let height = PIANO_ROLL_DEFAULT_HEIGHT
    if (typeof parsed.pianoRollHeight === 'number' && parsed.pianoRollHeight > 0) {
      height = Math.min(800, Math.max(120, parsed.pianoRollHeight))
    }
    const rows = parsed.rows
      .filter((r: any) => r && typeof r === 'object')
      .map((r: any) => migrateRow(r, ts))
    if (rows.length === 0) rows.push(makeRow(ts.numerator, 4))
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'untitled',
      bpm:
        typeof parsed.bpm === 'number' && Number.isFinite(parsed.bpm)
          ? Math.max(20, Math.min(400, parsed.bpm))
          : 100,
      timeSignature: ts,
      rows,
      pianoRollOpen: parsed.pianoRollOpen ?? true,
      pianoRollHeight: height,
    }
  } catch {
    return defaultScore()
  }
}

export const useScoreStore = defineStore('score', () => {
  const score = reactive<Score>(loadScore())
  const clipboard = ref<ClipboardData | null>(null)

  // selection: ranges of bars by [rowIndex, barIndex]
  const selection = reactive<{
    anchor: { row: number; bar: number } | null
    head: { row: number; bar: number } | null
  }>({ anchor: null, head: null })

  // Debounce localStorage writes — full JSON.stringify on every keystroke /
  // drag tick is ~tank-the-UI expensive on large scores.
  let saveTimer: number | null = null
  let lastSaveError: unknown = null
  function flushSave(precomputedJson?: string) {
    if (typeof localStorage === 'undefined') return
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      // Caller can pass a pre-stringified snapshot so we don't pay the
      // serialization cost twice in the same debounce flush.
      localStorage.setItem(STORAGE_KEY, precomputedJson ?? JSON.stringify(score))
      if (lastSaveError) lastSaveError = null
    } catch (e) {
      if (lastSaveError !== e) {
        console.warn('chordprog3: localStorage save failed —', e)
        lastSaveError = e
      }
    }
  }

  /* --- Undo / redo: snapshot the JSON-serialized score on each settled
   *     mutation. We piggy-back on the same deep-watch the localStorage save
   *     uses; the same 250ms quiet window groups continuous edits (typing,
   *     dragging notes) into one logical step. Capped at MAX_HISTORY so a
   *     long session doesn't pin RAM. While restoring (undo / redo applies a
   *     snapshot back onto the reactive score), the watch fires too — the
   *     `restoring` flag tells the snapshotter to skip those mutations. */
  const MAX_HISTORY = 200
  const undoStack: string[] = []
  const redoStack: string[] = []
  let lastSnapshot = JSON.stringify(score)
  let restoring = false

  function flushHistorySnapshot(precomputedJson?: string): string {
    const cur = precomputedJson ?? JSON.stringify(score)
    if (restoring) return cur
    if (cur === lastSnapshot) return cur
    undoStack.push(lastSnapshot)
    if (undoStack.length > MAX_HISTORY) undoStack.shift()
    redoStack.length = 0
    lastSnapshot = cur
    return cur
  }

  watch(
    () => score,
    () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        // One stringify per debounce flush, shared by both consumers.
        const json = JSON.stringify(score)
        flushSave(json)
        flushHistorySnapshot(json)
      }, 250)
    },
    { deep: true },
  )

  function applySnapshot(json: string) {
    let s: Score
    try {
      s = JSON.parse(json) as Score
    } catch (err) {
      // A corrupted snapshot in the stack would throw uncaught from undo()/
      // redo() and kill the call. Drop the bad entry and bail.
      console.warn('chordprog3: undo snapshot was corrupted, skipping —', err)
      return
    }
    restoring = true
    try {
      score.title = s.title
      score.bpm = s.bpm
      score.timeSignature = s.timeSignature
      score.rows = s.rows
      score.pianoRollOpen = s.pianoRollOpen
      score.pianoRollHeight = s.pianoRollHeight
      // selection refers to bar indices that may not exist anymore — clear it.
      selection.anchor = null
      selection.head = null
    } finally {
      // Clear restoring on the next tick so the watch's flush (which still
      // sees the current state == new snapshot, no-ops anyway) doesn't push
      // a duplicate.
      lastSnapshot = json
      Promise.resolve().then(() => {
        restoring = false
      })
    }
  }

  function undo() {
    // Coalesce any pending in-flight snapshot — if the user typed something
    // 50ms ago and immediately hit cmd-z, we want to step back from THAT
    // state, not the older lastSnapshot.
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
      const cur = JSON.stringify(score)
      if (cur !== lastSnapshot) {
        undoStack.push(lastSnapshot)
        if (undoStack.length > MAX_HISTORY) undoStack.shift()
        lastSnapshot = cur
      }
    }
    if (undoStack.length === 0) return
    const target = undoStack.pop()!
    redoStack.push(lastSnapshot)
    applySnapshot(target)
    flushSave()
  }

  function redo() {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    if (redoStack.length === 0) return
    const target = redoStack.pop()!
    undoStack.push(lastSnapshot)
    if (undoStack.length > MAX_HISTORY) undoStack.shift()
    applySnapshot(target)
    flushSave()
  }

  const canUndo = computed(() => undoStack.length > 0)
  const canRedo = computed(() => redoStack.length > 0)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => flushSave())
    // mobile / Safari skip beforeunload — flush on visibility change too
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave()
    })
  }

  const beatsPerBar = computed(() => score.timeSignature.numerator)
  const cellsPerBeatNow = computed(() => cellsPerBeat(score.timeSignature))
  const cellsPerBarNow = computed(() => cellsPerBar(score.timeSignature))

  function setTimeSignature(num: number, den: number) {
    const oldCpb = cellsPerBar(score.timeSignature)
    score.timeSignature.numerator = num
    score.timeSignature.denominator = den
    const newCpb = cellsPerBar(score.timeSignature)
    for (const r of score.rows) {
      for (const b of r.bars) {
        const truncated = b.beats.length > num
        if (b.beats.length < num) {
          while (b.beats.length < num) b.beats.push(defaultBeat())
        } else if (truncated) {
          b.beats.length = num
        }
        if (truncated || newCpb !== oldCpb) {
          // beats removed or cell-grid changed — rebuild notes from current chords
          // so we don't end up with orphan notes referencing dropped beats.
          b.notes = notesFromBar(b, score.timeSignature)
        }
      }
    }
  }

  function setBpm(v: number) {
    // NaN comparisons always fail, so Math.min(400, Math.max(20, NaN)) yields
    // NaN — guard explicitly so a bad input doesn't poison transport.bpm.value
    // (Tone throws on NaN) and cellSeconds (would propagate Infinity downstream).
    if (!Number.isFinite(v)) return
    score.bpm = Math.max(20, Math.min(400, Math.round(v)))
  }

  function setRowTitle(rowIndex: number, v: string) {
    const r = score.rows[rowIndex]
    if (r) r.title = v
  }
  function setRowDescription(rowIndex: number, v: string) {
    const r = score.rows[rowIndex]
    if (r) r.description = v
  }
  function setRowMarker(rowIndex: number, v: string) {
    const r = score.rows[rowIndex]
    if (r) r.marker = v
  }
  function setRowKey(rowIndex: number, v: string | null) {
    const r = score.rows[rowIndex]
    if (r) r.key = v
  }
  function setPianoRollOpen(open: boolean) {
    score.pianoRollOpen = open
  }
  function setPianoRollHeight(px: number) {
    // 800 is the absolute upper bound, but on shorter viewports leave room
    // for the top + bottom bars (~140px combined) and a sliver of editor.
    const viewportMax =
      typeof window !== 'undefined' && window.innerHeight
        ? Math.max(120, window.innerHeight - 200)
        : 800
    score.pianoRollHeight = Math.max(120, Math.min(800, Math.min(viewportMax, Math.round(px))))
  }

  /* --- beat-settings clipboard (yank / paste via y / p shortcuts) --- */
  const beatClipboard = ref<BeatSettings | null>(null)

  function yankBeat(rowIndex: number, barIndex: number, beatIndex: number) {
    const beat = score.rows[rowIndex]?.bars[barIndex]?.beats[beatIndex]
    if (!beat) return
    beatClipboard.value = {
      style: beat.style,
      voicing: beat.voicing,
      rangeCenter: beat.rangeCenter,
      rangeSpread: beat.rangeSpread,
    }
  }

  function pasteBeat(rowIndex: number, barIndex: number, beatIndex: number) {
    if (!beatClipboard.value) return
    updateBeat(rowIndex, barIndex, beatIndex, { ...beatClipboard.value })
  }

  function setBeatChord(rowIndex: number, barIndex: number, beatIndex: number, chord: string) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    const beat = bar?.beats[beatIndex]
    if (!beat || !bar) return
    beat.chord = chord
    regenerateBar(rowIndex, barIndex)
  }

  function updateBeat(rowIndex: number, barIndex: number, beatIndex: number, patch: Partial<Beat>) {
    const beat = score.rows[rowIndex]?.bars[barIndex]?.beats[beatIndex]
    if (!beat) return
    Object.assign(beat, patch)
    regenerateBar(rowIndex, barIndex)
  }

  /** Regenerate ALL notes for a bar (clears + rebuilds from chords). */
  function regenerateBar(rowIndex: number, barIndex: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    bar.notes = notesFromBar(bar, score.timeSignature)
  }

  function regenerateRow(rowIndex: number) {
    const r = score.rows[rowIndex]
    if (!r) return
    for (const b of r.bars) b.notes = notesFromBar(b, score.timeSignature)
  }

  /* --- piano-roll note ops (per bar) --- */

  function addNote(rowIndex: number, barIndex: number, note: PianoRollNote) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const cpBar = cellsPerBarNow.value
    const startCell = Math.max(0, Math.min(cpBar - 1, note.startCell))
    const duration = Math.max(1, Math.min(cpBar - startCell, note.duration))
    if (overlapsExistingNote(bar.notes, note.pitch, startCell, duration)) return
    bar.notes.push({ pitch: note.pitch, startCell, duration, velocity: note.velocity })
    bar.notes.sort((a, b) => a.startCell - b.startCell || a.pitch - b.pitch)
  }

  function removeNote(rowIndex: number, barIndex: number, noteIndex: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    bar.notes.splice(noteIndex, 1)
  }

  function resizeNote(rowIndex: number, barIndex: number, noteIndex: number, duration: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const note = bar.notes[noteIndex]
    if (!note) return
    const cpBar = cellsPerBarNow.value
    const newDur = Math.max(1, Math.min(cpBar - note.startCell, Math.round(duration)))
    if (overlapsExistingNote(bar.notes, note.pitch, note.startCell, newDur, noteIndex)) {
      let maxDur = 1
      for (let d = 1; d <= newDur; d++) {
        if (overlapsExistingNote(bar.notes, note.pitch, note.startCell, d, noteIndex)) break
        maxDur = d
      }
      note.duration = maxDur
      return
    }
    note.duration = newDur
  }

  function clearBarNotes(rowIndex: number, barIndex: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    bar.notes = []
  }

  /* --- row / bar layout (insert / append clone the playhead's bar/row) --- */

  /** Any structural row/bar mutation invalidates the (anchor, head) pair —
   *  bar indices shift, rows shuffle, etc. Match the pattern already used by
   *  deleteSelection / applySnapshot: drop the selection and let the user
   *  re-select on the new layout. */
  function clearSelection() {
    selection.anchor = null
    selection.head = null
  }

  /** Insert a fresh bar AT `barIndex`, pushing existing bars down. Clones the bar at that index. */
  function insertBar(rowIndex: number, barIndex: number): number {
    const r = score.rows[rowIndex]
    if (!r) return -1
    const at = Math.max(0, Math.min(barIndex, r.bars.length))
    const tmpl = r.bars[at] ?? r.bars[at - 1]
    const fresh = tmpl ? cloneBarTemplate(tmpl) : makeBar(beatsPerBar.value)
    r.bars.splice(at, 0, fresh)
    clearSelection()
    return at
  }

  /** Append a fresh bar AFTER `barIndex`. Clones the bar at `barIndex`. */
  function appendBar(rowIndex: number, barIndex: number): number {
    const r = score.rows[rowIndex]
    if (!r) return -1
    const tmpl = r.bars[barIndex] ?? r.bars[r.bars.length - 1]
    const fresh = tmpl ? cloneBarTemplate(tmpl) : makeBar(beatsPerBar.value)
    const at = Math.max(0, Math.min(barIndex + 1, r.bars.length))
    r.bars.splice(at, 0, fresh)
    clearSelection()
    return at
  }

  /** Insert a fresh row AT `rowIndex`, pushing existing rows down. Clones the row at that index. */
  function insertRow(rowIndex: number): number {
    const at = Math.max(0, Math.min(rowIndex, score.rows.length))
    const tmpl = score.rows[at] ?? score.rows[at - 1]
    const fresh = tmpl ? cloneRowTemplate(tmpl) : makeRow(beatsPerBar.value, 4)
    score.rows.splice(at, 0, fresh)
    clearSelection()
    return at
  }

  /** Append a fresh row AFTER `rowIndex`. Clones the row at `rowIndex`. */
  function appendRow(rowIndex: number): number {
    const tmpl = score.rows[rowIndex] ?? score.rows[score.rows.length - 1]
    const fresh = tmpl ? cloneRowTemplate(tmpl) : makeRow(beatsPerBar.value, 4)
    const at = Math.max(0, Math.min(rowIndex + 1, score.rows.length))
    score.rows.splice(at, 0, fresh)
    clearSelection()
    return at
  }

  /** Backwards-compatible aliases used by `+ new bar / + new row` buttons. */
  function addBarAfter(rowIndex: number, barIndex: number): number {
    return appendBar(rowIndex, barIndex)
  }
  function addRowAfter(rowIndex: number): number {
    return appendRow(rowIndex)
  }

  function deleteRow(rowIndex: number) {
    if (score.rows.length <= 1) return
    score.rows.splice(rowIndex, 1)
    clearSelection()
  }

  function moveRow(rowIndex: number, delta: number) {
    const target = rowIndex + delta
    if (target < 0 || target >= score.rows.length) return
    const [r] = score.rows.splice(rowIndex, 1)
    score.rows.splice(target, 0, r)
    clearSelection()
  }

  function duplicateRow(rowIndex: number) {
    const r = score.rows[rowIndex]
    if (!r) return
    const copy = cloneRow(r)
    score.rows.splice(rowIndex + 1, 0, copy)
    clearSelection()
  }

  function deleteBar(rowIndex: number, barIndex: number) {
    const r = score.rows[rowIndex]
    if (!r) return
    if (r.bars.length <= 1) {
      deleteRow(rowIndex)
      return
    }
    r.bars.splice(barIndex, 1)
    clearSelection()
  }

  /** Move a bar to the end of the previous row (== "join" with previous row). */
  function joinPrevRow(rowIndex: number) {
    if (rowIndex === 0) return
    const prev = score.rows[rowIndex - 1]
    const cur = score.rows[rowIndex]
    if (!prev || !cur) return
    prev.bars.push(...cur.bars)
    score.rows.splice(rowIndex, 1)
    clearSelection()
  }

  /** Split a row into two at the given bar (the bar at barIndex starts the new row). */
  function breakRowAt(rowIndex: number, barIndex: number) {
    const r = score.rows[rowIndex]
    if (!r) return
    if (barIndex <= 0 || barIndex >= r.bars.length) return
    const tail = r.bars.splice(barIndex)
    const newRow = makeRow(beatsPerBar.value, 0)
    newRow.bars = tail
    newRow.title = ''
    newRow.key = null
    score.rows.splice(rowIndex + 1, 0, newRow)
    clearSelection()
  }

  function selectionRange(): { startRow: number; startBar: number; endRow: number; endBar: number } | null {
    if (!selection.anchor || !selection.head) return null
    const a = selection.anchor
    const b = selection.head
    // tuple-compare so very wide rows don't break the packing
    const aFirst = a.row !== b.row ? a.row < b.row : a.bar <= b.bar
    if (aFirst) {
      return { startRow: a.row, startBar: a.bar, endRow: b.row, endBar: b.bar }
    }
    return { startRow: b.row, startBar: b.bar, endRow: a.row, endBar: a.bar }
  }

  function collectSelectedBars(): Bar[] {
    const r = selectionRange()
    if (!r) return []
    const out: Bar[] = []
    for (let ri = r.startRow; ri <= r.endRow; ri++) {
      const row = score.rows[ri]
      if (!row) continue
      const startBar = ri === r.startRow ? r.startBar : 0
      const endBar = ri === r.endRow ? r.endBar : row.bars.length - 1
      for (let bi = startBar; bi <= endBar; bi++) {
        const b = row.bars[bi]
        if (b) out.push(cloneBar(b))
      }
    }
    return out
  }

  function copySelection() {
    const bars = collectSelectedBars()
    if (bars.length) clipboard.value = { bars }
  }

  function cutSelection() {
    const r = selectionRange()
    if (!r) return
    copySelection()
    deleteSelection()
  }

  function deleteSelection() {
    const r = selectionRange()
    if (!r) return
    for (let ri = r.endRow; ri >= r.startRow; ri--) {
      const row = score.rows[ri]
      if (!row) continue
      const startBar = ri === r.startRow ? r.startBar : 0
      const endBar = ri === r.endRow ? r.endBar : row.bars.length - 1
      row.bars.splice(startBar, endBar - startBar + 1)
      if (row.bars.length === 0 && score.rows.length > 1) {
        score.rows.splice(ri, 1)
      } else if (row.bars.length === 0) {
        row.bars.push(makeBar(beatsPerBar.value))
      }
    }
    // Belt-and-suspenders: never let the score collapse to zero rows / empty
    // last row. The per-iteration logic above handles single-row cuts, but a
    // multi-row "select all → cut" path could leave the loop without a last
    // row to fall back into.
    if (score.rows.length === 0) {
      score.rows.push(makeRow(beatsPerBar.value, 4))
    } else {
      const last = score.rows[score.rows.length - 1]
      if (last && last.bars.length === 0) last.bars.push(makeBar(beatsPerBar.value))
    }
    selection.anchor = null
    selection.head = null
  }

  /** Insert clipboard bars BEFORE the given location. */
  function pasteAt(rowIndex: number, barIndex: number) {
    if (!clipboard.value) return
    const row = score.rows[rowIndex]
    if (!row) return
    const fresh = clipboard.value.bars.map(cloneBar)
    row.bars.splice(barIndex, 0, ...fresh)
  }

  /** Replace selection with clipboard. */
  function pasteReplace() {
    if (!clipboard.value) return
    const r = selectionRange()
    if (!r) return
    const insertRow = r.startRow
    const insertBar = r.startBar
    deleteSelection()
    const row = score.rows[insertRow]
    if (!row) return
    const fresh = clipboard.value.bars.map(cloneBar)
    row.bars.splice(Math.min(insertBar, row.bars.length), 0, ...fresh)
  }

  function setSelection(anchor: { row: number; bar: number } | null, head?: { row: number; bar: number } | null) {
    selection.anchor = anchor
    selection.head = head ?? anchor
  }

  function inSelection(rowIndex: number, barIndex: number): boolean {
    const r = selectionRange()
    if (!r) return false
    if (rowIndex < r.startRow || rowIndex > r.endRow) return false
    if (rowIndex === r.startRow && barIndex < r.startBar) return false
    if (rowIndex === r.endRow && barIndex > r.endBar) return false
    return true
  }

  /** key in effect at a given row, looking back through previous rows. */
  function effectiveKey(rowIndex: number): string | null {
    for (let i = rowIndex; i >= 0; i--) {
      const k = score.rows[i]?.key
      if (k) return k
    }
    return null
  }

  function setTitle(t: string) {
    // Trim whitespace so a single space doesn't pretend to be a title.
    score.title = t.trim() || 'untitled'
  }

  function reset() {
    Object.assign(score, defaultScore())
  }

  return {
    score,
    beatsPerBar,
    cellsPerBeatNow,
    cellsPerBarNow,
    clipboard,
    selection,
    setTimeSignature,
    setBpm,
    setRowTitle,
    setRowDescription,
    setRowMarker,
    setRowKey,
    setPianoRollOpen,
    setPianoRollHeight,
    beatClipboard,
    yankBeat,
    pasteBeat,
    setBeatChord,
    updateBeat,
    regenerateBar,
    regenerateRow,
    addNote,
    removeNote,
    resizeNote,
    clearBarNotes,
    insertBar,
    appendBar,
    insertRow,
    appendRow,
    addRowAfter,
    deleteRow,
    moveRow,
    duplicateRow,
    addBarAfter,
    deleteBar,
    joinPrevRow,
    breakRowAt,
    copySelection,
    cutSelection,
    deleteSelection,
    pasteAt,
    pasteReplace,
    setSelection,
    inSelection,
    effectiveKey,
    setTitle,
    reset,
    selectionRange,
    undo,
    redo,
    canUndo,
    canRedo,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useScoreStore, import.meta.hot))
}

function cloneBar(b: Bar): Bar {
  return {
    id: uid('bar'),
    key: b.key,
    beats: b.beats.map((bt) => ({ ...bt })),
    notes: b.notes.map((n) => ({ ...n })),
  }
}

function cloneRow(r: Row): Row {
  return {
    id: uid('row'),
    title: r.title,
    description: r.description,
    marker: r.marker,
    key: r.key,
    bars: r.bars.map(cloneBar),
  }
}
