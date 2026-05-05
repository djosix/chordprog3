<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Beat } from '@/types'
import { parseChord, romanInKey } from '@/utils/music'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'
import { useMidiStore } from '@/store/midi'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  beat: Beat
  beatIndex: number
  barIndex: number
  rowIndex: number
  isFirstOfBar: boolean
  effectiveKey: string | null
}>()

const score = useScoreStore()
const playback = usePlaybackStore()
const midi = useMidiStore()

const localChord = ref(props.beat.chord)
const focused = ref(false)

watch(
  () => props.beat.chord,
  (v) => {
    if (v !== localChord.value) localChord.value = v
  },
)

const parsed = computed(() => parseChord(localChord.value))
const isInvalid = computed(() => !parsed.value.ok && localChord.value.trim().length > 0)
const roman = computed(() =>
  parsed.value.ok ? romanInKey(parsed.value.name, props.effectiveKey) : null,
)

const isPlayhead = computed(
  () =>
    playback.playhead.rowIndex === props.rowIndex &&
    playback.playhead.barIndex === props.barIndex &&
    playback.playhead.beatIndex === props.beatIndex,
)

function commitChord() {
  // First normalize the typed text: capitalize the leading note letter so
  // `cmaj7` parses, normalize unicode accidentals (♭→b, ♯→#) so chord
  // names pasted from notation tools survive, then run through tonal.
  let raw = localChord.value.trim()
  raw = raw.replace(/♭/g, 'b').replace(/♯/g, '#')
  let attempt = raw
  if (raw.length) {
    attempt = raw[0].toUpperCase() + raw.slice(1)
    // also handle slash-chord bass: "cmaj7/b" → "Cmaj7/B"
    attempt = attempt.replace(/\/([a-g])/g, (_, c) => '/' + c.toUpperCase())
  }
  const c = parseChord(attempt)
  const canon = c.ok ? c.name : attempt
  // Skip the store update if nothing actually changed — Enter does
  // `commitChord(); blur()`, blur fires `commitChord()` again. With this
  // guard the second call is a no-op instead of a redundant
  // setBeatChord (which would push a duplicate undo snapshot).
  if (canon === props.beat.chord && canon === localChord.value) return
  localChord.value = canon
  score.setBeatChord(props.rowIndex, props.barIndex, props.beatIndex, canon)
}

function fillFromMidi() {
  if (!midi.detected.length) return
  localChord.value = midi.detected[0]
  commitChord()
}

function onChordKeydown(e: KeyboardEvent) {
  if (e.code === 'Enter') {
    e.preventDefault()
    if (e.shiftKey && midi.enabled && midi.detected.length) {
      fillFromMidi()
    } else {
      commitChord()
    }
    ;(e.target as HTMLInputElement).blur()
  }
}

function onFocus() {
  focused.value = true
  // focusing a chord input also moves the playhead onto this beat — the
  // piano-roll settings strip then tracks whichever beat you're editing.
  playback.setPlayhead(props.rowIndex, props.barIndex, props.beatIndex)
}
function onBlur() {
  setTimeout(() => {
    focused.value = false
  }, 150)
  commitChord()
}

/** Click anywhere on the beat block (other than the input / buttons) → move
 *  the playhead to this beat. The input is narrower than the block on
 *  purpose so the user has empty space to click. */
function onBlockClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return
  if (t.tagName === 'INPUT' || t.closest('button')) return
  playback.setPlayhead(props.rowIndex, props.barIndex, props.beatIndex)
}
</script>

<template>
  <div
    class="border-t border-[var(--color-line)] first:border-t-0 px-1.5 py-1 flex items-center gap-1.5 relative min-h-[28px] cursor-pointer"
    :class="[
      isPlayhead ? 'bg-[color-mix(in_oklab,var(--color-playhead)_18%,transparent)]' : '',
      isFirstOfBar ? '' : 'bg-[color-mix(in_oklab,var(--color-bg-2)_30%,transparent)]',
    ]"
    @click="onBlockClick"
    title="click to move the playhead here"
  >
    <span class="text-[10px] text-[var(--color-fg-3)] w-4 select-none">{{ beatIndex + 1 }}</span>
    <input
      :data-chord-input="`${rowIndex}_${barIndex}_${beatIndex}`"
      v-model="localChord"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onChordKeydown"
      placeholder="—"
      aria-label="chord symbol"
      class="w-28 shrink-0 px-1 py-0.5 min-w-0 text-[13px] tracking-tight cursor-text"
      :class="
        isInvalid
          ? 'text-[var(--color-error)] bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]'
          : parsed.ok
            ? 'text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)]'
            : 'text-[var(--color-fg-3)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)]'
      "
    />
    <div class="flex-1"></div>
    <button
      v-if="focused && midi.enabled && midi.detected.length"
      class="px-1 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-bg-3)] flex items-center gap-1 text-[11px] tracking-tight border border-[var(--color-accent-dim)]"
      @mousedown.prevent="fillFromMidi"
      :title="`fill chord from midi: ${midi.detected.join(' / ')}  (shift-enter)`"
    >
      <Icon name="midi" :size="11" />
      <span>{{ midi.detected[0] }}</span>
    </button>
    <!-- always render the roman slot so layout doesn't jitter when a chord
         transitions from parseable ↔ unparseable. Visibility-hidden keeps
         the width reserved without showing stale text. -->
    <span
      class="text-[10px] uppercase tracking-wider text-[var(--color-key)] px-1 inline-block min-w-[2rem] text-right"
      :class="roman ? '' : 'invisible'"
      :title="roman ? `scale degree in ${effectiveKey}` : ''"
    >{{ roman || '—' }}</span>
  </div>
</template>
