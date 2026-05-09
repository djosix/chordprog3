import { ref } from 'vue'

const altOrMeta = ref(false)
const shift = ref(false)
/**
 * `d` held = piano-roll DELETE mode. Tracked here so the cursor / overlay
 * can react instantly (same as alt/cmd does for DRAW mode). Only respected
 * when the user is NOT typing in an input/textarea — otherwise hitting 'd'
 * inside a chord input would silently arm delete-mode while the keystroke
 * also lands in the text field.
 */
const dHeld = ref(false)
let attached = false

function isTypingTarget(): boolean {
  const el = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

function refresh(e: KeyboardEvent) {
  altOrMeta.value = e.altKey || e.metaKey
  shift.value = e.shiftKey
  if (e.code === 'KeyD') {
    if (e.type === 'keydown') {
      // Only arm if the keystroke isn't going into a text input.
      if (!isTypingTarget()) dHeld.value = true
    } else {
      // Always disarm on keyup so a stuck modifier can never hijack clicks
      // after the user lifts the key.
      dHeld.value = false
    }
  }
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
    dHeld.value = false
  })
  // also handle mousemove with modifier state (in case keydown was missed).
  // dHeld is intentionally NOT updated from mousemove — there's no e.dKey,
  // and the keydown/keyup handlers above are authoritative.
  window.addEventListener('mousemove', (e) => {
    altOrMeta.value = e.altKey || e.metaKey
    shift.value = e.shiftKey
  })
}

export function useModifierKeys() {
  attach()
  return { altOrMeta, shift, dHeld }
}
