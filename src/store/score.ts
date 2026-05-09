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
import { presetByName, rollDicePreset } from '@/utils/presets'

// Storage version bumped: v5 had a single `style` enum per beat; v6 splits
// rhythm into shape/density/syncopation/voices so the renderer can place
// any subset of the voicing on any subdivision. migrateBar maps v5 →v6.
const STORAGE_KEY = 'chordprog3:score:v6'
const LEGACY_KEYS = ['chordprog3:score:v5']

const HARD_DEFAULTS: BeatSettings = {
  // "Most-pleasing-on-first-load": close-position voicing (no jazz
  // flavour bias), centered on middle C with a tighter ~2-octave window
  // so chords sound where ears expect them. shape=sustain + density=0.2
  // produces a gentle pad — ONE held chord per change, full voicing.
  // voices=1.0 fires the whole stack, so a casual user clicks play and
  // hears a complete chord rather than a guide-tone shell.
  voicing: 'close',
  rangeCenter: 60,
  rangeSpread: 12,
  shape: 'sustain',
  density: 0.2,
  syncopation: 0.05,
  voices: 1.0,
}

const PIANO_ROLL_DEFAULT_HEIGHT = 320

function defaultBeat(d: BeatSettings = HARD_DEFAULTS): Beat {
  return {
    chord: '',
    voicing: d.voicing,
    rangeCenter: d.rangeCenter,
    rangeSpread: d.rangeSpread,
    shape: d.shape,
    density: d.density,
    syncopation: d.syncopation,
    voices: d.voices,
  }
}

/** Clone a bar's settings (voicing / range / rhythm knobs) into a fresh blank bar — no chord, no notes. */
function cloneBarTemplate(b: Bar): Bar {
  return {
    id: uid('bar'),
    key: b.key,
    notes: [],
    beats: b.beats.map((bt) => ({
      chord: '',
      voicing: bt.voicing,
      rangeCenter: bt.rangeCenter,
      rangeSpread: bt.rangeSpread,
      shape: bt.shape,
      density: bt.density,
      syncopation: bt.syncopation,
      voices: bt.voices,
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

/**
 * Translate the v5 single-axis `style` enum into a v6 (shape, density,
 * syncopation, voices) tuple. Each row is the agent-research's
 * recommended migration table.
 */
function styleToShape(style: string | undefined): {
  shape: Beat['shape']
  density: number
  syncopation: number
  voices: number
} {
  switch (style) {
    case 'block':       return { shape: 'sustain',    density: 0.0,  syncopation: 0.0, voices: 1.0 }
    case 'sustain':     return { shape: 'sustain',    density: 0.0,  syncopation: 0.0, voices: 1.0 }
    case 'arp-up':      return { shape: 'arp-up',     density: 0.6,  syncopation: 0.0, voices: 0.25 }
    case 'arp-down':    return { shape: 'arp-down',   density: 0.6,  syncopation: 0.0, voices: 0.25 }
    case 'arp-up-down': return { shape: 'arp-updown', density: 0.6,  syncopation: 0.0, voices: 0.25 }
    case 'alberti':     return { shape: 'alberti',    density: 0.55, syncopation: 0.0, voices: 0.3 }
    case 'bossa':       return { shape: 'clave',      density: 0.5,  syncopation: 0.4, voices: 0.7 }
    case 'waltz':       return { shape: 'bass-chord', density: 0.45, syncopation: 0.0, voices: 0.7 }
    case 'bass-chord':  return { shape: 'bass-chord', density: 0.5,  syncopation: 0.2, voices: 0.7 }
    case 'reggae':      return { shape: 'charleston', density: 0.5,  syncopation: 1.0, voices: 0.7 }
    case 'rest':        return { shape: 'sustain',    density: 0.0,  syncopation: 0.0, voices: 0.0 }
    default:            return {
      shape: HARD_DEFAULTS.shape,
      density: HARD_DEFAULTS.density,
      syncopation: HARD_DEFAULTS.syncopation,
      voices: HARD_DEFAULTS.voices,
    }
  }
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
    // Prefer v6 fields if already present; otherwise translate v5 `style`.
    const fromStyle = styleToShape(typeof src.style === 'string' ? src.style : undefined)
    const shape: Beat['shape'] = typeof src.shape === 'string' ? src.shape as Beat['shape'] : fromStyle.shape
    const density = typeof src.density === 'number' && Number.isFinite(src.density)
      ? Math.max(0, Math.min(1, src.density))
      : fromStyle.density
    const syncopation = typeof src.syncopation === 'number' && Number.isFinite(src.syncopation)
      ? Math.max(0, Math.min(1, src.syncopation))
      : fromStyle.syncopation
    const voices = typeof src.voices === 'number' && Number.isFinite(src.voices)
      ? Math.max(0, Math.min(1, src.voices))
      : fromStyle.voices
    beats.push({
      chord: src.chord ?? '',
      voicing: src.voicing ?? 'close',
      rangeCenter: center,
      rangeSpread: spread,
      shape,
      density,
      syncopation,
      voices,
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
  // Always re-generate notes after a v5→v6 migration because the new engine
  // produces different rhythms; preserving stale notes would mismatch what
  // the user sees in the strip.
  out.notes = notesFromBar(out, ts)
  return out
}

function loadScore(): Score {
  if (typeof localStorage === 'undefined') return defaultScore()
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    // Fall back to legacy keys so v5 users don't lose their work on the
    // first launch after the v6 schema bump.
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k)
        if (legacy) { raw = legacy; break }
      }
    }
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
      // Same for piano-roll note selection: ids reference (pitch, startCell)
      // tuples that the snapshot may have moved or removed.
      if (selectedNoteIds.value.size) selectedNoteIds.value = new Set()
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
      voicing: beat.voicing,
      rangeCenter: beat.rangeCenter,
      rangeSpread: beat.rangeSpread,
      shape: beat.shape,
      density: beat.density,
      syncopation: beat.syncopation,
      voices: beat.voices,
    }
  }

  function pasteBeat(rowIndex: number, barIndex: number, beatIndex: number) {
    if (!beatClipboard.value) return
    updateBeat(rowIndex, barIndex, beatIndex, { ...beatClipboard.value })
  }

  /**
   * Roll a tasteful preset onto a beat (the "🎲 dice" action). Uses a
   * weighted sample from a curated table — heavy bias toward "pop ballad"
   * and "jazz comp", soft bias by chord type — with ±10% jitter on the
   * continuous knobs so consecutive rolls feel different. See utils/presets.ts.
   */
  function rollPresetForBeat(rowIndex: number, barIndex: number, beatIndex: number) {
    const beat = score.rows[rowIndex]?.bars[barIndex]?.beats[beatIndex]
    if (!beat) return
    const sampled = rollDicePreset(beat.chord || null)
    updateBeat(rowIndex, barIndex, beatIndex, sampled)
  }

  /** Apply a named preset (no jitter) — used by a future preset dropdown. */
  function applyPresetByName(rowIndex: number, barIndex: number, beatIndex: number, name: string) {
    const p = presetByName(name)
    if (!p) return
    const { name: _n, description: _d, weight: _w, ...settings } = p
    void _n; void _d; void _w
    updateBeat(rowIndex, barIndex, beatIndex, settings)
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
  /** Drop any selected-note ids whose (pitch, startCell) tuple no longer
   *  exists in the given bar. Called from regenerate / clear paths so the
   *  selection set never holds ghost ids that won't render. */
  function pruneNoteSelectionForBar(rowIndex: number, barIndex: number) {
    if (selectedNoteIds.value.size === 0) return
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const prefix = `${rowIndex}_${barIndex}_`
    const next = new Set<string>()
    for (const id of selectedNoteIds.value) {
      if (!id.startsWith(prefix)) {
        next.add(id) // belongs to a different bar — preserve
        continue
      }
      const [, , pitch, startCell] = id.split('_').map(Number)
      if (bar.notes.some((n) => n.pitch === pitch && n.startCell === startCell)) {
        next.add(id)
      }
    }
    if (next.size !== selectedNoteIds.value.size) selectedNoteIds.value = next
  }

  function regenerateBar(rowIndex: number, barIndex: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    bar.notes = notesFromBar(bar, score.timeSignature)
    pruneNoteSelectionForBar(rowIndex, barIndex)
  }

  function regenerateRow(rowIndex: number) {
    const r = score.rows[rowIndex]
    if (!r) return
    for (let bi = 0; bi < r.bars.length; bi++) {
      r.bars[bi].notes = notesFromBar(r.bars[bi], score.timeSignature)
      pruneNoteSelectionForBar(rowIndex, bi)
    }
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

  /**
   * Move a note to a new (pitch, startCell) within the same bar. Clamped to
   * the bar's cell range and to a legal MIDI pitch; if the destination
   * overlaps another note on the same pitch the move is silently rejected.
   */
  function moveNote(
    rowIndex: number,
    barIndex: number,
    noteIndex: number,
    newPitch: number,
    newStartCell: number,
  ) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const note = bar.notes[noteIndex]
    if (!note) return
    const cpBar = cellsPerBarNow.value
    const clampedPitch = Math.max(0, Math.min(127, Math.round(newPitch)))
    const clampedStart = Math.max(0, Math.min(cpBar - note.duration, Math.round(newStartCell)))
    if (clampedPitch === note.pitch && clampedStart === note.startCell) return
    if (overlapsExistingNote(bar.notes, clampedPitch, clampedStart, note.duration, noteIndex)) return
    note.pitch = clampedPitch
    note.startCell = clampedStart
  }

  /**
   * Resize a note from its LEFT edge — moves the start cell while keeping
   * the right edge fixed. Symmetric to resizeNote (which keeps the left edge
   * fixed and moves the right). Will refuse to overlap a same-pitch note.
   */
  function resizeNoteFromLeft(
    rowIndex: number,
    barIndex: number,
    noteIndex: number,
    newStartCell: number,
  ) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const note = bar.notes[noteIndex]
    if (!note) return
    const oldEnd = note.startCell + note.duration
    let target = Math.max(0, Math.min(oldEnd - 1, Math.round(newStartCell)))
    // Walk forward past any same-pitch note that would be overlapped.
    while (
      target < oldEnd - 1 &&
      overlapsExistingNote(bar.notes, note.pitch, target, oldEnd - target, noteIndex)
    ) {
      target++
    }
    if (overlapsExistingNote(bar.notes, note.pitch, target, oldEnd - target, noteIndex)) return
    note.startCell = target
    note.duration = oldEnd - target
  }

  /* --- piano-roll note selection (multi-select state, used by PianoRoll
   *     for marquee / shift-click and by App.vue's backspace handler) --- */
  const selectedNoteIds = ref<Set<string>>(new Set())

  function setNoteSelection(ids: Iterable<string>) {
    selectedNoteIds.value = new Set(ids)
  }
  function clearNoteSelection() {
    if (selectedNoteIds.value.size) selectedNoteIds.value = new Set()
  }
  /** Delete every currently-selected note (keys are "ri_bi_pitch_startCell"). */
  function deleteSelectedNotes() {
    if (selectedNoteIds.value.size === 0) return
    // Group by (row, bar) so we can splice indices in descending order per
    // bar without invalidating earlier indices.
    const byBar = new Map<string, number[]>()
    for (const id of selectedNoteIds.value) {
      const parts = id.split('_').map(Number)
      if (parts.length < 4) continue
      const [ri, bi, pitch, startCell] = parts
      const bar = score.rows[ri]?.bars[bi]
      if (!bar) continue
      const idx = bar.notes.findIndex((n) => n.pitch === pitch && n.startCell === startCell)
      if (idx < 0) continue
      const k = `${ri}_${bi}`
      const list = byBar.get(k) ?? []
      list.push(idx)
      byBar.set(k, list)
    }
    for (const [k, indices] of byBar) {
      const [ri, bi] = k.split('_').map(Number)
      const bar = score.rows[ri]?.bars[bi]
      if (!bar) continue
      indices.sort((a, b) => b - a)
      for (const idx of indices) bar.notes.splice(idx, 1)
    }
    selectedNoteIds.value = new Set()
  }

  function clearBarNotes(rowIndex: number, barIndex: number) {
    const bar = score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    bar.notes = []
    pruneNoteSelectionForBar(rowIndex, barIndex)
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
    rollPresetForBeat,
    applyPresetByName,
    setBeatChord,
    updateBeat,
    regenerateBar,
    regenerateRow,
    addNote,
    removeNote,
    resizeNote,
    resizeNoteFromLeft,
    moveNote,
    clearBarNotes,
    selectedNoteIds,
    setNoteSelection,
    clearNoteSelection,
    deleteSelectedNotes,
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
