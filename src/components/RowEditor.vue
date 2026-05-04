<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Row } from '@/types'
import BarEditor from '@/components/BarEditor.vue'
import KeyPicker from '@/components/KeyPicker.vue'
import Icon from '@/components/Icon.vue'
import { useScoreStore } from '@/store/score'
import { LEFT_COL_W, ADD_BAR_W, BAR_W } from '@/utils/layout'

const props = defineProps<{ row: Row; rowIndex: number }>()
const score = useScoreStore()
const showRowMenu = ref(false)
const menuWrap = ref<HTMLElement | null>(null)

const rowKey = computed(() => score.effectiveKey(props.rowIndex))
const totalContentW = computed(
  () => LEFT_COL_W + props.row.bars.length * BAR_W + ADD_BAR_W,
)

function onRowKeyChange(v: string | null) {
  score.setRowKey(props.rowIndex, v)
}

function runMenu(fn: () => void) {
  fn()
  showRowMenu.value = false
}

function regenerateRowNotes() {
  score.regenerateRow(props.rowIndex)
}

function onDocPointerDown(e: PointerEvent) {
  if (!showRowMenu.value) return
  const t = e.target as Node | null
  if (t && menuWrap.value && menuWrap.value.contains(t)) return
  showRowMenu.value = false
}
function onDocKey(e: KeyboardEvent) {
  if (!showRowMenu.value) return
  if (e.code === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    showRowMenu.value = false
  }
}
watch(showRowMenu, (v) => {
  if (v) {
    window.addEventListener('pointerdown', onDocPointerDown, true)
    window.addEventListener('keydown', onDocKey, true)
  } else {
    window.removeEventListener('pointerdown', onDocPointerDown, true)
    window.removeEventListener('keydown', onDocKey, true)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('keydown', onDocKey, true)
})
</script>

<template>
  <article
    class="border border-[var(--color-line)] bg-[var(--color-bg-1)] flex flex-col"
  >
    <header
      class="flex items-center gap-2 px-2 py-1 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] text-[10px] uppercase tracking-wider text-[var(--color-fg-2)]"
    >
      <span class="text-[var(--color-fg-3)]">row {{ rowIndex + 1 }}</span>
      <input
        :value="row.marker"
        @input="(e) => score.setRowMarker(rowIndex, (e.target as HTMLInputElement).value)"
        placeholder="optional marker (e.g. I  vi  IV  V)"
        class="flex-1 px-2 py-0.5 normal-case text-[var(--color-fg-1)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)]"
      />
      <KeyPicker
        :value="row.key"
        :inherited="row.key === null ? rowKey : null"
        @change="onRowKeyChange"
      />
      <div class="relative" ref="menuWrap">
        <button
          class="btn-icon hover:bg-[var(--color-bg-3)] text-[var(--color-fg-2)] hover:text-[var(--color-fg-0)]"
          @click="showRowMenu = !showRowMenu"
          title="row actions"
        >
          <Icon name="menu" :size="16" />
        </button>
        <div
          v-if="showRowMenu"
          class="absolute right-0 top-full mt-1 z-40 border border-[var(--color-line-strong)] bg-[var(--color-bg-2)] min-w-[12rem] py-1 normal-case shadow-lg"
        >
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(() => score.duplicateRow(rowIndex))">duplicate row</button>
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(() => score.moveRow(rowIndex, -1))">move up</button>
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(() => score.moveRow(rowIndex, 1))">move down</button>
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(() => score.addRowAfter(rowIndex))">insert row below</button>
          <div class="border-t border-[var(--color-line)] my-1"></div>
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-error)]" @click="runMenu(() => score.deleteRow(rowIndex))">delete row</button>
          <button v-if="rowIndex > 0" class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(() => score.joinPrevRow(rowIndex))">join with previous row</button>
          <div class="border-t border-[var(--color-line)] my-1"></div>
          <button class="block w-full text-left px-3 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-1)]" @click="runMenu(regenerateRowNotes)">regenerate all notes from chords</button>
        </div>
      </div>
    </header>
    <div class="overflow-x-auto">
      <div class="flex" :style="{ minWidth: totalContentW + 'px' }">
        <div
          class="sticky left-0 z-30 shrink-0 px-2 py-2 border-r border-[var(--color-line)] bg-[var(--color-bg-2)] flex flex-col gap-1"
          :style="{ width: LEFT_COL_W + 'px' }"
        >
          <input
            :value="row.title"
            @input="(e) => score.setRowTitle(rowIndex, (e.target as HTMLInputElement).value)"
            placeholder="title"
            class="px-1 py-0.5 text-[12px] uppercase tracking-wider text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)]"
          />
          <textarea
            :value="row.description"
            @input="(e) => score.setRowDescription(rowIndex, (e.target as HTMLTextAreaElement).value)"
            placeholder="description"
            rows="3"
            class="px-1 py-0.5 text-[10px] text-[var(--color-fg-2)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)] resize-none"
          />
          <div class="text-[9px] text-[var(--color-fg-3)] uppercase tracking-wider mt-auto">
            {{ row.bars.length }} bars
          </div>
        </div>
        <BarEditor
          v-for="(bar, bi) in row.bars"
          :key="bar.id"
          :bar="bar"
          :bar-index="bi"
          :row-index="rowIndex"
          :row-key="rowKey"
          :width="BAR_W"
          :is-last="bi === row.bars.length - 1"
          @break-here="score.breakRowAt(rowIndex, bi)"
        />
        <button
          class="shrink-0 self-stretch text-[var(--color-fg-3)] hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] hover:border-[var(--color-line-strong)] flex items-center justify-center border border-dashed border-[var(--color-line)] mx-2 my-2"
          :style="{ width: ADD_BAR_W + 'px' }"
          @click="score.addBarAfter(rowIndex, row.bars.length - 1)"
          title="add bar  (m)"
        >
          <Icon name="plus" :size="16" />
        </button>
      </div>
    </div>
  </article>
</template>
