<script setup lang="ts">
import { KEY_OPTIONS } from '@/utils/music'

const props = defineProps<{
  value: string | null
  inherited: string | null
}>()

const emit = defineEmits<{
  (e: 'change', value: string | null): void
}>()

function onChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('change', v === '__inherit__' ? null : v)
}
</script>

<template>
  <label class="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-2)]">
    <span class="text-[var(--color-key)]">key</span>
    <select
      :value="props.value ?? '__inherit__'"
      @change="onChange"
      class="bg-[var(--color-bg-2)] hover:bg-[var(--color-bg-3)] px-1 py-0.5 text-[var(--color-fg-1)]"
    >
      <option value="__inherit__">
        {{ inherited ? `inherit (${inherited})` : 'inherit (—)' }}
      </option>
      <option v-for="k in KEY_OPTIONS" :key="k" :value="k">{{ k }}</option>
    </select>
  </label>
</template>
