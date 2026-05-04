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

const emit = defineEmits<{ (e: 'break-here'): void }>()

const score = useScoreStore()
const playback = usePlaybackStore()

const selected = computed(() => score.inSelection(props.rowIndex, props.barIndex))
const isPlayhead = computed(
  () =>
    playback.playhead.rowIndex === props.rowIndex &&
    playback.playhead.barIndex === props.barIndex,
)

const effectiveKey = computed(() => props.bar.key ?? props.rowKey)

function onMouseDown(e: MouseEvent) {
  if (e.shiftKey) {
    // shift-click extends from the existing anchor; if no anchor yet, treat
    // this click as the anchor so the first shift-click still selects.
    const anchor = score.selection.anchor ?? { row: props.rowIndex, bar: props.barIndex }
    score.setSelection(anchor, { row: props.rowIndex, bar: props.barIndex })
  }
}

function selectThis(e?: MouseEvent) {
  if (e?.shiftKey) {
    const anchor = score.selection.anchor ?? { row: props.rowIndex, bar: props.barIndex }
    score.setSelection(anchor, { row: props.rowIndex, bar: props.barIndex })
    return
  }
  score.setSelection({ row: props.rowIndex, bar: props.barIndex })
}

function jumpHere() {
  playback.setPlayhead(props.rowIndex, props.barIndex, 0)
}
</script>

<template>
  <div
    class="flex flex-col shrink-0 border-l border-[var(--color-line)] relative"
    :class="[
      selected
        ? 'bg-[color-mix(in_oklab,var(--color-accent-dim)_22%,var(--color-bg-1))]'
        : '',
      isPlayhead ? 'ring-1 ring-[var(--color-playhead)] ring-inset' : '',
      isLast ? 'border-r border-[var(--color-line)]' : '',
    ]"
    :style="{ width: width + 'px' }"
    :data-chord-bar="`${rowIndex}_${barIndex}`"
    @mousedown="onMouseDown"
  >
    <button
      v-if="barIndex > 0"
      class="absolute left-0 top-0 z-20 w-4 h-3 opacity-0 hover:opacity-100 hover:bg-[var(--color-line)] hover:text-[var(--color-accent)] text-[var(--color-fg-3)] flex items-center justify-center"
      @click.stop="emit('break-here')"
      title="break row here  ↵"
    >
      <Icon name="corner-down-left" :size="11" />
    </button>
    <div
      class="flex items-center gap-1 px-1.5 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-3)] border-b border-[var(--color-line)] bg-[var(--color-bg-1)] cursor-pointer hover:bg-[var(--color-bg-2)]"
      style="min-height: 28px"
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
        class="btn-icon-sm text-[var(--color-fg-3)] hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)]"
        title="jump playhead here"
        @click.stop="jumpHere"
      >
        <Icon name="crosshair" :size="14" />
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
