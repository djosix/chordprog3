<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScoreStore } from '@/store/score'
import Manual from '@/components/Manual.vue'
import Icon from '@/components/Icon.vue'

const score = useScoreStore()
const manualOpen = ref(false)

const ts = computed({
  get: () => `${score.score.timeSignature.numerator}/${score.score.timeSignature.denominator}`,
  set: (v: string) => {
    const [n, d] = v.split('/').map((x) => parseInt(x, 10))
    if (!isFinite(n) || !isFinite(d)) return
    score.setTimeSignature(n, d)
  },
})

const tsOptions = ['2/4', '3/4', '4/4', '5/4', '6/4', '6/8', '7/8', '12/8']
</script>

<template>
  <header
    class="sticky top-0 z-30 flex items-center gap-3 px-3 h-11 border-b border-[var(--color-line)] bg-[var(--color-bg-1)] text-[11px] uppercase tracking-wider"
  >
    <div class="text-[var(--color-fg-0)] font-bold">chordprog3</div>
    <div class="w-px h-5 bg-[var(--color-line)]"></div>
    <input
      class="bg-transparent text-[var(--color-fg-1)] hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)] px-2 py-1 min-w-[8rem] normal-case lowercase"
      :value="score.score.title"
      @change="(e) => score.setTitle((e.target as HTMLInputElement).value)"
      placeholder="untitled"
    />
    <div class="flex-1"></div>
    <label class="flex items-center gap-1 text-[var(--color-fg-2)]">
      <span>ts</span>
      <select
        v-model="ts"
        class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-2 py-1 text-[var(--color-fg-0)] cursor-pointer"
      >
        <option v-for="o in tsOptions" :key="o" :value="o">{{ o }}</option>
      </select>
    </label>
    <label class="flex items-center gap-1 text-[var(--color-fg-2)]">
      <span>bpm</span>
      <input
        type="number"
        :value="score.score.bpm"
        @change="(e) => score.setBpm(parseInt((e.target as HTMLInputElement).value, 10))"
        class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] focus:bg-[var(--color-bg-3)] px-2 py-1 w-14 text-[var(--color-fg-0)]"
        min="20"
        max="400"
      />
    </label>
    <div class="w-px h-5 bg-[var(--color-line)]"></div>
    <button
      class="hover:bg-[var(--color-bg-3)] text-[var(--color-fg-2)] hover:text-[var(--color-fg-0)] border border-[var(--color-line)] flex items-center gap-1.5 px-3"
      style="min-height: 30px; min-width: 64px"
      :class="manualOpen ? 'text-[var(--color-fg-0)] bg-[var(--color-bg-3)]' : ''"
      @click="manualOpen = !manualOpen"
      title="manual / shortcuts"
    >
      <Icon name="menu" :size="14" />
      <span class="tracking-wider">manual</span>
    </button>
    <Manual :open="manualOpen" @close="manualOpen = false" />
  </header>
</template>
