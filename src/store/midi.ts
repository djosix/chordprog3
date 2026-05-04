import { defineStore } from 'pinia'
import { reactive, ref, computed } from 'vue'
import { Chord } from 'tonal'

interface MidiInputInfo {
  id: string
  name: string
}

/**
 * Tracks live MIDI input: which pitches are currently held, and a derived
 * chord-detect string from the held notes. Also broadcasts note-on events to
 * subscribers (e.g. a focused chord input for "fill from MIDI" workflows).
 */
export const useMidiStore = defineStore('midi', () => {
  const access = ref<MIDIAccess | null>(null)
  const inputs = ref<MidiInputInfo[]>([])
  const enabled = ref(false)

  /** pitches currently held by the MIDI controller (note-on without note-off yet) */
  const heldPitches = reactive(new Set<number>())
  /** velocities by pitch */
  const heldVel = reactive(new Map<number, number>())

  /** the most recently-detected chord(s) from the held pitches, if any */
  const detected = ref<string[]>([])

  type NoteOnHandler = (pitch: number, velocity: number) => void
  const noteOnSubs = new Set<NoteOnHandler>()
  function onNoteOn(fn: NoteOnHandler) {
    noteOnSubs.add(fn)
    return () => noteOnSubs.delete(fn)
  }
  type NoteOffHandler = (pitch: number) => void
  const noteOffSubs = new Set<NoteOffHandler>()
  function onNoteOff(fn: NoteOffHandler) {
    noteOffSubs.add(fn)
    return () => noteOffSubs.delete(fn)
  }

  function recompute() {
    const pcs = [...heldPitches].sort((a, b) => a - b).map((m) => pitchClass(m))
    if (pcs.length < 2) {
      detected.value = []
      return
    }
    try {
      // tonal detects from pitch-class array; using letter+octave gives slash chords
      const lettersWithOct = [...heldPitches].sort((a, b) => a - b).map(midiToTonalName)
      const candidates = Chord.detect(lettersWithOct)
      detected.value = candidates.length ? candidates : Chord.detect(pcs)
    } catch {
      detected.value = []
    }
  }

  function handleMessage(e: MIDIMessageEvent) {
    if (!e.data) return
    const [status, d1, d2] = Array.from(e.data)
    const cmd = status & 0xf0
    if (cmd === 0x90 && d2 > 0) {
      heldPitches.add(d1)
      heldVel.set(d1, d2)
      recompute()
      noteOnSubs.forEach((fn) => fn(d1, d2))
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      heldPitches.delete(d1)
      heldVel.delete(d1)
      recompute()
      noteOffSubs.forEach((fn) => fn(d1))
    }
  }

  async function ensure() {
    if (access.value) return access.value
    if (!navigator.requestMIDIAccess) {
      console.warn('WebMIDI not supported')
      return null
    }
    try {
      const a = await navigator.requestMIDIAccess({ sysex: false })
      access.value = a
      const refresh = () => {
        inputs.value = []
        a.inputs.forEach((inp) => {
          inputs.value.push({ id: inp.id, name: inp.name || inp.id })
          inp.onmidimessage = handleMessage
        })
      }
      refresh()
      a.addEventListener('statechange', refresh)
      enabled.value = true
      return a
    } catch (e) {
      console.warn('MIDI input access denied', e)
      return null
    }
  }

  function disable() {
    if (access.value) {
      access.value.inputs.forEach((inp) => (inp.onmidimessage = null))
    }
    enabled.value = false
    heldPitches.clear()
    heldVel.clear()
    detected.value = []
  }

  function toggle() {
    if (enabled.value) disable()
    else ensure()
  }

  const heldList = computed(() => [...heldPitches].sort((a, b) => a - b))

  return {
    access,
    inputs,
    enabled,
    heldPitches,
    heldVel,
    heldList,
    detected,
    ensure,
    disable,
    toggle,
    onNoteOn,
    onNoteOff,
  }
})

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function pitchClass(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12]
}

function midiToTonalName(midi: number): string {
  const oct = Math.floor(midi / 12) - 1
  return pitchClass(midi) + oct
}
