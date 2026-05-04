<script setup lang="ts">
import { watch } from 'vue'
import RowEditor from '@/components/RowEditor.vue'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'

const score = useScoreStore()
const playback = usePlaybackStore()

function onAreaClick(e: MouseEvent) {
  // click empty space clears selection
  if (e.target === e.currentTarget) {
    score.setSelection(null, null)
  }
}

/**
 * Whenever the playhead lands on a new (row, bar), make sure that bar is in
 * view. scrollIntoView with `nearest` walks up every scroll ancestor and
 * adjusts each axis only if the element is currently outside the viewport,
 * so this handles BOTH the row's own horizontal `overflow-x-auto` AND the
 * EditorArea's vertical scroll without touching anything that's already in
 * view.
 */
watch(
  () => `${playback.playhead.rowIndex}_${playback.playhead.barIndex}`,
  (k) => {
    const el = document.querySelector(`[data-chord-bar="${k}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  },
)
</script>

<template>
  <section
    class="bg-[var(--color-bg-0)] py-3 px-3 flex flex-col gap-3"
    @mousedown="onAreaClick"
  >
    <RowEditor
      v-for="(row, idx) in score.score.rows"
      :key="row.id"
      :row="row"
      :row-index="idx"
    />
    <div class="flex justify-center pt-2">
      <button
        class="px-4 py-2 text-[var(--color-fg-1)] hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-2)] hover:border-[var(--color-line-strong)] uppercase tracking-wider text-[11px] border border-dashed border-[var(--color-line)]"
        @click="score.addRowAfter(score.score.rows.length - 1)"
        title="add a new row at the end  (shift+a anywhere)"
      >
        + new row
      </button>
    </div>
  </section>
</template>
