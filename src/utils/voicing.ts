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
      // root + perfect fifth + octave; drops 3rd / 7th / extensions
      const root = sorted[0]
      // try to find an existing fifth (7 semitones above root, modulo 12)
      const fifth = sorted.find((n) => ((n - root) % 12 + 12) % 12 === 7) ?? root + 7
      return [root, root + 7 === fifth ? fifth : root + 7, root + 12]
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

/**
 * Generate a per-sub-beat note plan based on accompaniment style.
 * Returns an array of {time: 0..1, notes: number[], duration: 0..1} entries
 * representing what plays during this single beat.
 */
export interface NoteHit {
  /** offset within the beat 0..1 */
  offset: number
  /** how long to hold (in beats) */
  duration: number
  /** midi notes */
  notes: number[]
}

export function patternForBeat(beat: Beat, isFirstOfBar: boolean): NoteHit[] {
  const v = beatVoicing(beat)
  if (!v.length) return []
  // Many of the multi-beat patterns use root vs. upper-chord vs. mid-chord.
  const root = v[0]
  const upper = v.slice(1)
  switch (beat.style) {
    case 'block':
      return [{ offset: 0, duration: 1, notes: v }]
    case 'sustain':
      // hold only on first beat of the bar; otherwise nothing
      return isFirstOfBar ? [{ offset: 0, duration: 4, notes: v }] : []
    case 'rest':
      return []
    case 'arp-up':
      return arpHits(v, false)
    case 'arp-down':
      return arpHits([...v].reverse(), false)
    case 'arp-up-down': {
      const seq = [...v, ...[...v].reverse().slice(1, -1)]
      return arpHits(seq, false)
    }
    case 'alberti': {
      // 4-note alberti: low, high, mid, high (cycles within v)
      const low = v[0]
      const high = v[v.length - 1]
      const mid = v[Math.floor(v.length / 2)] ?? high
      const seq = [low, high, mid, high]
      return arpHits(seq, true)
    }
    case 'bossa': {
      // Bossa-feel comping: bass root on the down-beat, upper chord stabs on
      // the offbeat 8ths (.5). Plays root for the full beat, chord for the 2nd
      // half (a syncopated feel when chained across beats).
      if (!upper.length) return [{ offset: 0, duration: 1, notes: v }]
      return [
        { offset: 0, duration: 0.5, notes: [root] },
        { offset: 0.5, duration: 0.5, notes: upper },
      ]
    }
    case 'waltz': {
      // For triple meter: root on beat 1 of the cycle, chord stabs on 2 & 3.
      // We approximate per-beat: if it's first beat, play root; otherwise
      // play upper-chord stab.
      return [{ offset: 0, duration: 1, notes: isFirstOfBar ? [root] : upper.length ? upper : v }]
    }
    case 'bass-chord': {
      // Pop ballad — alternating bass and chord. On beat 1: root. Other beats:
      // upper chord. Half-duration each so the listener hears the swap.
      return [{ offset: 0, duration: 1, notes: isFirstOfBar ? [root] : upper.length ? upper : v }]
    }
    case 'reggae': {
      // Off-beat upbeat — silence on the down-beat, chord stab on the &.
      return [{ offset: 0.5, duration: 0.5, notes: upper.length ? upper : v }]
    }
    default:
      return [{ offset: 0, duration: 1, notes: v }]
  }
}

function arpHits(seq: number[], evenSubdiv: boolean): NoteHit[] {
  const n = seq.length
  if (!n) return []
  const step = evenSubdiv ? 1 / 4 : 1 / n
  const dur = step
  const hits: NoteHit[] = []
  for (let i = 0; i < (evenSubdiv ? 4 : n); i++) {
    hits.push({
      offset: i * step,
      duration: dur,
      notes: [seq[i % n]],
    })
  }
  return hits
}
