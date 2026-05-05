<script setup lang="ts">
import { computed } from 'vue'
import type { Bar } from '@/types'
import BeatEditor from '@/components/BeatEditor.vue'
import Icon from '@/components/Icon.vue'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'

const props = defineProps<{
  bar: Bar
  barIndex: number
  rowIndex: number
  rowKey: string | null
  width: number
  isLast?: boolean
}>()

const emit = defineEmits<{ (e: 'break-here'): void; (e: 'join-prev-row'): void }>()

const score = useScoreStore()
const playback = usePlaybackStore()

const selected = computed(() => score.inSelection(props.rowIndex, props.barIndex))
const isPlayhead = computed(
  () =>
    playback.playhead.rowIndex === props.rowIndex &&
    playback.playhead.barIndex === props.barIndex,
)

// `||` instead of `??` — an empty-string bar.key is user-cleared, fall back
// to row-level key rather than treating "" as a meaningful override.
const effectiveKey = computed(() => props.bar.key || props.rowKey)

function onMouseDown(e: MouseEvent) {
  if (e.shiftKey) {
    // shift-click extends from the existing anchor; if no anchor yet, treat
    // this click as the anchor so the first shift-click still selects.
    // preventDefault stops the browser's native "extend text selection"
    // behavior, which would otherwise highlight everything between the prior
    // caret and the click point. Also flush any range left over from a
    // previous text-drag.
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    const anchor = score.selection.anchor ?? { row: props.rowIndex, bar: props.barIndex }
    score.setSelection(anchor, { row: props.rowIndex, bar: props.barIndex })
  }
}

function selectThis(e?: MouseEvent) {
  if (e?.shiftKey) {
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    const anchor = score.selection.anchor ?? { row: props.rowIndex, bar: props.barIndex }
    score.setSelection(anchor, { row: props.rowIndex, bar: props.barIndex })
    return
  }
  // Toggle: if this bar is already the sole selection, clicking again clears it.
  const a = score.selection.anchor
  const h = score.selection.head
  const isOnlyMe =
    a && h &&
    a.row === props.rowIndex && a.bar === props.barIndex &&
    h.row === props.rowIndex && h.bar === props.barIndex
  if (isOnlyMe) {
    score.setSelection(null, null)
  } else {
    score.setSelection({ row: props.rowIndex, bar: props.barIndex })
  }
}

function breakHere() {
  emit('break-here')
}
function joinPrevRow() {
  emit('join-prev-row')
}
</script>

<template>
  <div
    class="flex flex-col shrink-0 border-l border-[var(--color-line)] relative"
    :class="[
      selected
        ? 'bg-[color-mix(in_oklab,var(--color-accent-dim)_22%,var(--color-bg-1))]'
        : '',
      isLast ? 'border-r border-[var(--color-line)]' : '',
    ]"
    :style="{ width: width + 'px' }"
    :data-chord-bar="`${rowIndex}_${barIndex}`"
    @mousedown="onMouseDown"
  >
    <!-- Playhead frame: absolute overlay so it sits ON TOP of the header's
         solid bg and the beat-divider horizontal borders. ring-inset on the
         bar container left the top edge hidden behind the header bg and the
         left/right edges sliced by every beat divider. -->
    <div
      v-if="isPlayhead"
      class="pointer-events-none absolute inset-0 z-20 ring-1 ring-[var(--color-playhead)] ring-inset"
    ></div>
    <div
      class="flex items-center gap-1 px-1.5 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-3)] border-b border-[var(--color-line)] bg-[var(--color-bg-1)] cursor-pointer hover:bg-[var(--color-bg-2)]"
      style="min-height: 28px"
      role="button"
      :aria-pressed="selected"
      :aria-label="`bar ${barIndex + 1}, ${selected ? 'selected' : 'not selected'} (click to select; shift-click extends)`"
      @click.stop="(e: MouseEvent) => selectThis(e)"
      title="click to select bar; shift-click extends to range"
    >
      <span
        class="w-3 h-3 border border-[var(--color-line-strong)] shrink-0"
        :class="selected ? 'bg-[var(--color-accent)]' : ''"
      ></span>
      <span class="select-none text-[var(--color-fg-2)]">b{{ barIndex + 1 }}</span>
      <span v-if="bar.key" class="text-[var(--color-key)]">{{ bar.key }}</span>
      <div class="flex-1"></div>
      <button
        v-if="barIndex === 0 && rowIndex > 0"
        class="btn-icon-sm text-[var(--color-fg-3)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-3)]"
        title="join with previous line — un-break this row"
        @click.stop="joinPrevRow"
      >
        <Icon name="corner-up-left" :size="14" />
      </button>
      <button
        v-if="barIndex > 0"
        class="btn-icon-sm text-[var(--color-fg-3)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-3)]"
        title="break row here — start a new line at this bar"
        @click.stop="breakHere"
      >
        <Icon name="corner-down-left" :size="14" />
      </button>
      <button
        class="btn-icon-sm text-[var(--color-fg-3)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-3)]"
        title="delete bar"
        @click.stop="score.deleteBar(rowIndex, barIndex)"
      >
        <Icon name="delete" :size="14" />
      </button>
    </div>
    <div class="flex flex-col">
      <BeatEditor
        v-for="(beat, bi) in bar.beats"
        :key="bi"
        :beat="beat"
        :beat-index="bi"
        :bar-index="barIndex"
        :row-index="rowIndex"
        :is-first-of-bar="bi === 0"
        :effective-key="effectiveKey"
      />
    </div>
  </div>
</template>
