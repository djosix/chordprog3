<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    name:
      | 'play'
      | 'pause'
      | 'stop'
      | 'skip-back'
      | 'skip-forward'
      | 'step-back'
      | 'step-forward'
      | 'rewind'
      | 'fast-forward'
      | 'delete'
      | 'settings'
      | 'plus'
      | 'minus'
      | 'chevron-down'
      | 'chevron-up'
      | 'chevron-right'
      | 'chevron-left'
      | 'corner-down-left'
      | 'corner-up-left'
      | 'rotate-cw'
      | 'crosshair'
      | 'eraser'
      | 'loop'
      | 'midi'
      | 'speaker'
      | 'menu'
    | 'copy'
    | 'paste'
    size?: number
    stroke?: number
  }>(),
  { size: 14, stroke: 1.6 },
)
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="props.stroke"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
    class="inline-block align-middle"
  >
    <template v-if="name === 'play'">
      <polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'pause'">
      <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'skip-back'">
      <polygon points="20,4 9,12 20,20" fill="currentColor" stroke="none" />
      <rect x="3" y="4" width="2" height="16" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'skip-forward'">
      <polygon points="4,4 15,12 4,20" fill="currentColor" stroke="none" />
      <rect x="19" y="4" width="2" height="16" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'step-back' || name === 'rewind'">
      <polygon points="14,5 7,12 14,19" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'step-forward' || name === 'fast-forward'">
      <polygon points="10,5 17,12 10,19" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'delete'">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="2.5" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="5" y1="5" x2="8" y2="8" />
      <line x1="16" y1="16" x2="19" y2="19" />
      <line x1="5" y1="19" x2="8" y2="16" />
      <line x1="16" y1="8" x2="19" y2="5" />
    </template>
    <template v-else-if="name === 'plus'">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </template>
    <template v-else-if="name === 'minus'">
      <line x1="5" y1="12" x2="19" y2="12" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <polyline points="6,9 12,15 18,9" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <polyline points="6,15 12,9 18,15" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <polyline points="9,6 15,12 9,18" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <polyline points="15,6 9,12 15,18" />
    </template>
    <template v-else-if="name === 'corner-down-left'">
      <polyline points="9,10 4,15 9,20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </template>
    <template v-else-if="name === 'corner-up-left'">
      <polyline points="9,14 4,9 9,4" />
      <path d="M20 20v-7a4 4 0 0 0-4 -4H4" />
    </template>
    <template v-else-if="name === 'rotate-cw'">
      <polyline points="21,4 21,10 15,10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L21 10" />
    </template>
    <template v-else-if="name === 'crosshair'">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </template>
    <template v-else-if="name === 'eraser'">
      <path d="M3 17l8-8 8 8-3 3H6z" />
      <line x1="11" y1="9" x2="19" y2="17" />
    </template>
    <template v-else-if="name === 'loop'">
      <polyline points="17,1 21,5 17,9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7,23 3,19 7,15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </template>
    <template v-else-if="name === 'midi'">
      <circle cx="12" cy="12" r="9" />
      <circle cx="6" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'speaker'">
      <polygon points="4,9 9,9 14,4 14,20 9,15 4,15" fill="currentColor" stroke="none" />
      <path d="M17 8a5 5 0 0 1 0 8" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </template>
    <template v-else-if="name === 'menu'">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15V5h10" />
    </template>
    <template v-else-if="name === 'paste'">
      <rect x="6" y="5" width="12" height="15" />
      <rect x="9" y="2" width="6" height="4" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>
