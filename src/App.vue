<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import TopBar from '@/components/TopBar.vue'
import BottomBar from '@/components/BottomBar.vue'
import EditorArea from '@/components/EditorArea.vue'
import PianoRoll from '@/components/PianoRoll.vue'
import { useScoreStore } from '@/store/score'
import { usePlaybackStore } from '@/store/playback'

const score = useScoreStore()
const playback = usePlaybackStore()

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t) return false
  const el = t as HTMLElement
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

/** SELECT is special: it should keep its native Enter/Space (commit / open
 *  popup) but lose arrows/`,/.` to global navigation. */
function isFocusedSelect(t: EventTarget | null): boolean {
  if (!t) return false
  const el = t as HTMLElement
  return el.tagName === 'SELECT'
}

/**
 * Run a shortcut and consume the event so it never reaches focused buttons /
 * inputs. We listen in capture phase, so this fires before any descendant.
 */
function consume(e: KeyboardEvent, fn: () => void) {
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  fn()
}

function onKey(e: KeyboardEvent) {
  // IME composition (Japanese/Chinese/Korean input) — let the IME handle it
  if (e.isComposing) return
  const typing = isTypingTarget(e.target)
  const meta = e.metaKey || e.ctrlKey

  // meta-based selection shortcuts work even while typing in an input,
  // BUT only when there is a bar selection to act on; otherwise we let the
  // event through so the input behaves normally.
  if (meta && score.selection.anchor) {
    if (e.code === 'KeyC') return consume(e, () => score.copySelection())
    if (e.code === 'KeyX') return consume(e, () => score.cutSelection())
    if (e.code === 'KeyV') {
      return consume(e, () => {
        if (e.shiftKey) score.pasteReplace()
        else {
          const r = score.selectionRange()
          if (r) score.pasteAt(r.startRow, r.startBar)
        }
      })
    }
  }

  // Esc clears selection always; for typing targets we still also blur.
  if (e.code === 'Escape') {
    score.setSelection(null, null)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // do not stopPropagation: components may want their own escape behavior
    return
  }

  // Beyond this point: keys are global only when no input/textarea is focused.
  if (typing) return

  // when a <select> is focused, let it keep Enter / Space natively
  const onSelect = isFocusedSelect(e.target)
  if (e.code === 'Space' && !meta && !onSelect) {
    return consume(e, () => {
      if (playback.isPlaying) playback.pause()
      else playback.play()
    })
  }
  // Enter → focus the chord input at the playhead position
  if (e.code === 'Enter' && !meta && !onSelect) {
    return consume(e, () => focusPlayheadChordInput())
  }
  if ((e.code === 'Digit0' || e.code === 'Numpad0') && !meta) {
    return consume(e, () => {
      playback.stop()
      playback.rewind()
    })
  }
  // Comma / Period intentionally do nothing (replaced by shift+arrow nav)

  if (e.code === 'ArrowLeft' && !meta) {
    if (e.shiftKey) return consume(e, () => playback.stepBar(-1))
    return consume(e, () => playback.stepBeat(-1))
  }
  if (e.code === 'ArrowRight' && !meta) {
    if (e.shiftKey) return consume(e, () => playback.stepBar(1))
    return consume(e, () => playback.stepBeat(1))
  }
  if (e.code === 'ArrowUp' && !meta) {
    if (e.shiftKey) return consume(e, () => playback.stepRow(-1))
    return consume(e, () => playback.stepBeatVertical(-1))
  }
  if (e.code === 'ArrowDown' && !meta) {
    if (e.shiftKey) return consume(e, () => playback.stepRow(1))
    return consume(e, () => playback.stepBeatVertical(1))
  }
  if ((e.code === 'Backspace' || e.code === 'Delete') && score.selection.anchor) {
    return consume(e, () => score.deleteSelection())
  }
  // i / a (lowercase) — measure insert / append at the playhead's bar
  // I / A (shift)     — row insert / append at the playhead's row
  // The new bar/row clones the playhead's current bar/row's settings (style,
  // voicing, range) but with blank chords / empty notes.
  if (e.code === 'KeyI' && !meta) {
    return consume(e, () => {
      const ri = playback.playhead.rowIndex
      const bi = playback.playhead.barIndex
      if (e.shiftKey) {
        const at = score.insertRow(ri)
        if (at >= 0) playback.setPlayhead(at, 0, 0)
      } else {
        const at = score.insertBar(ri, bi)
        if (at >= 0) playback.setPlayhead(ri, at, 0)
      }
    })
  }
  if (e.code === 'KeyA' && !meta) {
    return consume(e, () => {
      const ri = playback.playhead.rowIndex
      const bi = playback.playhead.barIndex
      if (e.shiftKey) {
        const at = score.appendRow(ri)
        if (at >= 0) playback.setPlayhead(at, 0, 0)
      } else {
        const at = score.appendBar(ri, bi)
        if (at >= 0) playback.setPlayhead(ri, at, 0)
      }
    })
  }
  // l — listen to the playhead beat's chord as a clean block voicing
  if (e.code === 'KeyL' && !meta && !e.shiftKey) {
    return consume(e, () => playback.listenChord())
  }
  // o — toggle loop
  if (e.code === 'KeyO' && !meta && !e.shiftKey) {
    return consume(e, () => (playback.loop = !playback.loop))
  }
  // suppress browser cmd+a / cmd+f when not typing
  if (meta && (e.code === 'KeyA' || e.code === 'KeyF') && !typing) {
    return consume(e, () => {})
  }
  // y / p — yank / paste beat settings (style, voicing, range)
  if (e.code === 'KeyY' && !meta && !e.shiftKey) {
    return consume(e, () => {
      const { rowIndex, barIndex, beatIndex } = playback.playhead
      score.yankBeat(rowIndex, barIndex, beatIndex)
    })
  }
  if (e.code === 'KeyP' && !meta && !e.shiftKey) {
    return consume(e, () => {
      const { rowIndex, barIndex, beatIndex } = playback.playhead
      score.pasteBeat(rowIndex, barIndex, beatIndex)
    })
  }
}

function focusPlayheadChordInput() {
  const ri = playback.playhead.rowIndex
  const bi = playback.playhead.barIndex
  const bei = playback.playhead.beatIndex
  const sel = `[data-chord-input="${ri}_${bi}_${bei}"]`
  const el = document.querySelector(sel) as HTMLInputElement | null
  if (!el) return
  el.focus()
  el.select()
}

onMounted(() => {
  // capture phase — intercept before focused buttons trigger their click
  window.addEventListener('keydown', onKey, { capture: true })
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, { capture: true } as any)
})
</script>

<template>
  <div class="flex flex-col h-full bg-[var(--color-bg-0)] text-[var(--color-fg-0)]">
    <TopBar />
    <main class="flex-1 min-h-0 flex flex-col">
      <EditorArea class="flex-1 min-h-0 overflow-auto" />
      <PianoRoll class="shrink-0" />
    </main>
    <BottomBar />
  </div>
</template>
