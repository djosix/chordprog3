import { ref } from 'vue'

const altOrMeta = ref(false)
const shift = ref(false)
let attached = false

function refresh(e: KeyboardEvent) {
  altOrMeta.value = e.altKey || e.metaKey
  shift.value = e.shiftKey
}

function attach() {
  if (attached) return
  attached = true
  if (typeof window === 'undefined') return
  window.addEventListener('keydown', refresh, { capture: true })
  window.addEventListener('keyup', refresh, { capture: true })
  window.addEventListener('blur', () => {
    altOrMeta.value = false
    shift.value = false
  })
  // also handle mousemove with modifier state (in case keydown was missed)
  window.addEventListener('mousemove', (e) => {
    altOrMeta.value = e.altKey || e.metaKey
    shift.value = e.shiftKey
  })
}

export function useModifierKeys() {
  attach()
  return { altOrMeta, shift }
}
