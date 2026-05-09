<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'
import { useMidiStore } from '@/store/midi'
import { cellsPerBar, cellsPerBeat, noteAtCell } from '@/utils/cells'
import { midiToName, parseChord } from '@/utils/music'
import { beatVoicing } from '@/utils/voicing'
import type { RhythmShape, VoicingMode } from '@/types'
import { PR_CELL_H, PR_CELL_W, PR_KEY_W } from '@/utils/layout'
import { useModifierKeys } from '@/composables/useModifierKeys'
import { PRESETS } from '@/utils/presets'
import Icon from '@/components/Icon.vue'

const score = useScoreStore()
const playback = usePlaybackStore()
const midi = useMidiStore()
const { altOrMeta, dHeld } = useModifierKeys()

/* ---- beat-settings strip (active = playhead) ---- */

const activeBeat = computed(() => {
  const r = score.score.rows[playback.playhead.rowIndex]
  const b = r?.bars[playback.playhead.barIndex]
  return b?.beats[playback.playhead.beatIndex] ?? null
})
const activeBeatNotes = computed(() => (activeBeat.value ? beatVoicing(activeBeat.value) : []))
const activeBeatChordOk = computed(() =>
  activeBeat.value?.chord ? parseChord(activeBeat.value.chord).ok : true,
)

const shapeOptions: { v: RhythmShape; label: string }[] = [
  { v: 'sustain', label: 'sustain (held pad)' },
  { v: 'pulse', label: 'pulse (8ths)' },
  { v: 'bass-chord', label: 'bass + chord (stride)' },
  { v: 'arp-up', label: 'arp ↑' },
  { v: 'arp-down', label: 'arp ↓' },
  { v: 'arp-updown', label: 'arp ↑↓' },
  { v: 'alberti', label: 'alberti (low-hi-mid-hi)' },
  { v: 'charleston', label: 'charleston (1, &2, 4)' },
  { v: 'syncopated', label: 'syncopated (dotted)' },
  { v: 'clave', label: 'clave 3-2 (latin)' },
]
const voicingOptions: { v: VoicingMode; label: string }[] = [
  { v: 'close', label: 'close' },
  { v: 'drop2', label: 'drop 2' },
  { v: 'drop3', label: 'drop 3' },
  { v: 'spread', label: 'spread (≥5ths)' },
  { v: 'wide', label: 'wide (≥octaves)' },
  { v: 'open', label: 'open (low root)' },
  { v: 'quartal', label: 'quartal (4ths)' },
  { v: 'rootless', label: 'rootless' },
  { v: 'shell', label: 'shell (1·3·7)' },
  { v: 'octave-doubled', label: 'octave-doubled' },
  { v: 'power', label: 'power (1·5)' },
]

function patchActive(
  patch: Partial<{
    voicing: VoicingMode
    rangeCenter: number
    rangeSpread: number
    shape: RhythmShape
    density: number
    syncopation: number
    voices: number
  }>,
) {
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.updateBeat(rowIndex, barIndex, beatIndex, patch)
}

function regenerateActiveBeat() {
  // empty patch triggers regenerate-from-chord on the bar
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.updateBeat(rowIndex, barIndex, beatIndex, {})
}

function yankActive() {
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.yankBeat(rowIndex, barIndex, beatIndex)
}
function pasteActive() {
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.pasteBeat(rowIndex, barIndex, beatIndex)
}

function rollDiceActive() {
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.rollPresetForBeat(rowIndex, barIndex, beatIndex)
}

function applyPresetActive(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  if (!name) return
  const { rowIndex, barIndex, beatIndex } = playback.playhead
  score.applyPresetByName(rowIndex, barIndex, beatIndex, name)
  // reset the select so the user can pick the same preset again
  ;(e.target as HTMLSelectElement).value = ''
}

const cpBeat = computed(() => cellsPerBeat(score.score.timeSignature))
const cpBar = computed(() => cellsPerBar(score.score.timeSignature))
const barWidthPx = computed(() => cpBar.value * PR_CELL_W)

const currentRowIndex = computed(() => {
  const ri = playback.playhead.rowIndex
  if (ri < 0) return 0
  if (ri >= score.score.rows.length) return Math.max(0, score.score.rows.length - 1)
  return ri
})
const currentRow = computed(() => score.score.rows[currentRowIndex.value] ?? null)

// full 88-key range: A0 (21) to C8 (108)
const PR_LOW = 21
const PR_HIGH = 108
const pitches = computed(() => {
  const arr: number[] = []
  for (let p = PR_HIGH; p >= PR_LOW; p--) arr.push(p)
  return arr
})
const totalHeight = computed(() => pitches.value.length * PR_CELL_H)

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
const beatLineEvery = computed(() => cpBeat.value)

/**
 *   draw   — alt/cmd held, click+drag emits new notes (the old default).
 *   delete — `d` held, click+drag erases notes under the cursor.
 *   select — default. Click empty area = marquee. Click note = select +
 *            move-drag. Click within EDGE_CELLS of a note's edge = resize.
 */
type Mode = 'draw' | 'delete' | 'select'
const mode = computed<Mode>(() => {
  if (altOrMeta.value) return 'draw'
  if (dHeld.value) return 'delete'
  return 'select'
})

/** Note identity stable across re-sorts: a quartet is unique within a row. */
function noteId(ri: number, bi: number, pitch: number, startCell: number): string {
  return `${ri}_${bi}_${pitch}_${startCell}`
}
// Note selection lives in the score store so App.vue's backspace handler
// (and any other consumer) can act on it directly.
const selectedNoteIds = computed(() => score.selectedNoteIds)
function setNoteSelection(ids: Iterable<string>) { score.setNoteSelection(ids) }

/** Cursor-style hint shown by the bar grid root, based on mode. Default
 *  stays as the OS pointer in select mode (so the user knows they can pick
 *  notes); draw mode swaps to a pencil; delete mode to a stark X. */
const gridCursorClass = computed(() => {
  if (mode.value === 'draw') return 'cursor-pen'
  if (mode.value === 'delete') return 'cursor-delete'
  return 'cursor-default'
})

/** How close to a note's edge the cursor must be (in cells) to trigger a
 *  resize-from-edge instead of a body-drag. 0.4 cell ≈ 6.4px @ PR_CELL_W=16. */
const EDGE_CELLS = 0.4

interface DragState {
  kind: 'create' | 'move' | 'resize-left' | 'resize-right' | 'delete' | 'marquee'
  rowIndex: number
  barIndex: number
  /** cursor cell at mousedown */
  startCell: number
  /** cursor pitch at mousedown */
  startPitch: number
  /** for create/resize-*: live note index (re-found after each mutation by
   *  full (pitch, startCell) match — `pitch` alone collides when the bar
   *  has multiple notes on the same pitch). */
  noteIndex?: number
  /** for resize-*: the note's CURRENT (pitch, startCell), kept in sync as
   *  the user drags so we can re-find it after each mutation. */
  notePitch?: number
  noteStartCell?: number
  /** for resize-right: stable left anchor */
  anchorStartCell?: number
  /** for move: original positions + currently-known live positions of every
   *  selected note. Live (cur) is updated after each successful tick so the
   *  next tick's findIndex matches even when the renderer hasn't repainted. */
  origs?: Array<{
    rowIndex: number
    barIndex: number
    origPitch: number
    origStartCell: number
    duration: number
    curPitch: number
    curStartCell: number
  }>
  /** for marquee: live cursor in row-local pixel coords */
  marqueeRect?: { x0: number; y0: number; x1: number; y1: number }
  /** for marquee: the selection that existed at mousedown — preserved when
   *  shift-marquee adds to the existing set instead of replacing it. */
  baseSelection?: Set<string>
  /** Set true once the cursor leaves the start cell — distinguishes a
   *  click from a drag for the move/marquee paths. */
  moved?: boolean
}
const drag = ref<DragState | null>(null)

function pitchAtY(localY: number): number {
  const idx = Math.floor(localY / PR_CELL_H)
  return pitches.value[Math.max(0, Math.min(pitches.value.length - 1, idx))]
}
function cellAtX(localX: number): number {
  return Math.max(0, Math.min(cpBar.value - 1, Math.floor(localX / PR_CELL_W)))
}

/** Hit-test where the cursor lands on a note: edge zones for resize, body
 *  for select/move. Returns null if the point isn't inside the note rect.
 *  Edge width scales with note duration so a 1-cell note still has a
 *  clickable body zone (otherwise its 6.4px edges would eat the whole
 *  hit area). */
function hitNoteRegion(
  note: { startCell: number; duration: number },
  cellFloat: number,
): 'left' | 'right' | 'body' | null {
  if (note.duration <= 0) return null
  const left = note.startCell
  const right = note.startCell + note.duration
  if (cellFloat < left || cellFloat >= right) return null
  // Scale edge zone so short notes still have a body. For duration ≥ 2 cells
  // we use the full EDGE_CELLS; for shorter notes the zone shrinks linearly.
  const edge = note.duration >= 2 ? EDGE_CELLS : Math.max(0.15, note.duration * 0.25)
  if (cellFloat - left < edge) return 'left'
  if (right - cellFloat < edge) return 'right'
  return 'body'
}

function clearNoteSelection() {
  score.clearNoteSelection()
}

/**
 * Compute the pitches/cells actually under the cursor right now from a
 * mouse event, handling the case where the cursor has wandered into a
 * different bar element on the same row.
 */
function locateAt(e: MouseEvent): { rowIndex: number; barIndex: number; pitch: number; cellFloat: number } | null {
  const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
    '[data-pr-row][data-pr-bar]',
  ) as HTMLElement | null
  if (!el) return null
  const ri = parseInt(el.dataset.prRow ?? '-1', 10)
  const bi = parseInt(el.dataset.prBar ?? '-1', 10)
  if (ri < 0 || bi < 0) return null
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const pitch = pitchAtY(y)
  const cellFloat = x / PR_CELL_W
  return { rowIndex: ri, barIndex: bi, pitch, cellFloat }
}

function onBarMouseDown(e: MouseEvent, barIndex: number) {
  if (e.button !== 0) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const pitch = pitchAtY(y)
  const cell = cellAtX(x)
  const cellFloat = x / PR_CELL_W

  const ri = currentRowIndex.value
  const bar = score.score.rows[ri]?.bars[barIndex]
  if (!bar) return

  // ── DRAW mode (alt/cmd) ──
  if (mode.value === 'draw') {
    score.addNote(ri, barIndex, { pitch, startCell: cell, duration: 1 })
    const refreshed = score.score.rows[ri]?.bars[barIndex]
    if (!refreshed) return
    const idx = noteAtCell(refreshed.notes, pitch, cell)
    if (idx < 0) return
    // Auto-select the newly drawn note so backspace etc. apply to it
    // without an extra click — matches every modern DAW.
    setNoteSelection(new Set([noteId(ri, barIndex, pitch, cell)]))
    drag.value = {
      kind: 'create',
      rowIndex: ri,
      barIndex,
      startCell: cell,
      startPitch: pitch,
      noteIndex: idx,
      notePitch: pitch,
      noteStartCell: cell,
      anchorStartCell: cell,
    }
    playback.previewNotes([pitch], 0.25)
    window.addEventListener('mousemove', onWinMouseMove)
    window.addEventListener('mouseup', onWinMouseUp)
    e.preventDefault()
    return
  }

  // ── DELETE mode (`d` held) ──
  if (mode.value === 'delete') {
    deleteAt(ri, barIndex, pitch, cell)
    drag.value = {
      kind: 'delete',
      rowIndex: ri,
      barIndex,
      startCell: cell,
      startPitch: pitch,
    }
    window.addEventListener('mousemove', onWinMouseMove)
    window.addEventListener('mouseup', onWinMouseUp)
    e.preventDefault()
    return
  }

  // ── SELECT mode (default) ──
  const hitIdx = noteAtCell(bar.notes, pitch, cell)
  if (hitIdx >= 0) {
    const note = bar.notes[hitIdx]
    const region = hitNoteRegion(note, cellFloat)
    const id = noteId(ri, barIndex, note.pitch, note.startCell)

    if (region === 'left') {
      drag.value = {
        kind: 'resize-left',
        rowIndex: ri,
        barIndex,
        startCell: cell,
        startPitch: pitch,
        noteIndex: hitIdx,
        notePitch: note.pitch,
        noteStartCell: note.startCell,
      }
    } else if (region === 'right') {
      drag.value = {
        kind: 'resize-right',
        rowIndex: ri,
        barIndex,
        startCell: cell,
        startPitch: pitch,
        noteIndex: hitIdx,
        notePitch: note.pitch,
        noteStartCell: note.startCell,
        anchorStartCell: note.startCell,
      }
    } else {
      // body — select + start move-drag
      let toggledOff = false
      if (e.shiftKey) {
        const next = new Set(selectedNoteIds.value)
        if (next.has(id)) {
          next.delete(id)
          toggledOff = true
        } else {
          next.add(id)
        }
        setNoteSelection(next)
      } else if (!selectedNoteIds.value.has(id)) {
        setNoteSelection(new Set([id]))
      }
      // shift-click that DESELECTED the note shouldn't open a move-drag —
      // the user's intent was "remove from selection, do nothing else".
      if (toggledOff) {
        e.preventDefault()
        return
      }
      // Snapshot all currently-selected notes' positions for move-drag.
      const origs: NonNullable<DragState['origs']> = []
      for (const selId of selectedNoteIds.value) {
        const parts = selId.split('_').map(Number)
        const [sri, sbi, spc, ssc] = parts
        const sbar = score.score.rows[sri]?.bars[sbi]
        if (!sbar) continue
        const sn = sbar.notes.find((n) => n.pitch === spc && n.startCell === ssc)
        if (sn) origs.push({
          rowIndex: sri,
          barIndex: sbi,
          origPitch: sn.pitch,
          origStartCell: sn.startCell,
          duration: sn.duration,
          curPitch: sn.pitch,
          curStartCell: sn.startCell,
        })
      }
      drag.value = {
        kind: 'move',
        rowIndex: ri,
        barIndex,
        startCell: cell,
        startPitch: pitch,
        origs,
      }
    }
    window.addEventListener('mousemove', onWinMouseMove)
    window.addEventListener('mouseup', onWinMouseUp)
    e.preventDefault()
    return
  }

  // Clicked empty area → marquee select. shift-marquee preserves the
  // existing selection (the marquee hits get UNIONed in); plain marquee
  // replaces.
  const baseSelection = e.shiftKey ? new Set(selectedNoteIds.value) : new Set<string>()
  if (!e.shiftKey) clearNoteSelection()
  drag.value = {
    kind: 'marquee',
    rowIndex: ri,
    barIndex,
    startCell: cell,
    startPitch: pitch,
    marqueeRect: { x0: x, y0: y, x1: x, y1: y },
    baseSelection,
  }
  window.addEventListener('mousemove', onWinMouseMove)
  window.addEventListener('mouseup', onWinMouseUp)
  e.preventDefault()
}

function onWinMouseMove(e: MouseEvent) {
  const d = drag.value
  if (!d) return

  switch (d.kind) {
    case 'create':
    case 'resize-right': {
      // Stretch the note's right edge under the cursor; allow dragging
      // through later bars on the same row (clamp to original bar end).
      const loc = locateAt(e)
      let endCell: number
      const anchor = d.anchorStartCell ?? d.startCell
      if (loc && loc.rowIndex === d.rowIndex) {
        if (loc.barIndex > d.barIndex) {
          endCell = cpBar.value - 1
        } else if (loc.barIndex < d.barIndex) {
          endCell = anchor
        } else {
          endCell = Math.max(anchor, Math.floor(loc.cellFloat))
        }
      } else {
        // Off-row fallback: stay clamped to original bar
        const origEl = document.querySelector(
          `[data-pr-row="${d.rowIndex}"][data-pr-bar="${d.barIndex}"]`,
        ) as HTMLElement | null
        if (!origEl) return
        const rect = origEl.getBoundingClientRect()
        endCell = Math.max(anchor, cellAtX(e.clientX - rect.left))
      }
      const newDur = Math.max(1, endCell - anchor + 1)
      if (d.noteIndex !== undefined) score.resizeNote(d.rowIndex, d.barIndex, d.noteIndex, newDur)
      return
    }

    case 'resize-left': {
      // Shrink/grow the LEFT edge while keeping the right edge fixed.
      const loc = locateAt(e)
      const bar = score.score.rows[d.rowIndex]?.bars[d.barIndex]
      if (!bar || d.notePitch === undefined || d.noteStartCell === undefined) return
      // Re-find by (pitch, startCell) — pitch alone collides with same-pitch
      // siblings in the same bar.
      const idx = bar.notes.findIndex(
        (n) => n.pitch === d.notePitch && n.startCell === d.noteStartCell,
      )
      if (idx < 0) return
      d.noteIndex = idx
      let newStart: number
      if (loc && loc.rowIndex === d.rowIndex && loc.barIndex === d.barIndex) {
        newStart = Math.max(0, Math.floor(loc.cellFloat))
      } else {
        return
      }
      const oldId = noteId(d.rowIndex, d.barIndex, d.notePitch, d.noteStartCell)
      score.resizeNoteFromLeft(d.rowIndex, d.barIndex, idx, newStart)
      const moved = bar.notes[idx]
      if (moved) {
        d.noteStartCell = moved.startCell
        // Replace stale id in the selection set with the new (pitch, startCell).
        if (selectedNoteIds.value.has(oldId)) {
          const next = new Set(selectedNoteIds.value)
          next.delete(oldId)
          next.add(noteId(d.rowIndex, d.barIndex, moved.pitch, moved.startCell))
          setNoteSelection(next)
        }
      }
      return
    }

    case 'move': {
      // Translate every snapshotted note by (dPitch, dCells) from drag start.
      // Each origs entry tracks its CURRENT (curPitch, curStartCell), updated
      // on every successful tick so we can re-find the live note even when
      // multiple ticks fire between renders.
      const loc = locateAt(e)
      if (!loc) return
      if (loc.rowIndex !== d.rowIndex) return // confine to original row for v1
      const dPitch = loc.pitch - d.startPitch
      // dCells in BAR-RELATIVE cells when cursor stays in the original bar.
      // When the cursor crosses into a sibling bar on the same row we still
      // clamp moveNote to the original bar (the store enforces it), but we
      // need to compute dCells in a way that doesn't wrap negative as the
      // user's cursor enters bar 2 (where loc.cellFloat resets to 0).
      let cursorCell: number
      if (loc.barIndex === d.barIndex) {
        cursorCell = Math.floor(loc.cellFloat)
      } else if (loc.barIndex > d.barIndex) {
        cursorCell = cpBar.value - 1 // pinned to end of original bar
      } else {
        cursorCell = 0 // pinned to start of original bar
      }
      const dCells = cursorCell - d.startCell
      if (!d.origs) return
      const newSelection = new Set<string>()
      for (const o of d.origs) {
        const bar = score.score.rows[o.rowIndex]?.bars[o.barIndex]
        if (!bar) continue
        const idx = bar.notes.findIndex(
          (n) => n.pitch === o.curPitch && n.startCell === o.curStartCell,
        )
        if (idx < 0) {
          // Note couldn't be located — keep the stale selection visible so
          // it doesn't silently vanish from the highlighted set.
          newSelection.add(noteId(o.rowIndex, o.barIndex, o.curPitch, o.curStartCell))
          continue
        }
        const targetPitch = o.origPitch + dPitch
        const targetCell = o.origStartCell + dCells
        score.moveNote(o.rowIndex, o.barIndex, idx, targetPitch, targetCell)
        const moved = bar.notes[idx]
        if (moved) {
          o.curPitch = moved.pitch
          o.curStartCell = moved.startCell
          newSelection.add(noteId(o.rowIndex, o.barIndex, moved.pitch, moved.startCell))
        }
      }
      setNoteSelection(newSelection)
      d.moved = true
      return
    }

    case 'delete': {
      // If the user releases `d` mid-drag, end the drag (cursor will already
      // have flipped back to default via the dHeld watcher).
      if (!dHeld.value) {
        onWinMouseUp()
        return
      }
      const loc = locateAt(e)
      if (!loc || loc.rowIndex !== currentRowIndex.value) return
      deleteAt(loc.rowIndex, loc.barIndex, loc.pitch, Math.floor(loc.cellFloat))
      return
    }

    case 'marquee': {
      const origEl = document.querySelector(
        `[data-pr-row="${d.rowIndex}"][data-pr-bar="${d.barIndex}"]`,
      ) as HTMLElement | null
      if (!origEl || !d.marqueeRect) return
      const rect = origEl.getBoundingClientRect()
      d.marqueeRect = {
        x0: d.marqueeRect.x0,
        y0: d.marqueeRect.y0,
        x1: e.clientX - rect.left,
        y1: e.clientY - rect.top,
      }
      // recompute selection: every note within the rect (in the marquee's
      // origin bar — single-bar marquee for v1).
      computeMarqueeSelection(d)
      return
    }
  }
}

function computeMarqueeSelection(d: DragState) {
  if (!d.marqueeRect) return
  const bar = score.score.rows[d.rowIndex]?.bars[d.barIndex]
  if (!bar) return
  const r = d.marqueeRect
  const xLo = Math.min(r.x0, r.x1)
  const xHi = Math.max(r.x0, r.x1)
  const yLo = Math.min(r.y0, r.y1)
  const yHi = Math.max(r.y0, r.y1)
  const cellLo = xLo / PR_CELL_W
  const cellHi = xHi / PR_CELL_W
  // Start from the base selection captured at marquee-start so a shift-
  // drag UNIONs the marquee hits onto the existing selection.
  const next = new Set<string>(d.baseSelection ?? [])
  for (const n of bar.notes) {
    const noteLeft = n.startCell
    const noteRight = n.startCell + n.duration
    if (noteRight < cellLo || noteLeft > cellHi) continue
    const yTop = noteY(n.pitch)
    const yBot = yTop + PR_CELL_H
    if (yBot < yLo || yTop > yHi) continue
    next.add(noteId(d.rowIndex, d.barIndex, n.pitch, n.startCell))
  }
  setNoteSelection(next)
}

function deleteAt(rowIndex: number, barIndex: number, pitch: number, cell: number) {
  const bar = score.score.rows[rowIndex]?.bars[barIndex]
  if (!bar) return
  const idx = noteAtCell(bar.notes, pitch, cell)
  if (idx >= 0) score.removeNote(rowIndex, barIndex, idx)
}

function onWinMouseUp() {
  // For a click that didn't actually drag (move kind, no movement), keep
  // the single-note selection from mousedown — already set, just exit.
  drag.value = null
  window.removeEventListener('mousemove', onWinMouseMove)
  window.removeEventListener('mouseup', onWinMouseUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWinMouseMove)
  window.removeEventListener('mouseup', onWinMouseUp)
  // safety: release any held key-column glide note on unmount
  if (glidePitch !== null) {
    playback.noteOff(glidePitch)
    glidePitch = null
  }
  window.removeEventListener('mousemove', onKeyGlideMove)
  window.removeEventListener('mouseup', onKeyGlideUp)
  window.removeEventListener('blur', onKeyGlideUp)
})

/* --- piano-key column: press-and-glide ----------------------------------
 * Pressing a key starts a sustained note. Sliding the cursor onto another
 * key releases the previous and attacks the new one — like running a finger
 * across an actual keyboard. Releasing the mouse silences the held note.
 */
let glidePitch: number | null = null
function startGlide(p: number) {
  if (glidePitch === p) return
  if (glidePitch !== null) playback.noteOff(glidePitch)
  playback.noteOn(p)
  glidePitch = p
}
function onKeyMouseDown(e: MouseEvent, pitch: number) {
  if (e.button !== 0) return
  e.preventDefault()
  startGlide(pitch)
  window.addEventListener('mousemove', onKeyGlideMove)
  window.addEventListener('mouseup', onKeyGlideUp)
  // window blur (e.g. alt-tab) silently misses mouseup — release any held note
  window.addEventListener('blur', onKeyGlideUp)
}
function onKeyGlideMove(e: MouseEvent) {
  const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
    '[data-pr-key]',
  ) as HTMLElement | null
  if (!el) return
  const p = parseInt(el.dataset.prKey ?? '-1', 10)
  if (p >= 0) startGlide(p)
}
function onKeyGlideUp() {
  if (glidePitch !== null) {
    playback.noteOff(glidePitch)
    glidePitch = null
  }
  window.removeEventListener('mousemove', onKeyGlideMove)
  window.removeEventListener('mouseup', onKeyGlideUp)
  window.removeEventListener('blur', onKeyGlideUp)
}

function regenerateBar(barIndex: number) {
  score.regenerateBar(currentRowIndex.value, barIndex)
}
function clearBar(barIndex: number) {
  score.clearBarNotes(currentRowIndex.value, barIndex)
}

function noteY(pitch: number): number {
  const idx = pitches.value.indexOf(pitch)
  if (idx < 0) return -100
  return idx * PR_CELL_H
}

function isPlayheadInBar(barIndex: number): boolean {
  return (
    playback.playhead.rowIndex === currentRowIndex.value &&
    playback.playhead.barIndex === barIndex
  )
}
function playheadCellInBar(barIndex: number): number | null {
  if (!isPlayheadInBar(barIndex)) return null
  return playback.playhead.beatIndex * cpBeat.value
}

const bodyRef = ref<HTMLElement | null>(null)

/** Place middle-C (MIDI 60) close to the vertical middle of the visible viewport. */
function scrollToMiddleC() {
  if (!bodyRef.value) return
  const idx = pitches.value.indexOf(60)
  if (idx < 0) return
  const cTop = idx * PR_CELL_H
  const view = bodyRef.value.clientHeight
  bodyRef.value.scrollTop = Math.max(0, cTop - view / 2 + PR_CELL_H / 2)
}

onMounted(() => {
  nextTick(scrollToMiddleC)
})

watch(
  () => currentRowIndex.value,
  () => {
    if (bodyRef.value) bodyRef.value.scrollLeft = 0
  },
)

/**
 * Keep the currently-playing bar in view during playback. When the playhead
 * advances to a bar whose right edge is past the visible viewport (or its
 * left edge is to the left of the scroll position), scroll horizontally to
 * bring the bar fully into view, accounting for the sticky pitch column.
 */
watch(
  () => playback.playhead.barIndex,
  (bi) => {
    if (!score.score.pianoRollOpen) return
    const el = bodyRef.value
    if (!el) return
    const barX = bi * barWidthPx.value
    const view = el.clientWidth - PR_KEY_W
    const cur = el.scrollLeft
    const visibleStart = cur
    const visibleEnd = cur + view
    if (barX < visibleStart) {
      el.scrollTo({ left: barX, behavior: 'smooth' })
    } else if (barX + barWidthPx.value > visibleEnd) {
      el.scrollTo({ left: barX + barWidthPx.value - view, behavior: 'smooth' })
    }
  },
)

watch(
  () => score.score.pianoRollOpen,
  (v) => {
    if (v) nextTick(scrollToMiddleC)
  },
)

/* --- vertical resize handle --- */
let resizeStartY = 0
let resizeStartH = 0
function onResizeMouseDown(e: MouseEvent) {
  e.preventDefault()
  resizeStartY = e.clientY
  resizeStartH = score.score.pianoRollHeight
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
  document.body.style.cursor = 'ns-resize'
}
function onResizeMove(e: MouseEvent) {
  // dragging up should grow the panel (it sits at the bottom)
  const dy = resizeStartY - e.clientY
  score.setPianoRollHeight(resizeStartH + dy)
}
function onResizeUp() {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
  document.body.style.cursor = ''
}
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
})
</script>

<template>
  <section
    v-if="score.score.pianoRollOpen"
    class="border-t border-[var(--color-line)] bg-[var(--color-bg-1)] flex flex-col relative"
    :style="{ height: score.score.pianoRollHeight + 'px' }"
  >
    <!-- top resize handle (drag to resize) -->
    <div
      class="absolute -top-1 left-0 right-0 h-2 z-40 hover:bg-[var(--color-line-strong)] flex items-center justify-center"
      style="cursor: ns-resize"
      @mousedown="onResizeMouseDown"
      title="drag to resize piano roll"
    >
      <span class="block h-px w-12 bg-[var(--color-line-strong)] opacity-60"></span>
    </div>
    <header
      class="flex items-center gap-2 px-2 h-8 bg-[var(--color-bg-2)] border-b border-[var(--color-line)] text-[10px] uppercase tracking-wider text-[var(--color-fg-2)]"
    >
      <button
        class="flex items-center gap-1 hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] px-2"
        style="min-height: 26px"
        @click="score.setPianoRollOpen(false)"
        title="collapse piano roll"
      >
        <Icon name="chevron-down" :size="13" />
        <span>piano roll</span>
      </button>
      <span class="text-[var(--color-fg-3)]">—</span>
      <button
        class="hover:bg-[var(--color-bg-3)] hover:text-[var(--color-fg-0)] flex items-center justify-center"
        style="min-width: 28px; min-height: 26px"
        @click="playback.stepRow(-1)"
        title="prev row  (shift+↑)"
      >
        <Icon name="chevron-up" :size="13" />
      </button>
      <span class="text-[var(--color-fg-1)]" v-if="currentRow">
        row {{ currentRowIndex + 1 }}
        <span v-if="currentRow.title" class="text-[var(--color-fg-3)] normal-case">({{ currentRow.title }})</span>
      </span>
      <button
        class="hover:bg-[var(--color-bg-3)] hover:text-[var(--color-fg-0)] flex items-center justify-center"
        style="min-width: 28px; min-height: 26px"
        @click="playback.stepRow(1)"
        title="next row  (shift+↓)"
      >
        <Icon name="chevron-down" :size="13" />
      </button>
      <span class="ml-2 normal-case lowercase text-[var(--color-fg-3)]">
        <span v-if="mode === 'draw'">draw mode — click+drag empty cells to create notes</span>
        <span v-else-if="mode === 'delete'">delete mode — click+drag through notes to remove</span>
        <span v-else>select mode — click note to select, drag to move, drag edges to resize, drag empty for marquee · alt/cmd = draw · d = delete</span>
      </span>
      <div class="flex-1"></div>
      <button
        class="px-2 hover:bg-[var(--color-bg-3)] hover:text-[var(--color-fg-0)] flex items-center gap-1"
        style="min-height: 26px"
        title="scroll to middle C"
        @click="scrollToMiddleC"
      >
        <Icon name="crosshair" :size="11" />
        <span>C4</span>
      </button>
    </header>
    <!-- beat-settings strip — operates on the playhead beat -->
    <div
      class="flex items-center gap-2 px-2 h-9 bg-[var(--color-bg-1)] border-b border-[var(--color-line)] text-[10px] uppercase tracking-wider text-[var(--color-fg-2)] overflow-x-auto"
    >
      <span class="text-[var(--color-fg-3)] shrink-0">
        beat r{{ playback.playhead.rowIndex + 1 }}·b{{ playback.playhead.barIndex + 1 }}·{{ playback.playhead.beatIndex + 1 }}
      </span>
      <span
        v-if="activeBeat"
        class="px-1.5 py-0.5 border tracking-tight normal-case shrink-0"
        :class="
          !activeBeat.chord
            ? 'text-[var(--color-fg-3)] border-[var(--color-line)]'
            : activeBeatChordOk
              ? 'text-[var(--color-fg-0)] border-[var(--color-line-strong)]'
              : 'text-[var(--color-error)] border-[var(--color-error)] bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]'
        "
        :title="activeBeat.chord || 'no chord on this beat'"
      >
        {{ activeBeat.chord || '—' }}
      </span>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0">
        <span>voicing</span>
        <select
          :value="activeBeat.voicing"
          @change="(e) => patchActive({ voicing: (e.target as HTMLSelectElement).value as VoicingMode })"
          class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-1 py-0.5 text-[var(--color-fg-0)] cursor-pointer text-right normal-case"
        >
          <option v-for="o in voicingOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
        </select>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0">
        <span>shape</span>
        <select
          :value="activeBeat.shape"
          @change="(e) => patchActive({ shape: (e.target as HTMLSelectElement).value as RhythmShape })"
          class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-1 py-0.5 text-[var(--color-fg-0)] cursor-pointer text-right normal-case"
        >
          <option v-for="o in shapeOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
        </select>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0" title="how busy the rhythm is — top hits kept, weak hits dropped first">
        <span>density</span>
        <input
          type="range" min="0" max="100"
          :value="Math.round(activeBeat.density * 100)"
          @input="(e) => patchActive({ density: parseInt((e.target as HTMLInputElement).value, 10) / 100 })"
          class="w-20 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-8 text-right">{{ Math.round(activeBeat.density * 100) }}%</span>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0" title="probability of pushing strong-beat hits onto the &-of">
        <span>sync</span>
        <input
          type="range" min="0" max="100"
          :value="Math.round(activeBeat.syncopation * 100)"
          @input="(e) => patchActive({ syncopation: parseInt((e.target as HTMLInputElement).value, 10) / 100 })"
          class="w-20 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-8 text-right">{{ Math.round(activeBeat.syncopation * 100) }}%</span>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0" title="how many voicing-notes fire per chord stab — top voice → 3rd/7th → extensions → 5 → root">
        <span>voices</span>
        <input
          type="range" min="0" max="100"
          :value="Math.round(activeBeat.voices * 100)"
          @input="(e) => patchActive({ voices: parseInt((e.target as HTMLInputElement).value, 10) / 100 })"
          class="w-20 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-8 text-right">{{ Math.round(activeBeat.voices * 100) }}%</span>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0">
        <span>center</span>
        <input
          type="range"
          min="24"
          max="96"
          :value="activeBeat.rangeCenter"
          @input="(e) => patchActive({ rangeCenter: parseInt((e.target as HTMLInputElement).value, 10) })"
          class="w-20 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-7">{{ midiToName(activeBeat.rangeCenter) }}</span>
      </label>
      <label v-if="activeBeat" class="flex items-center gap-1 shrink-0">
        <span>spread</span>
        <input
          type="range"
          min="0"
          max="36"
          :value="activeBeat.rangeSpread"
          @input="(e) => patchActive({ rangeSpread: parseInt((e.target as HTMLInputElement).value, 10) })"
          class="w-20 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-8">±{{ activeBeat.rangeSpread }}st</span>
      </label>
      <span class="text-[var(--color-fg-3)] shrink-0">notes</span>
      <span class="text-[var(--color-fg-1)] normal-case tracking-tight min-w-0 truncate flex-1">
        {{ activeBeatNotes.length ? activeBeatNotes.map(midiToName).join(' ') : '—' }}
      </span>
      <select
        :value="''"
        @change="applyPresetActive"
        class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-1 py-0.5 text-[var(--color-fg-0)] cursor-pointer text-right normal-case shrink-0"
        title="apply a tasteful preset to this beat"
      >
        <option value="" disabled>preset…</option>
        <option v-for="p in PRESETS" :key="p.name" :value="p.name" :title="p.description">{{ p.name }}</option>
      </select>
      <button
        class="btn-icon-sm shrink-0"
        title="roll a tasteful preset onto this beat (chord-aware random) — keyboard r"
        aria-label="dice — roll preset"
        @click="rollDiceActive"
      >
        <span class="text-[14px] leading-none">⚄</span>
      </button>
      <button
        class="btn-icon-sm shrink-0"
        title="yank beat settings — voicing / range / shape / density / sync / voices  (y)"
        aria-label="yank beat settings"
        @click="yankActive"
      >
        <Icon name="copy" :size="13" />
      </button>
      <button
        class="btn-icon-sm shrink-0 disabled:opacity-30"
        title="paste yanked settings here  (p)"
        aria-label="paste beat settings"
        :disabled="!score.beatClipboard"
        @click="pasteActive"
      >
        <Icon name="paste" :size="13" />
      </button>
      <button
        class="btn-icon-sm shrink-0"
        title="regenerate this bar's notes from the active beat's settings"
        aria-label="regenerate notes"
        @click="regenerateActiveBeat"
      >
        <Icon name="rotate-cw" :size="13" />
      </button>
    </div>
    <div ref="bodyRef" class="flex-1 overflow-auto">
      <div
        class="flex"
        :style="{ minWidth: PR_KEY_W + (currentRow?.bars.length ?? 0) * barWidthPx + 'px' }"
      >
        <div
          class="sticky left-0 z-30 shrink-0 bg-[var(--color-bg-2)] border-r border-[var(--color-line)]"
          :style="{ width: PR_KEY_W + 'px' }"
        >
          <div
            v-for="p in pitches"
            :key="p"
            :data-pr-key="p"
            class="flex items-center justify-end pr-2 text-[9px] cursor-pointer select-none border-b border-[var(--color-line)]"
            :class="[
              midi.heldPitches.has(p)
                ? 'bg-[var(--color-accent)] text-[var(--color-bg-0)]'
                : isBlack(p)
                  ? 'bg-[var(--color-bg-1)] text-[var(--color-fg-1)] hover:bg-[var(--color-bg-3)]'
                  : 'bg-[var(--color-bg-2)] text-[var(--color-fg-1)] hover:bg-[var(--color-bg-3)]',
            ]"
            :style="{ height: PR_CELL_H + 'px', lineHeight: PR_CELL_H + 'px' }"
            @mousedown="(e) => onKeyMouseDown(e, p)"
            :title="`press to play ${midiToName(p)}; drag to glide`"
          >
            <span v-if="(p % 12) === 0" class="text-[var(--color-fg-1)]">{{ midiToName(p) }}</span>
            <span v-else-if="(p % 12) === 5" class="text-[var(--color-fg-3)]">{{ midiToName(p) }}</span>
          </div>
        </div>
        <div
          v-for="(bar, bi) in (currentRow?.bars ?? [])"
          :key="bar.id"
          class="relative shrink-0 border-l border-[var(--color-line-strong)]"
          :class="gridCursorClass"
          :data-pr-row="currentRowIndex"
          :data-pr-bar="bi"
          :style="{
            width: barWidthPx + 'px',
            height: totalHeight + 'px',
            backgroundColor: 'var(--color-bg-1)',
            backgroundImage:
              `repeating-linear-gradient(to right, transparent 0, transparent ${PR_CELL_W - 1}px, var(--color-bg-3) ${PR_CELL_W - 1}px, var(--color-bg-3) ${PR_CELL_W}px), ` +
              `repeating-linear-gradient(to right, transparent 0, transparent ${PR_CELL_W * beatLineEvery - 1}px, var(--color-line) ${PR_CELL_W * beatLineEvery - 1}px, var(--color-line) ${PR_CELL_W * beatLineEvery}px), ` +
              `repeating-linear-gradient(to bottom, transparent 0, transparent ${PR_CELL_H - 1}px, var(--color-bg-3) ${PR_CELL_H - 1}px, var(--color-bg-3) ${PR_CELL_H}px)`,
          }"
          @mousedown="(e) => onBarMouseDown(e, bi)"
        >
          <div
            v-for="(p, idx) in pitches"
            :key="`bg_${p}`"
            v-show="isBlack(p)"
            class="absolute left-0 right-0 pointer-events-none"
            :style="{
              top: idx * PR_CELL_H + 'px',
              height: PR_CELL_H + 'px',
              /* Darken the black-key rows (overlay bg-0 toward black) so the
                 grid matches a real piano AND the pitch column at left:
                 white = lighter, black = darker. The previous overlay
                 used bg-3 which lightened black keys — visually inverted. */
              background: 'color-mix(in oklab, var(--color-bg-0) 50%, transparent)',
            }"
          ></div>
          <div
            v-for="(p, idx) in pitches"
            :key="`held_${p}`"
            v-show="midi.heldPitches.has(p)"
            class="absolute left-0 right-0 pointer-events-none z-[5]"
            :style="{
              top: idx * PR_CELL_H + 'px',
              height: PR_CELL_H + 'px',
              background: 'color-mix(in oklab, var(--color-accent) 28%, transparent)',
              borderTop: '1px solid var(--color-accent-dim)',
              borderBottom: '1px solid var(--color-accent-dim)',
            }"
          ></div>
          <div
            v-for="(n, ni) in bar.notes"
            :key="`n_${ni}_${n.pitch}_${n.startCell}`"
            class="absolute z-10 pointer-events-none"
            :style="{
              left: n.startCell * PR_CELL_W + 'px',
              top: noteY(n.pitch) + 'px',
              width: n.duration * PR_CELL_W - 1 + 'px',
              height: PR_CELL_H - 1 + 'px',
              background: selectedNoteIds.has(noteId(currentRowIndex, bi, n.pitch, n.startCell))
                ? 'var(--color-accent)'
                : 'color-mix(in oklab, var(--color-accent) 55%, var(--color-bg-0))',
              borderLeft: '3px solid var(--color-fg-0)',
              outline: selectedNoteIds.has(noteId(currentRowIndex, bi, n.pitch, n.startCell))
                ? '1px solid var(--color-fg-0)'
                : 'none',
              outlineOffset: '0px',
            }"
            :title="`${midiToName(n.pitch)} · ${n.duration}/32`"
          ></div>
          <!-- marquee selection overlay -->
          <div
            v-if="
              drag &&
              drag.kind === 'marquee' &&
              drag.rowIndex === currentRowIndex &&
              drag.barIndex === bi &&
              drag.marqueeRect
            "
            class="absolute pointer-events-none z-20"
            :style="{
              left: Math.min(drag.marqueeRect.x0, drag.marqueeRect.x1) + 'px',
              top: Math.min(drag.marqueeRect.y0, drag.marqueeRect.y1) + 'px',
              width: Math.abs(drag.marqueeRect.x1 - drag.marqueeRect.x0) + 'px',
              height: Math.abs(drag.marqueeRect.y1 - drag.marqueeRect.y0) + 'px',
              background: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
              border: '1px solid var(--color-accent)',
            }"
          ></div>
          <div
            v-if="playheadCellInBar(bi) !== null"
            class="absolute top-0 bottom-0 pointer-events-none z-20"
            :style="{
              left: playheadCellInBar(bi)! * PR_CELL_W + 'px',
              width: '2px',
              background: 'var(--color-playhead)',
              boxShadow: '0 0 6px color-mix(in oklab, var(--color-playhead) 50%, transparent)',
            }"
          ></div>
          <div
            class="absolute top-0 right-0 flex items-center gap-1 px-1 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-fg-3)] z-30 bg-[color-mix(in_oklab,var(--color-bg-1)_92%,transparent)] border-b border-l border-[var(--color-line)]"
          >
            <span class="px-1">b{{ bi + 1 }}</span>
            <button
              class="flex items-center justify-center hover:bg-[var(--color-bg-3)] hover:text-[var(--color-fg-0)]"
              style="min-width: 24px; min-height: 22px"
              title="regenerate this bar from chords"
              @mousedown.stop
              @click.stop="regenerateBar(bi)"
            >
              <Icon name="rotate-cw" :size="13" />
            </button>
            <button
              class="flex items-center justify-center hover:bg-[var(--color-bg-3)] hover:text-[var(--color-error)]"
              style="min-width: 24px; min-height: 22px"
              title="clear all notes in this bar"
              @mousedown.stop
              @click.stop="clearBar(bi)"
            >
              <Icon name="delete" :size="13" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- collapsed stub -->
  <section
    v-else
    class="border-t border-[var(--color-line)] bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] cursor-pointer select-none"
    @click="score.setPianoRollOpen(true)"
  >
    <div
      class="flex items-center gap-2 px-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-2)]"
      style="min-height: 28px"
    >
      <Icon name="chevron-up" :size="13" />
      <span>piano roll</span>
      <span class="text-[var(--color-fg-3)] normal-case">— click to expand</span>
    </div>
  </section>
</template>
