<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { usePlaybackStore } from '@/store/playback'
import { useScoreStore } from '@/store/score'
import { useMidiStore } from '@/store/midi'

const playback = usePlaybackStore()
const score = useScoreStore()
const midi = useMidiStore()

const positionLabel = computed(
  () =>
    `row ${playback.playhead.rowIndex + 1} · bar ${playback.playhead.barIndex + 1} · beat ${
      playback.playhead.beatIndex + 1
    }`,
)
const loopLabel = computed(() => {
  const sel = score.selectionRange()
  const single = sel && sel.startRow === sel.endRow && sel.startBar === sel.endBar
  const range = sel
    ? single
      ? `r${sel.startRow + 1}.b${sel.startBar + 1}`
      : `r${sel.startRow + 1}.b${sel.startBar + 1} → r${sel.endRow + 1}.b${sel.endBar + 1}`
    : null
  if (playback.loop) return range ? `loop ${range}` : 'loop on'
  return range ? `play ${range}` : 'loop off'
})

async function onModeChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value as 'sample' | 'midi'
  playback.output.mode = v
  if (v === 'midi') await playback.ensureMidi()
}

async function refreshMidi() {
  await playback.ensureMidi()
}

function totalBeats() {
  let n = 0
  for (const r of score.score.rows) for (const b of r.bars) n += b.beats.length
  return n
}

const transportButtons = computed(() => [
  { id: 'prevBar', icon: 'skip-back', title: 'prev bar  (shift+←)', click: () => playback.stepBar(-1) },
  { id: 'prevBeat', icon: 'rewind', title: 'prev beat  (←)', click: () => playback.stepBeat(-1) },
  {
    id: 'play',
    icon: 'play',
    title: 'play  (space)',
    click: () => playback.play(),
    accent: !playback.isPlaying,
  },
  { id: 'pause', icon: 'pause', title: 'pause  (space)', click: () => playback.pause() },
  {
    id: 'stop',
    icon: 'stop',
    title: 'stop & rewind  (enter / 0)',
    click: () => {
      playback.stop()
      playback.rewind()
    },
  },
  { id: 'nextBeat', icon: 'fast-forward', title: 'next beat  (→)', click: () => playback.stepBeat(1) },
  { id: 'nextBar', icon: 'skip-forward', title: 'next bar  (shift+→)', click: () => playback.stepBar(1) },
])
</script>

<template>
  <footer
    class="sticky bottom-0 z-30 flex items-center gap-2 h-12 px-3 border-t border-[var(--color-line)] bg-[var(--color-bg-1)] text-[11px]"
  >
    <div class="flex items-center gap-1">
      <button
        v-for="b in transportButtons"
        :key="b.id"
        class="flex items-center justify-center border border-[var(--color-line)] hover:bg-[var(--color-bg-3)] hover:border-[var(--color-line-strong)] active:bg-[var(--color-line)] transition-colors"
        style="min-width: 36px; min-height: 32px"
        :class="
          b.accent
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-fg-1)] hover:text-[var(--color-fg-0)]'
        "
        :title="b.title"
        @click="b.click"
      >
        <Icon :name="b.icon as any" :size="16" />
      </button>
    </div>
    <button
      class="flex items-center gap-1.5 px-3 border transition-colors uppercase tracking-wider text-[10px]"
      style="min-height: 32px"
      :class="
        playback.loop
          ? 'bg-[var(--color-accent)] text-[var(--color-bg-0)] border-[var(--color-accent)] hover:bg-[var(--color-accent-dim)]'
          : 'border-[var(--color-line)] text-[var(--color-fg-2)] hover:text-[var(--color-fg-0)] hover:bg-[var(--color-bg-3)] hover:border-[var(--color-line-strong)]'
      "
      :title="playback.loop ? 'loop ON  (o)' : 'loop OFF  (o)'"
      :aria-pressed="playback.loop"
      @click="playback.loop = !playback.loop"
    >
      <Icon name="loop" :size="14" />
      <span class="normal-case lowercase">{{ loopLabel }}</span>
    </button>
    <div class="flex-1"></div>
    <div
      class="flex items-center gap-2 px-2 border border-[var(--color-line)]"
      style="min-height: 32px"
      :title="midi.enabled ? 'midi input on — play your keyboard' : 'enable midi input'"
    >
      <button
        class="flex items-center gap-1 hover:text-[var(--color-fg-0)] py-1"
        :class="midi.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-2)]'"
        @click="midi.toggle"
      >
        <Icon name="midi" :size="14" />
        <span class="uppercase tracking-wider">in</span>
      </button>
      <span
        v-if="midi.enabled && midi.detected.length"
        class="text-[var(--color-accent)] tracking-tight normal-case"
        :title="`detected: ${midi.detected.join(' / ')}`"
      >
        {{ midi.detected[0] }}
      </span>
      <span
        v-else-if="midi.enabled"
        class="text-[var(--color-fg-3)] uppercase tracking-wider text-[10px]"
      >
        {{ midi.heldList.length }} held
      </span>
    </div>
    <div class="px-2 text-[var(--color-fg-2)] uppercase tracking-wider">
      {{ positionLabel }} / {{ totalBeats() }}b
    </div>
    <div class="w-px h-6 bg-[var(--color-line)]"></div>
    <div
      class="flex items-center gap-2 px-2 border border-[var(--color-line)]"
      style="min-height: 32px"
    >
      <Icon
        :name="playback.output.mode === 'midi' ? 'midi' : 'speaker'"
        :size="14"
        class="text-[var(--color-fg-2)]"
      />
      <select
        :value="playback.output.mode"
        @change="onModeChange"
        class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-2 py-1 text-[var(--color-fg-0)]"
        title="output mode"
      >
        <option value="sample">sample piano</option>
        <option value="midi">midi out</option>
      </select>
      <select
        v-if="playback.output.mode === 'midi'"
        v-model="playback.output.midiOutputId"
        class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-2 py-1 text-[var(--color-fg-0)] max-w-[12rem]"
        title="midi device"
      >
        <option v-if="!playback.midiOutputs.length" :value="null">— no devices —</option>
        <option v-for="o in playback.midiOutputs" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>
      <button
        v-if="playback.output.mode === 'midi'"
        class="px-2 py-1 hover:bg-[var(--color-bg-3)] text-[var(--color-fg-2)] hover:text-[var(--color-fg-0)] flex items-center"
        style="min-width: 28px; min-height: 28px"
        @click="refreshMidi"
        title="refresh midi devices"
      >
        <Icon name="rotate-cw" :size="13" />
      </button>
      <label
        class="flex items-center gap-1 text-[var(--color-fg-2)] uppercase tracking-wider"
        title="output volume"
      >
        <span>vol</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          v-model.number="playback.output.volume"
          class="w-24 accent-[var(--color-accent)]"
        />
      </label>
    </div>
  </footer>
</template>
