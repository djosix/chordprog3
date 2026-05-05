import type { Bar, Beat, PianoRollNote, TimeSignature } from '@/types'
import { beatVoicing } from '@/utils/voicing'

/** how many 1/32 cells fit in a single beat under this time signature */
export function cellsPerBeat(ts: TimeSignature): number {
  // Defensive: a corrupted persisted ts.denominator of 0 / NaN / negative
  // would produce Infinity / NaN and poison every downstream timing call.
  const den = Number.isFinite(ts.denominator) && ts.denominator > 0 ? ts.denominator : 4
  return Math.max(1, Math.round(32 / den))
}

/** total number of 1/32 cells in a bar under this time signature */
export function cellsPerBar(ts: TimeSignature): number {
  const num = Number.isFinite(ts.numerator) && ts.numerator > 0 ? ts.numerator : 4
  return num * cellsPerBeat(ts)
}

/** seconds-per-cell at the current bpm. bpm = beats per minute. */
export function cellSeconds(ts: TimeSignature, bpm: number): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 100
  return 60 / safeBpm / cellsPerBeat(ts)
}

/**
 * Walk a bar's beats and group them into "chord spans": each chord-bearing
 * beat starts a span that lasts until the next chord-bearing beat (or the end
 * of the bar). Beats with empty chord just extend the previous span.
 */
interface ChordSpan {
  beat: Beat
  startBeat: number
  endBeat: number
}

function chordSpans(bar: Bar): ChordSpan[] {
  const out: ChordSpan[] = []
  bar.beats.forEach((b, i) => {
    const has = b.chord.trim().length > 0
    if (has) {
      if (out.length) out[out.length - 1].endBeat = i
      out.push({ beat: b, startBeat: i, endBeat: bar.beats.length })
    }
  })
  return out
}

/**
 * Generate all notes for a bar from its beats' chord/style/voicing/range.
 * A chord on beat N continues until the next beat with a chord (or end of bar).
 */
export function notesFromBar(bar: Bar, ts: TimeSignature): PianoRollNote[] {
  const cpb = cellsPerBeat(ts)
  const out: PianoRollNote[] = []
  for (const span of chordSpans(bar)) {
    out.push(...notesForSpan(span.beat, span.startBeat, span.endBeat, cpb))
  }
  return out.sort((a, b) => a.startCell - b.startCell || a.pitch - b.pitch)
}

function notesForSpan(beat: Beat, startBeat: number, endBeat: number, cpb: number): PianoRollNote[] {
  const v = beatVoicing(beat)
  if (!v.length) return []
  // Defensive: a 0-length span would emit notes with duration 0, which
  // confuses both the piano-roll renderer and the playback hits[] (durSec=0).
  if (endBeat <= startBeat) return []
  const startCell = startBeat * cpb
  const totalCells = (endBeat - startBeat) * cpb
  const out: PianoRollNote[] = []
  switch (beat.style) {
    case 'rest':
      return []
    case 'block':
    case 'sustain': {
      for (const n of v) {
        out.push({ pitch: n, startCell, duration: totalCells })
      }
      return out
    }
    case 'arp-up':
      return arpAcrossSpan(v, startCell, cpb, endBeat - startBeat)
    case 'arp-down':
      return arpAcrossSpan([...v].reverse(), startCell, cpb, endBeat - startBeat)
    case 'arp-up-down': {
      const seq = [...v, ...[...v].reverse().slice(1, -1)]
      return arpAcrossSpan(seq, startCell, cpb, endBeat - startBeat)
    }
    case 'alberti': {
      const low = v[0]
      const high = v[v.length - 1]
      const mid = v[Math.floor(v.length / 2)] ?? high
      const seq = [low, high, mid, high]
      // four notes per beat
      const noteCells = Math.max(1, Math.floor(cpb / seq.length))
      for (let bi = 0; bi < endBeat - startBeat; bi++) {
        const base = startCell + bi * cpb
        for (let i = 0; i < seq.length; i++) {
          out.push({ pitch: seq[i], startCell: base + i * noteCells, duration: noteCells })
        }
      }
      return out
    }
    case 'bossa': {
      // each beat: root on the first half, upper chord on the offbeat half
      const half = Math.max(1, Math.floor(cpb / 2))
      const upper = v.length > 1 ? v.slice(1) : v
      for (let bi = 0; bi < endBeat - startBeat; bi++) {
        const base = startCell + bi * cpb
        out.push({ pitch: v[0], startCell: base, duration: half })
        for (const n of upper) out.push({ pitch: n, startCell: base + half, duration: cpb - half })
      }
      return out
    }
    case 'waltz': {
      // root on the first beat of every 3-beat cycle within the span, upper
      // chord on the other two. Indexed off the span itself so the pattern
      // restarts cleanly at the first beat of each chord change.
      const upper = v.length > 1 ? v.slice(1) : v
      for (let bi = 0; bi < endBeat - startBeat; bi++) {
        const base = startCell + bi * cpb
        const onDown = bi % 3 === 0
        const notes = onDown ? [v[0]] : upper
        for (const n of notes) out.push({ pitch: n, startCell: base, duration: cpb })
      }
      return out
    }
    case 'bass-chord': {
      // alternating root / upper-chord every beat
      const upper = v.length > 1 ? v.slice(1) : v
      for (let bi = 0; bi < endBeat - startBeat; bi++) {
        const base = startCell + bi * cpb
        const notes = (startBeat + bi) % 2 === 0 ? [v[0]] : upper
        for (const n of notes) out.push({ pitch: n, startCell: base, duration: cpb })
      }
      return out
    }
    case 'reggae': {
      // chord on the offbeat half only (silence on the down-beat half)
      const half = Math.max(1, Math.floor(cpb / 2))
      const upper = v.length > 1 ? v.slice(1) : v
      for (let bi = 0; bi < endBeat - startBeat; bi++) {
        const base = startCell + bi * cpb
        for (const n of upper) out.push({ pitch: n, startCell: base + half, duration: cpb - half })
      }
      return out
    }
    default:
      // unknown style → fall back to a block chord across the span
      for (const n of v) out.push({ pitch: n, startCell, duration: totalCells })
      return out
  }
}

function arpAcrossSpan(seq: number[], startCell: number, cpb: number, beatsInSpan: number): PianoRollNote[] {
  const out: PianoRollNote[] = []
  if (!seq.length) return out
  const noteCells = Math.max(1, Math.floor(cpb / seq.length))
  for (let bi = 0; bi < beatsInSpan; bi++) {
    const base = startCell + bi * cpb
    for (let i = 0; i < seq.length; i++) {
      out.push({ pitch: seq[i], startCell: base + i * noteCells, duration: noteCells })
    }
  }
  return out
}

/**
 * Returns whether a candidate range [startCell, startCell+duration) overlaps
 * an existing same-pitch note in `notes` (excluding the optional `ignoreIndex`).
 */
export function overlapsExistingNote(
  notes: PianoRollNote[],
  pitch: number,
  startCell: number,
  duration: number,
  ignoreIndex = -1,
): boolean {
  const end = startCell + duration
  for (let i = 0; i < notes.length; i++) {
    if (i === ignoreIndex) continue
    const n = notes[i]
    if (n.pitch !== pitch) continue
    const nEnd = n.startCell + n.duration
    if (n.startCell < end && nEnd > startCell) return true
  }
  return false
}

export function noteAtCell(notes: PianoRollNote[], pitch: number, cell: number): number {
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n.pitch !== pitch) continue
    if (cell >= n.startCell && cell < n.startCell + n.duration) return i
  }
  return -1
}

export type CellKind = 'empty' | 'on' | 'sustain'
export function cellKind(notes: PianoRollNote[], pitch: number, cell: number): CellKind {
  const idx = noteAtCell(notes, pitch, cell)
  if (idx < 0) return 'empty'
  return notes[idx].startCell === cell ? 'on' : 'sustain'
}
