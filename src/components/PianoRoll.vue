<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'
import { useMidiStore } from '@/store/midi'
import { cellsPerBar, cellsPerBeat, noteAtCell } from '@/utils/cells'
import { midiToName, parseChord } from '@/utils/music'
import { beatVoicing } from '@/utils/voicing'
import type { AccompanimentStyle, VoicingMode } from '@/types'
import { PR_CELL_H, PR_CELL_W, PR_KEY_W } from '@/utils/layout'
import { useModifierKeys } from '@/composables/useModifierKeys'
import Icon from '@/components/Icon.vue'

const score = useScoreStore()
const playback = usePlaybackStore()
const midi = useMidiStore()
const { altOrMeta } = useModifierKeys()

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

const styleOptions: { v: AccompanimentStyle; label: string }[] = [
  { v: 'block', label: 'block' },
  { v: 'sustain', label: 'sustain' },
  { v: 'arp-up', label: 'arp ↑' },
  { v: 'arp-down', label: 'arp ↓' },
  { v: 'arp-up-down', label: 'arp ↑↓' },
  { v: 'alberti', label: 'alberti' },
  { v: 'bossa', label: 'bossa (root + chord stab)' },
  { v: 'waltz', label: 'waltz (1 + chord-chord)' },
  { v: 'bass-chord', label: 'bass + chord' },
  { v: 'reggae', label: 'reggae upbeat' },
  { v: 'rest', label: 'rest' },
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

function patchActive(patch: Partial<{ style: AccompanimentStyle; voicing: VoicingMode; rangeCenter: number; rangeSpread: number }>) {
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

interface Drag {
  rowIndex: number
  barIndex: number
  pitch: number
  startCell: number
  currentCell: number
  resizeNoteIndex: number
}
const drag = ref<Drag | null>(null)

type DragMode = 'create' | 'delete'
const dragMode = ref<DragMode | null>(null)

function pitchAtY(localY: number): number {
  const idx = Math.floor(localY / PR_CELL_H)
  return pitches.value[Math.max(0, Math.min(pitches.value.length - 1, idx))]
}
function cellAtX(localX: number): number {
  return Math.max(0, Math.min(cpBar.value - 1, Math.floor(localX / PR_CELL_W)))
}

function onBarMouseDown(e: MouseEvent, barIndex: number) {
  if (e.button !== 0) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const pitch = pitchAtY(y)
  const cell = cellAtX(x)

  const ri = currentRowIndex.value
  const bar = score.score.rows[ri]?.bars[barIndex]
  if (!bar) return

  if (e.altKey || e.metaKey) {
    dragMode.value = 'delete'
    deleteAt(ri, barIndex, pitch, cell)
    window.addEventListener('mousemove', onDeleteMove)
    window.addEventListener('mouseup', onWinMouseUp)
    e.preventDefault()
    return
  }

  // shift-click on an existing note → grab to resize that note from its right edge
  const existingIdx = noteAtCell(bar.notes, pitch, cell)
  if (existingIdx >= 0) {
    if (e.shiftKey) {
      const note = bar.notes[existingIdx]
      drag.value = {
        rowIndex: ri,
        barIndex,
        pitch: note.pitch,
        startCell: note.startCell,
        currentCell: cell,
        resizeNoteIndex: existingIdx,
      }
      dragMode.value = 'create'
      window.addEventListener('mousemove', onWinMouseMove)
      window.addEventListener('mouseup', onWinMouseUp)
    }
    e.preventDefault()
    return
  }

  score.addNote(ri, barIndex, { pitch, startCell: cell, duration: 1 })
  const refreshed = score.score.rows[ri]?.bars[barIndex]
  if (!refreshed) return
  const idx = noteAtCell(refreshed.notes, pitch, cell)
  if (idx < 0) return
  drag.value = {
    rowIndex: ri,
    barIndex,
    pitch,
    startCell: cell,
    currentCell: cell,
    resizeNoteIndex: idx,
  }
  dragMode.value = 'create'
  playback.previewNotes([pitch], 0.25)
  window.addEventListener('mousemove', onWinMouseMove)
  window.addEventListener('mouseup', onWinMouseUp)
  e.preventDefault()
}

function onWinMouseMove(e: MouseEvent) {
  const d = drag.value
  if (!d) return
  // Allow drag to extend across bars in the SAME row.
  // We pin to the row indicated by `data-pr-row` and walk bar elements to find
  // the one currently under the cursor; the new duration extends from the
  // start cell of the original bar through the current bar.
  const overEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
    '[data-pr-row][data-pr-bar]',
  ) as HTMLElement | null
  let targetBar = d.barIndex
  let cellInTarget = 0
  if (overEl) {
    const ri = parseInt(overEl.dataset.prRow ?? '-1', 10)
    if (ri === d.rowIndex) {
      const bi = parseInt(overEl.dataset.prBar ?? '-1', 10)
      if (bi >= 0) {
        const rect = overEl.getBoundingClientRect()
        cellInTarget = cellAtX(e.clientX - rect.left)
        targetBar = bi
      }
    }
  } else {
    // Fallback: clamp inside original bar
    const origEl = document.querySelector(
      `[data-pr-row="${d.rowIndex}"][data-pr-bar="${d.barIndex}"]`,
    ) as HTMLElement | null
    if (!origEl) return
    const rect = origEl.getBoundingClientRect()
    cellInTarget = cellAtX(e.clientX - rect.left)
  }
  if (targetBar < d.barIndex) targetBar = d.barIndex
  // Clamp the note to remain in its original bar — we don't span notes across
  // bar boundaries (the cells/note model is per-bar). Just extend to the end
  // of the original bar when the cursor is past it.
  let endCell: number
  if (targetBar > d.barIndex) {
    endCell = cpBar.value - 1
  } else {
    endCell = Math.max(d.startCell, cellInTarget)
  }
  d.currentCell = endCell
  const newDur = Math.max(1, endCell - d.startCell + 1)
  score.resizeNote(d.rowIndex, d.barIndex, d.resizeNoteIndex, newDur)
}

function onDeleteMove(e: MouseEvent) {
  // If the user releases alt/cmd mid-drag, the cursor flips back to crosshair
  // (via altOrMeta) but onDeleteMove kept eating notes. End the drag instead.
  if (!e.altKey && !e.metaKey) {
    onWinMouseUp()
    return
  }
  const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
    '[data-pr-row][data-pr-bar]',
  ) as HTMLElement | null
  if (!el) return
  const ri = parseInt(el.dataset.prRow ?? '-1', 10)
  const bi = parseInt(el.dataset.prBar ?? '-1', 10)
  if (ri !== currentRowIndex.value) return
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return
  const pitch = pitchAtY(y)
  const cell = cellAtX(x)
  deleteAt(ri, bi, pitch, cell)
}

function deleteAt(rowIndex: number, barIndex: number, pitch: number, cell: number) {
  const bar = score.score.rows[rowIndex]?.bars[barIndex]
  if (!bar) return
  const idx = noteAtCell(bar.notes, pitch, cell)
  if (idx >= 0) score.removeNote(rowIndex, barIndex, idx)
}

function onWinMouseUp() {
  drag.value = null
  dragMode.value = null
  window.removeEventListener('mousemove', onWinMouseMove)
  window.removeEventListener('mousemove', onDeleteMove)
  window.removeEventListener('mouseup', onWinMouseUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWinMouseMove)
  window.removeEventListener('mousemove', onDeleteMove)
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
      <span
        class="ml-2 normal-case lowercase"
        :class="altOrMeta ? 'text-[var(--color-error)]' : 'text-[var(--color-fg-3)]'"
      >
        <span v-if="altOrMeta">delete mode — click or drag through notes to remove</span>
        <span v-else>drag empty cell to create · alt/cmd to delete · scroll to navigate · 1/32 grid</span>
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
        <span>style</span>
        <select
          :value="activeBeat.style"
          @change="(e) => patchActive({ style: (e.target as HTMLSelectElement).value as AccompanimentStyle })"
          class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-1 py-0.5 text-[var(--color-fg-0)] cursor-pointer text-right normal-case"
        >
          <option v-for="o in styleOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
        </select>
      </label>
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
        <span>center</span>
        <input
          type="range"
          min="24"
          max="96"
          :value="activeBeat.rangeCenter"
          @input="(e) => patchActive({ rangeCenter: parseInt((e.target as HTMLInputElement).value, 10) })"
          class="w-24 accent-[var(--color-accent)]"
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
          class="w-24 accent-[var(--color-accent)]"
        />
        <span class="text-[var(--color-fg-1)] normal-case w-8">±{{ activeBeat.rangeSpread }}st</span>
      </label>
      <span class="text-[var(--color-fg-3)] shrink-0">notes</span>
      <span class="text-[var(--color-fg-1)] normal-case tracking-tight min-w-0 truncate flex-1">
        {{ activeBeatNotes.length ? activeBeatNotes.map(midiToName).join(' ') : '—' }}
      </span>
      <button
        class="btn-icon-sm gap-1 px-2 shrink-0"
        title="yank these settings (style/voicing/range)  (y)"
        @click="yankActive"
      >
        <Icon name="copy" :size="12" />
        <span>yank</span>
      </button>
      <button
        class="btn-icon-sm gap-1 px-2 shrink-0 disabled:opacity-30"
        title="paste yanked settings here  (p)"
        :disabled="!score.beatClipboard"
        @click="pasteActive"
      >
        <Icon name="paste" :size="12" />
        <span>paste</span>
      </button>
      <button
        class="btn-icon-sm gap-1 px-2 shrink-0"
        title="regenerate this beat's notes from chord/style/voicing/range"
        @click="regenerateActiveBeat"
      >
        <Icon name="rotate-cw" :size="12" />
        <span>regen</span>
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
          :class="altOrMeta ? 'cursor-delete' : 'cursor-crosshair'"
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
              background: 'color-mix(in oklab, var(--color-bg-3) 35%, transparent)',
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
              background: 'var(--color-accent)',
              borderLeft: '2px solid var(--color-accent-dim)',
            }"
            :title="`${midiToName(n.pitch)} · ${n.duration}/32`"
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
