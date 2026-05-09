<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.code === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  // capture phase so we beat the global app shortcut handler
  window.addEventListener('keydown', onKey, { capture: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, { capture: true } as any)
})

watch(
  () => props.open,
  (v) => {
    if (v) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
  },
)

interface Section {
  title: string
  rows: { keys: string[]; desc: string }[]
}

const sections: Section[] = [
  {
    title: 'transport',
    rows: [
      { keys: ['space'], desc: 'play / pause' },
      { keys: ['0'], desc: 'stop and rewind to start (Digit0 or Numpad0)' },
      { keys: ['l'], desc: 'listen — preview the chord at the playhead as a block voicing near middle C (ignores the beat\'s own style/voicing; scans a capped window for the next chord boundary)' },
      { keys: ['o'], desc: 'toggle loop. a bar selection always defines the play range (looped when on, one-shot when off) — see the bottom-bar label (play / loop, with range)' },
    ],
  },
  {
    title: 'editing shortcuts',
    rows: [
      { keys: ['enter'], desc: 'focus the chord input at the current playhead beat — start typing to edit' },
      { keys: ['enter (in input)'], desc: 'commit the chord and unfocus; symbol is reformatted (cmaj7 → Cmaj7); unparseable inputs stay red' },
      { keys: ['shift', 'enter (in input)'], desc: 'fill chord from MIDI input (when detected) instead of using typed text' },
      { keys: ['i'], desc: 'insert a measure AT the playhead (pushing the current one down); clones its style/voicing/range, blank chord' },
      { keys: ['a'], desc: 'append a measure AFTER the playhead; clones the playhead measure' },
      { keys: ['shift', 'i'], desc: 'insert a row AT the playhead row (pushing the current row down)' },
      { keys: ['shift', 'a'], desc: 'append a row AFTER the playhead row' },
      { keys: ['y'], desc: 'yank the playhead beat\'s style/voicing/range into the beat clipboard' },
      { keys: ['p'], desc: 'paste the yanked beat settings onto the playhead beat' },
    ],
  },
  {
    title: 'playhead navigation',
    rows: [
      { keys: ['←'], desc: 'previous beat (wraps across bars / lines)' },
      { keys: ['→'], desc: 'next beat (wraps across bars / lines)' },
      { keys: ['↑'], desc: 'beat above in same bar; at the top, jumps to the previous line\'s same-bar-index, last beat' },
      { keys: ['↓'], desc: 'beat below in same bar; at the bottom, jumps to the next line\'s same-bar-index, first beat' },
      { keys: ['shift', '←'], desc: 'previous bar, same beat-y (wraps to previous line\'s last bar)' },
      { keys: ['shift', '→'], desc: 'next bar, same beat-y (wraps to next line\'s first bar)' },
      { keys: ['shift', '↑'], desc: 'previous line, same bar + beat (clamped)' },
      { keys: ['shift', '↓'], desc: 'next line, same bar + beat (clamped)' },
      { keys: ['alt', '←'], desc: 'jump to the very first beat of the current line' },
      { keys: ['alt', '→'], desc: 'jump to the very last beat of the current line' },
      { keys: ['alt', '↑'], desc: 'jump to the first line, same bar + beat (clamped)' },
      { keys: ['alt', '↓'], desc: 'jump to the last line, same bar + beat (clamped)' },
      { keys: ['click', 'beat'], desc: 'click anywhere in a beat block (outside the chord input) to move the playhead there' },
    ],
  },
  {
    title: 'selection / clipboard',
    rows: [
      { keys: ['click', 'bar header'], desc: 'select that bar' },
      { keys: ['shift', 'click', 'bar'], desc: 'extend the selection across bars and rows (range select)' },
      { keys: ['cmd', 'z'], desc: 'undo the last edit. inside an input, browser native text-undo runs instead — the app-level history captures committed score mutations only.' },
      { keys: ['cmd', 'shift', 'z'], desc: 'redo (also cmd+y).' },
      { keys: ['cmd', 'c'], desc: 'copy selected bars (multi-row selections collapse to a flat list — paste lands on one row)' },
      { keys: ['cmd', 'x'], desc: 'cut selected bars' },
      { keys: ['cmd', 'v'], desc: 'paste — with a selection: insert before the selection start; without one: insert AFTER the playhead bar (park the playhead on the last bar to paste at end-of-row)' },
      { keys: ['cmd', 'shift', 'v'], desc: 'replace the selection with the clipboard (no selection ⇒ same as cmd-v)' },
      { keys: ['delete'], desc: 'delete selected bars' },
      { keys: ['esc'], desc: 'clear selection, blur any focused input, AND jump the playhead back to the first beat of the first line' },
    ],
  },
  {
    title: 'rows',
    rows: [
      { keys: ['↵', 'in bar header'], desc: 'break the row at that bar (start a new line). the corner-down-left button in each bar\'s header (visible from bar 2 onward).' },
      { keys: ['↰', 'in bar 1 header'], desc: 'join with previous line — the corner-up-left button on each line\'s first bar (from line 2 onward) merges this line back into the previous one.' },
      { keys: ['row menu'], desc: 'duplicate, move up/down, insert, delete, join with previous, regenerate notes' },
      { keys: ['+ measure / + row'], desc: 'clones the playhead\'s current measure / row settings (style/voicing/range), with blank chord' },
      { keys: ['key picker'], desc: 'set the key for analysis (roman numerals + chord detection)' },
    ],
  },
  {
    title: 'piano roll — three modes',
    rows: [
      { keys: ['select', '(default)'], desc: 'cursor = default. click a note to select it (shift-click to add/remove from selection). drag a selected note to MOVE it. drag the LEFT or RIGHT edge of a note to RESIZE. drag empty area to MARQUEE-SELECT. backspace / delete removes every selected note.' },
      { keys: ['draw', 'alt / cmd'], desc: 'cursor = pencil. click+drag empty cells to create a note (drag controls duration; you can extend across bars in the same row).' },
      { keys: ['delete', 'd held'], desc: 'cursor = X. click or drag through notes to remove them.' },
      { keys: ['↻'], desc: 'regenerate this measure from its chords' },
      { keys: ['×'], desc: 'clear all notes in this measure' },
      { keys: ['key column'], desc: 'press a pitch to preview it (note-on); release to stop (note-off). drag to glide between pitches' },
      { keys: ['drag top edge'], desc: 'resize the piano-roll panel height; persisted' },
      { keys: ['c4 button'], desc: 'snap vertical scroll back to middle C' },
    ],
  },
  {
    title: 'beat settings (in piano roll header)',
    rows: [
      { keys: [], desc: 'the strip above the piano-roll grid edits the beat where the playhead is. focusing a chord input also moves the playhead onto that beat, so the strip always tracks what you\'re editing.' },
      { keys: [], desc: 'style / voicing / center pitch / spread (semitones each side of center) / derived notes preview / regen this beat. changes apply to the bar\'s notes immediately.' },
      { keys: ['yank / paste'], desc: 'buttons mirror the y / p shortcuts above.' },
    ],
  },
  {
    title: 'output',
    rows: [
      { keys: ['sample piano'], desc: 'plays via the bundled Salamander grand sampler' },
      { keys: ['midi out'], desc: 'sends note-on/off to the selected MIDI device (e.g. macOS IAC). falls back to sample piano if no devices are present' },
      { keys: ['midi in'], desc: 'enable to capture MIDI keyboard input — held notes light up the piano roll, detected chord shows in the bottom bar and as a fill button on focused chord inputs' },
      { keys: ['loop button'], desc: 'in the bottom bar — fills with the accent color when on. a bar selection always restricts the play range (label shows "play r.b → r.b" off, "loop r.b → r.b" on); no selection plays the whole score' },
    ],
  },
  {
    title: 'voicings',
    rows: [
      { keys: [], desc: 'close · drop2 · drop3 · spread (≥5ths) · wide (≥octaves) · open (low root) · quartal (4ths) · rootless · shell (1·3·7) · octave-doubled · power (1·5)' },
    ],
  },
  {
    title: 'rhythm shapes (replaces the old "style" enum)',
    rows: [
      { keys: ['sustain'], desc: 'one held event over the whole span — block / pad' },
      { keys: ['pulse'], desc: 'even 8th-note pulse, downbeats stronger' },
      { keys: ['bass+chord'], desc: 'stride: bass on 1+3, chord on 2+4, optional offbeat fills' },
      { keys: ['arp ↑ / ↓ / ↑↓'], desc: 'broken-chord lines at 8th-note rate' },
      { keys: ['alberti'], desc: 'classical low-high-mid-high cycle' },
      { keys: ['charleston'], desc: 'the universal pop/jazz cell: 1, &-of-2, 4' },
      { keys: ['syncopated'], desc: 'dotted-quarter pulse: 1, &-2, 4 with elongated stabs' },
      { keys: ['clave'], desc: '3-2 son clave (latin / bossa-feel)' },
    ],
  },
  {
    title: 'rhythm knobs',
    rows: [
      { keys: ['density'], desc: 'how many of the shape\'s canonical hits actually fire — top-priority kept, weak hits dropped first. density 0 keeps just the most important hit; density 1 fires the full pattern.' },
      { keys: ['syncopation'], desc: 'probability of pushing a strong-beat hit forward onto the &-of-the-beat. 0 = grid-locked; 1 = every strong hit displaced.' },
      { keys: ['voices'], desc: 'how many of the voicing\'s notes fire on each chord stab. Ranked top voice → 3rd/7th (guide tones) → 9/11/13 → 5 → root. So a 7-note C13 at voices=0.4 fires 3 notes (top + 3rd + 7th), exactly what a pro plays.' },
      { keys: ['rangeCenter / spread'], desc: 'where the voicing sits on the keyboard, in MIDI semitones around a center. The voicing engine moves notes by octaves to fit.' },
    ],
  },
  {
    title: 'note-generation rules',
    rows: [
      { keys: [], desc: 'a chord on beat N sustains until the next beat with a chord (or the end of the bar)' },
      { keys: [], desc: 'pipeline: voicing → bass-pitch → canonical hits → density (top-K) → syncopation (push to &) → pick voicing-subset per event' },
      { keys: [], desc: 'bass role uses the chord\'s actual root in a low register, independent of voicing — so rootless voicings still get a real root in the bass when the shape calls for one' },
      { keys: [], desc: 'changing any beat setting regenerates the whole bar. user-edited notes are not preserved — use ↻ on the bar to manually refresh' },
      { keys: [], desc: '1/32 grid: cells per beat = 32 / time-sig denominator; e.g. 4/4 → 8 cells/beat, 6/8 → 4 cells/beat' },
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <div
      v-show="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_oklab,black_70%,transparent)] backdrop-blur-sm pt-12"
      @mousedown.self="emit('close')"
    >
      <div
        class="border border-[var(--color-line-strong)] bg-[var(--color-bg-1)] w-[min(900px,92vw)] max-h-[80vh] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="manual / shortcuts"
        @mousedown.stop
      >
        <header
          class="flex items-center gap-2 px-3 h-9 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] text-[11px] uppercase tracking-wider"
        >
          <span class="text-[var(--color-fg-0)] font-bold">manual</span>
          <span class="text-[var(--color-fg-3)] normal-case">— chordprog3 keymap & interactions</span>
          <div class="flex-1"></div>
          <button
            class="btn-icon hover:bg-[var(--color-bg-3)] text-[var(--color-fg-2)] hover:text-[var(--color-fg-0)] gap-1.5"
            style="min-width: 70px"
            @click="emit('close')"
            title="close (esc)"
          >
            <Icon name="delete" :size="14" />
            <span>close</span>
          </button>
        </header>
        <div class="overflow-auto p-4 flex flex-col gap-5">
          <section v-for="s in sections" :key="s.title" class="flex flex-col gap-1.5">
            <h3 class="text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] border-b border-[var(--color-line)] pb-1">
              {{ s.title }}
            </h3>
            <div class="grid grid-cols-[14rem_1fr] gap-y-2 gap-x-4">
              <template v-for="(r, i) in s.rows" :key="i">
                <div class="flex items-center gap-1 flex-wrap">
                  <kbd
                    v-for="(k, ki) in r.keys"
                    :key="ki"
                    class="px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-[var(--color-bg-2)] text-[var(--color-fg-1)] border border-[var(--color-line)]"
                  >{{ k }}</kbd>
                </div>
                <div class="text-[12px] text-[var(--color-fg-1)] normal-case">{{ r.desc }}</div>
              </template>
            </div>
          </section>
          <footer class="text-[10px] uppercase tracking-wider text-[var(--color-fg-3)] normal-case lowercase pt-2 border-t border-[var(--color-line)]">
            press
            <kbd class="px-1 py-0.5 bg-[var(--color-bg-2)] border border-[var(--color-line)] text-[var(--color-fg-1)]">esc</kbd>
            or click outside to close.
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>
