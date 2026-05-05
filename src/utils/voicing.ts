import type { Beat, VoicingMode } from '@/types'
import { parseChord } from './music'

/**
 * Resolve a beat into the MIDI notes that should sound (before accompaniment
 * patterning).
 */
export function beatVoicing(beat: Beat): number[] {
  if (!beat.chord) return []
  const c = parseChord(beat.chord)
  if (!c.ok) return []
  let notes = applyVoicing(c.midiNotes, beat.voicing, c.bass)
  notes = clampToRange(notes, beat.rangeCenter - beat.rangeSpread, beat.rangeCenter + beat.rangeSpread)
  return notes
}

export function applyVoicing(midi: number[], mode: VoicingMode, bass: string | null): number[] {
  if (!midi.length) return []
  const sorted = [...midi].sort((a, b) => a - b)
  void bass // bass note already injected into midi by parseChord for slash chords
  switch (mode) {
    case 'close':
      return closePosition(sorted)
    case 'drop2':
      return dropN(closePosition(sorted), 2)
    case 'drop3':
      return dropN(closePosition(sorted), 3)
    case 'spread':
      return spread(sorted)
    case 'rootless':
      return sorted.length > 1 ? sorted.slice(1) : sorted
    case 'shell':
      // root + 3rd or 7th, simplified: keep first, last, and 3rd if present
      if (sorted.length >= 4) return [sorted[0], sorted[1], sorted[3]]
      if (sorted.length === 3) return [sorted[0], sorted[2]]
      return sorted
    case 'power': {
      // root + the chord's actual fifth + octave. For diminished chords the
      // "fifth" is 6 semitones (b5); for augmented it's 8 (#5). Find whichever
      // chord-tone sits in the [+5..+8] window above the root and use it
      // verbatim — the previous code hard-coded +7 which silently turned
      // every Cdim power-chord into a Cmaj power-chord.
      const root = sorted[0]
      let fifthOffset = 7
      for (const n of sorted) {
        const semis = ((n - root) % 12 + 12) % 12
        if (semis >= 5 && semis <= 8) {
          fifthOffset = semis
          break
        }
      }
      return [root, root + fifthOffset, root + 12]
    }
    case 'open': {
      // root low, then upper notes spread above (gospel / pop-piano spread)
      if (sorted.length < 2) return sorted
      const root = sorted[0] - 12
      const upper = closePosition(sorted.slice(1)).map((n) =>
        n - root < 12 ? n + 12 : n,
      )
      return [root, ...upper]
    }
    case 'wide': {
      // each successive note at least an octave above the previous
      if (sorted.length < 2) return sorted
      const out = [sorted[0]]
      for (let i = 1; i < sorted.length; i++) {
        let n = sorted[i]
        while (n - out[out.length - 1] < 12) n += 12
        out.push(n)
      }
      return out
    }
    case 'quartal': {
      // True quartal: stack perfect 4ths (5 semitones) starting from the
      // chord's root, choosing chord-tone pitch classes when available so the
      // resulting voicing still says the chord. Falls back to scale-tone 4ths
      // when chord tones don't fit. McCoy-Tyner / modern-jazz feel.
      if (sorted.length < 2) return sorted
      const root = sorted[0]
      const pcSet = new Set(sorted.map((n) => ((n % 12) + 12) % 12))
      const out = [root]
      // build 3-4 stacked 4ths above root
      const targetCount = Math.min(4, Math.max(3, sorted.length))
      let cursor = root
      for (let i = 1; i < targetCount; i++) {
        // try perfect 4th first; if pc not in chord, try +/-1 semitone
        let next = cursor + 5
        const tries = [next, next - 1, next + 1, next + 7] // P4, M3, A4, P5 fallback
        for (const t of tries) {
          if (pcSet.has(((t % 12) + 12) % 12)) {
            next = t
            break
          }
        }
        out.push(next)
        cursor = next
      }
      return out
    }
    case 'octave-doubled': {
      // close voicing + the root doubled a FULL octave above the top note,
      // not just at root+12*k where k yields a near-clash. Always lands a
      // whole octave above the previous topmost.
      const close = closePosition(sorted)
      const top = close[close.length - 1]
      const root = sorted[0]
      const rootPc = ((root % 12) + 12) % 12
      let doubled = top + 1
      while (((doubled % 12) + 12) % 12 !== rootPc || doubled <= top) doubled += 1
      return [...close, doubled]
    }
  }
  return sorted
}

function closePosition(midi: number[]): number[] {
  if (midi.length < 2) return midi
  const out = [midi[0]]
  for (let i = 1; i < midi.length; i++) {
    let n = midi[i]
    while (n - out[out.length - 1] > 12) n -= 12
    while (n <= out[out.length - 1]) n += 12
    out.push(n)
  }
  return out
}

function dropN(midi: number[], n: number): number[] {
  // drop2: take 2nd-from-top down an octave; drop3: 3rd-from-top
  if (midi.length < n + 1) return midi
  const idx = midi.length - n
  const out = [...midi]
  out[idx] = out[idx] - 12
  return out.sort((a, b) => a - b)
}

function spread(midi: number[]): number[] {
  // arrange so each note is at least a fifth apart when possible
  if (midi.length < 2) return midi
  const out = [midi[0]]
  for (let i = 1; i < midi.length; i++) {
    let n = midi[i]
    while (n - out[out.length - 1] < 5) n += 12
    out.push(n)
  }
  return out
}

function clampToRange(midi: number[], lo: number, hi: number): number[] {
  if (!midi.length) return midi
  // If the window is too tight to hold a stacked chord (less than a half-octave),
  // skip clamping so chords don't collapse into a unison cluster.
  if (hi - lo < 7) return midi.slice()
  // Rigid-body translation by octaves first: keeps `wide`/`open`/`octave-doubled`
  // structures intact when the whole voicing fits inside the window after a
  // simple shift. Only fall back to per-note folding when the voicing genuinely
  // can't fit.
  const sorted = [...midi].sort((a, b) => a - b)
  const lowest = sorted[0]
  const highest = sorted[sorted.length - 1]
  let shift = 0
  while (lowest + shift < lo) shift += 12
  while (lowest + shift > hi) shift -= 12
  if (lowest + shift >= lo && highest + shift <= hi) {
    return midi.map((n) => n + shift)
  }
  return midi.map((n) => {
    let v = n + shift
    while (v > hi) v -= 12
    while (v < lo) v += 12
    return v
  })
}

