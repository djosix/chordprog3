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
    ],
  },
  {
    title: 'selection / clipboard',
    rows: [
      { keys: ['click', 'bar header'], desc: 'select that bar' },
      { keys: ['shift', 'click', 'bar'], desc: 'extend the selection across bars and rows (range select)' },
      { keys: ['cmd', 'c'], desc: 'copy selected bars (multi-row selections collapse to a flat list — paste lands on one row)' },
      { keys: ['cmd', 'x'], desc: 'cut selected bars' },
      { keys: ['cmd', 'v'], desc: 'paste before the selection start (insert mode)' },
      { keys: ['cmd', 'shift', 'v'], desc: 'replace the selection with the clipboard' },
      { keys: ['delete'], desc: 'delete selected bars' },
      { keys: ['esc'], desc: 'clear selection (and exit any focused input)' },
    ],
  },
  {
    title: 'rows',
    rows: [
      { keys: ['hover ↵', 'between bars'], desc: 'break the row at that bar (start a new line)' },
      { keys: ['row menu'], desc: 'duplicate, move up/down, insert, delete, join with previous, regenerate notes' },
      { keys: ['+ measure / + row'], desc: 'clones the playhead\'s current measure / row settings (style/voicing/range), with blank chord' },
      { keys: ['key picker'], desc: 'set the key for analysis (roman numerals + chord detection)' },
    ],
  },
  {
    title: 'piano roll (above bottom bar)',
    rows: [
      { keys: ['chevron'], desc: 'collapse / expand. shows the current line\'s measures, with the playhead vertical line on the active one' },
      { keys: ['drag', 'empty cell'], desc: 'create a note; drag to set its duration (1/32 grid)' },
      { keys: ['alt', 'click'], desc: 'delete a note — cursor turns into a red ⊘' },
      { keys: ['alt', 'drag'], desc: 'delete every note the cursor passes over' },
      { keys: ['cmd', 'click / drag'], desc: 'same as alt' },
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
    title: 'voicings & arpeggio styles',
    rows: [
      { keys: ['voicings'], desc: 'close · drop2 · drop3 · spread (≥5ths) · wide (≥octaves) · open (low root) · quartal (4ths) · rootless · shell (1·3·7) · octave-doubled · power (1·5)' },
      { keys: ['styles'], desc: 'block · sustain · arp ↑ / ↓ / ↑↓ · alberti · bossa · waltz · bass + chord · reggae upbeat · rest' },
      { keys: [], desc: 'each beat has its own. inherit defaults are picked from the playhead measure on insert / append.' },
    ],
  },
  {
    title: 'note-generation rules',
    rows: [
      { keys: [], desc: 'a chord on beat N sustains until the next beat with a chord (or the end of the bar)' },
      { keys: [], desc: 'block / sustain styles produce one held note across the span; arp / alberti repeat the pattern once per beat' },
      { keys: [], desc: 'changing a beat re-runs the bar-level generator. user-edited notes are not preserved across regen — use ↻ on the bar to manually refresh' },
      { keys: [], desc: '1/32 grid: cells per beat = 32 / time-sig denominator; e.g. 4/4 → 8 cells/beat, 6/8 → 4 cells/beat' },
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_oklab,black_70%,transparent)] backdrop-blur-sm pt-12"
      @mousedown.self="emit('close')"
    >
      <div
        class="border border-[var(--color-line-strong)] bg-[var(--color-bg-1)] w-[min(900px,92vw)] max-h-[80vh] flex flex-col shadow-2xl"
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
            <div class="grid grid-cols-[14rem_1fr] gap-y-1 gap-x-4">
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
