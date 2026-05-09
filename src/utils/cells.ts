import type { Bar, Beat, PianoRollNote, RhythmShape, TimeSignature } from '@/types'
import { beatVoicing } from '@/utils/voicing'
import { parseChord } from '@/utils/music'

/** how many 1/32 cells fit in a single beat under this time signature */
export function cellsPerBeat(ts: TimeSignature): number {
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

/** A chord-bearing beat sustains until the next chord-bearing beat or bar end. */
interface ChordSpan {
  beat: Beat
  startBeat: number
  endBeat: number
}

function chordSpans(bar: Bar): ChordSpan[] {
  const out: ChordSpan[] = []
  bar.beats.forEach((b, i) => {
    if (b.chord.trim().length > 0) {
      if (out.length) out[out.length - 1].endBeat = i
      out.push({ beat: b, startBeat: i, endBeat: bar.beats.length })
    }
  })
  return out
}

export function notesFromBar(bar: Bar, ts: TimeSignature): PianoRollNote[] {
  const cpb = cellsPerBeat(ts)
  const out: PianoRollNote[] = []
  for (const span of chordSpans(bar)) {
    out.push(...notesForSpan(span.beat, span.startBeat, span.endBeat, cpb))
  }
  return out.sort((a, b) => a.startCell - b.startCell || a.pitch - b.pitch)
}

/* ────────────────────────────────────────────────────────────────────────
 *  Heuristic accompaniment generator
 *
 *  Replaces the old single-axis `style` enum. For each chord-span the
 *  pipeline is:
 *
 *    voicing          ── from beatVoicing (voicing mode + range)
 *    bass pitch       ── chord tonic / slash bass placed in a low register
 *    canonical hits   ── a priority-ordered list of (cell, role, length)
 *                        events for the chosen rhythm shape
 *    density          ── top-K cutoff over the canonical list
 *    syncopation      ── push strong-beat hits onto the off-beat &-cell
 *                        with deterministic per-cell pseudo-random gating
 *    voices           ── per-event subset of the voicing, ranked by
 *                        musical importance (top voice → guide tones →
 *                        extensions → 5 → root). Pro-keyboardist-style:
 *                        the 3 and 7 are load-bearing, the 5 is dropped
 *                        first, the root is implied by the bass register.
 *  ──────────────────────────────────────────────────────────────────── */

type Role = 'bass' | 'chord' | 'arp'

interface Hit {
  /** cell offset within the span */
  cell: number
  /** event length in cells */
  len: number
  role: Role
  /** for arp role: which voice in the voicing array (low-to-high) */
  arpIndex?: number
  /** higher = kept first when density thins the list */
  priority: number
}

function notesForSpan(beat: Beat, startBeat: number, endBeat: number, cpb: number): PianoRollNote[] {
  if (endBeat <= startBeat) return []
  // voices=0 → silence. Lets the user "rest" by sliding voices to 0 without
  // having to also touch density, and matches the behaviour of the old
  // 'rest' style enum.
  if (beat.voices <= 0) return []
  const voicing = [...beatVoicing(beat)].sort((a, b) => a - b)
  if (!voicing.length) return []

  const startCell = startBeat * cpb
  const beatsInSpan = endBeat - startBeat

  // Resolve the chord's true root for the bass register, independent of
  // voicing — a rootless voicing has no root in the upper-chord stack but
  // bass-chord shapes still need to fire the actual root.
  const parsed = parseChord(beat.chord)
  const rootPc = parsed.ok && parsed.midiNotes.length
    ? ((parsed.midiNotes[0] % 12) + 12) % 12
    : ((voicing[0] % 12) + 12) % 12
  const bassPitch = pickBassPitch(parsed.midiNotes[0] ?? voicing[0], voicing[0])

  let hits = generateHits(beat.shape, voicing.length, cpb, beatsInSpan)
  hits = applyDensity(hits, beat.density, beatsInSpan)
  hits = applySyncopation(hits, beat.syncopation, cpb, startCell)
  // Filter out hits that fall entirely outside the span (syncopation can
  // push a hit past the span end).
  const totalCells = beatsInSpan * cpb
  hits = hits.filter((h) => h.cell < totalCells)

  const out: PianoRollNote[] = []
  for (const h of hits) {
    const len = Math.max(1, Math.min(h.len, totalCells - h.cell))
    const pitches = notesForEvent(h, voicing, rootPc, beat.voices, bassPitch)
    for (const p of pitches) {
      out.push({
        pitch: p,
        startCell: startCell + h.cell,
        duration: len,
        velocity: velocityForRole(h.role, beat.voices),
      })
    }
  }
  return out
}

function pickBassPitch(naturalRootMidi: number, voicingLowest: number): number {
  // Place the chord root in a bass register: clearly below the voicing's
  // lowest note. Move by octaves only so the pitch class stays correct.
  let bass = naturalRootMidi
  const ceiling = voicingLowest - 6 // at least a tritone below the voicing
  while (bass > ceiling) bass -= 12
  while (bass < 24) bass += 12 // floor at C1 (MIDI 24)
  return bass
}

/** Emit the canonical priority-ordered hits for a shape, before density/sync. */
function generateHits(shape: RhythmShape, voicingLen: number, cpb: number, beatsInSpan: number): Hit[] {
  const N = beatsInSpan * cpb
  const half = Math.max(1, Math.floor(cpb / 2))

  switch (shape) {
    case 'sustain':
      return [{ cell: 0, len: N, role: 'chord', priority: 1 }]

    case 'pulse': {
      // 8th-note pulse, downbeats heavier than &-of-beats.
      const out: Hit[] = []
      for (let c = 0; c < N; c += half) {
        const beatPos = c % cpb
        const isDown = beatPos === 0
        const beatNum = Math.floor(c / cpb) % 4
        const isStrong = isDown && (beatNum === 0 || beatNum === 2)
        out.push({
          cell: c,
          len: half,
          role: 'chord',
          priority: isStrong ? 1 : isDown ? 0.75 : 0.5,
        })
      }
      return out
    }

    case 'bass-chord': {
      // Stride / boom-chick: bass on beats 1+3 ALTERNATING root and 5th
      // (boomChickBass=true on the 5th hit), chord stab on 2+4, with
      // optional &-of-2/4 fills. A real stride alternates the bass note,
      // not just the rhythm — root-fifth-root-fifth was the missing piece.
      const out: Hit[] = []
      let bassHitIndex = 0
      for (let b = 0; b < beatsInSpan; b++) {
        const base = b * cpb
        const beatNum = b % 4
        if (beatNum === 0 || beatNum === 2) {
          out.push({
            cell: base,
            len: cpb,
            role: 'bass',
            priority: beatNum === 0 ? 1 : 0.95,
            // Every other bass hit plays the 5th instead of the root.
            arpIndex: bassHitIndex % 2 === 1 ? 1 : 0,
          })
          bassHitIndex++
        } else {
          out.push({ cell: base, len: cpb, role: 'chord', priority: 0.85 })
        }
      }
      // Optional offbeat fills (low priority — only kept when density is high)
      for (let b = 0; b < beatsInSpan; b++) {
        if (b % 2 === 1) out.push({ cell: b * cpb + half, len: half, role: 'chord', priority: 0.35 })
      }
      return out
    }

    case 'arp-up':
    case 'arp-down':
    case 'arp-updown': {
      // ONE arpeggio sweep across the whole span, not one-per-beat. A real
      // broken-chord accompaniment spreads a full chord across the whole
      // chord duration; the previous code re-triggered the arp every beat,
      // producing 4× the notes in a 4-beat span. The note length scales so
      // the chord just fits into the span.
      const out: Hit[] = []
      const seqLen =
        shape === 'arp-updown'
          ? Math.max(2, 2 * (voicingLen - 1))
          : voicingLen
      // At density=1 the engine runs the arp twice across the span (8th-note
      // feel for a 4-beat bar with a 4-note chord); density culling thins it
      // back to a single sweep at lower values via priority=1 for the first
      // sweep, lower for the doubled sweep.
      const baseNoteLen = Math.max(1, Math.floor(N / seqLen))
      // First (canonical) sweep: priority 1 — kept by density.
      for (let i = 0; i < seqLen; i++) {
        const arpIndex =
          shape === 'arp-down'
            ? voicingLen - 1 - (i % voicingLen)
            : shape === 'arp-updown'
              ? arpUpDownIndex(i, voicingLen)
              : i % voicingLen
        const cell = Math.min(N - 1, i * baseNoteLen)
        out.push({
          cell,
          len: baseNoteLen,
          role: 'arp',
          arpIndex,
          priority: 1 - i * 0.01, // nudge so on-beat note wins ties
        })
      }
      // Optional second-pass sweep at half the note length — only kept if
      // density is high enough to want a busier arp.
      const doubleNoteLen = Math.max(1, Math.floor(baseNoteLen / 2))
      if (doubleNoteLen >= 1 && doubleNoteLen < baseNoteLen) {
        for (let i = 0; i < seqLen; i++) {
          const cell = Math.min(N - 1, i * baseNoteLen + doubleNoteLen)
          if (cell >= N) continue
          const arpIndex =
            shape === 'arp-down'
              ? voicingLen - 1 - (i % voicingLen)
              : shape === 'arp-updown'
                ? arpUpDownIndex(i, voicingLen)
                : i % voicingLen
          out.push({
            cell,
            len: doubleNoteLen,
            role: 'arp',
            arpIndex,
            priority: 0.45,
          })
        }
      }
      return out
    }

    case 'alberti': {
      // Classical low-high-mid-high cycle, 4 notes per beat.
      const out: Hit[] = []
      const noteCells = Math.max(1, Math.floor(cpb / 4))
      for (let b = 0; b < beatsInSpan; b++) {
        const base = b * cpb
        for (let k = 0; k < 4; k++) {
          const arpIndex = albertiIndex(k, voicingLen)
          out.push({
            cell: base + k * noteCells,
            len: noteCells,
            role: 'arp',
            arpIndex,
            priority: k === 0 ? 1 : k === 2 ? 0.6 : 0.5,
          })
        }
      }
      return out
    }

    case 'charleston': {
      // Universal pop/jazz cell: beat 1 (long) + & of 2 + beat 4 over 4 beats.
      const out: Hit[] = []
      const phraseLen = 4 * cpb
      for (let p = 0; p < N; p += phraseLen) {
        out.push({ cell: p, len: cpb + half, role: 'chord', priority: 1 })
        out.push({ cell: p + cpb + half, len: cpb, role: 'chord', priority: 0.85 })
        out.push({ cell: p + 3 * cpb, len: cpb, role: 'chord', priority: 0.7 })
        // Bass on 1 of each phrase (lower priority — emerges with density)
        out.push({ cell: p, len: cpb, role: 'bass', priority: 0.6 })
      }
      return out
    }

    case 'syncopated': {
      // Dotted-quarter pulse: 1, &-of-2, 4 with elongated durations.
      const out: Hit[] = []
      const phraseLen = 4 * cpb
      for (let p = 0; p < N; p += phraseLen) {
        out.push({ cell: p, len: cpb + half, role: 'chord', priority: 1 })
        out.push({ cell: p + cpb + half, len: cpb + half, role: 'chord', priority: 0.85 })
        out.push({ cell: p + 3 * cpb, len: cpb, role: 'chord', priority: 0.7 })
        out.push({ cell: p, len: cpb, role: 'bass', priority: 0.55 })
      }
      return out
    }

    case 'clave': {
      // 3-2 son clave alternating per 4-beat phrase: 1, &-of-2, 4 | 2, 3
      const out: Hit[] = []
      const phraseLen = 4 * cpb
      let phraseIndex = 0
      for (let p = 0; p < N; p += phraseLen) {
        if (phraseIndex % 2 === 0) {
          // 3-side
          out.push({ cell: p, len: cpb + half, role: 'chord', priority: 1 })
          out.push({ cell: p + cpb + half, len: cpb + half, role: 'chord', priority: 0.9 })
          out.push({ cell: p + 3 * cpb, len: cpb, role: 'chord', priority: 0.85 })
        } else {
          // 2-side
          out.push({ cell: p + cpb, len: cpb, role: 'chord', priority: 0.95 })
          out.push({ cell: p + 2 * cpb, len: cpb, role: 'chord', priority: 0.9 })
        }
        out.push({ cell: p, len: cpb, role: 'bass', priority: 0.7 })
        phraseIndex++
      }
      return out
    }
  }
}

/** Up-down arpeggio index: 0 1 2 ... len-1 ... 1 (period 2*(len-1)) */
function arpUpDownIndex(i: number, len: number): number {
  if (len < 2) return 0
  const period = 2 * (len - 1)
  const p = i % period
  return p < len ? p : period - p
}

/** Alberti pattern: low-high-mid-high → indices into a low-to-high voicing. */
function albertiIndex(k: number, len: number): number {
  if (len <= 1) return 0
  if (k === 0) return 0 // low
  if (k === 2) return Math.floor((len - 1) / 2) // mid
  return len - 1 // high (k=1, k=3)
}

/**
 * density → top-K of priority-sorted hits, NORMALIZED to a target
 * events-per-bar curve (not a flat fraction of N). The previous linear
 * `k = round(density * N)` made the same slider position feel very
 * different across shapes (sustain N=1 vs pulse N=8), and the slider
 * stepped by 1/N which felt bumpy. The new curve is quadratic and
 * shape-agnostic at the low/high ends:
 *
 *   density = 0   → exactly 1 hit (the highest-priority one)
 *   density = 1   → all canonical hits
 *   in between    → ~1 + (maxPerBar - 1) * density² per bar
 *
 * So density = 0.5 lands near "a couple of events per bar" regardless of
 * which shape the user picked.
 */
function applyDensity(hits: Hit[], density: number, beatsInSpan: number): Hit[] {
  if (!hits.length) return hits
  if (density >= 1) return [...hits].sort((a, b) => a.cell - b.cell)
  const sorted = [...hits].sort((a, b) => b.priority - a.priority)
  if (density <= 0) return sorted.slice(0, 1)
  const bars = Math.max(1, beatsInSpan / 4)
  const maxPerBar = hits.length / bars
  const targetPerBar = 1 + (maxPerBar - 1) * density * density
  const k = Math.max(1, Math.min(hits.length, Math.round(targetPerBar * bars)))
  return sorted.slice(0, k).sort((a, b) => a.cell - b.cell)
}

/**
 * For each strong-beat hit, with probability `syncopation`, push it onto
 * the &-of-the-beat (cell + cpb/2). Deterministic via a cheap hash so the
 * same beat at the same span position always produces the same output.
 */
function applySyncopation(hits: Hit[], syncopation: number, cpb: number, seedBase: number): Hit[] {
  if (syncopation <= 0) return hits
  const half = Math.max(1, Math.floor(cpb / 2))
  return hits.map((h) => {
    if (h.cell === 0) return h // never displace bar 1 beat 1
    const onBeat = h.cell % cpb === 0
    if (!onBeat) return h
    const r = pseudoRandom(h.cell + seedBase)
    return r < syncopation ? { ...h, cell: h.cell + half } : h
  })
}

/** Stable pseudo-random in [0,1) — deterministic per (cell, span) so undo,
 *  scrubbing, and re-renders all see the same offsets. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12345.6789) * 100000
  return x - Math.floor(x)
}

/**
 * Pick which voicing-notes sound on a single chord-stab event.
 *
 * Pro-keyboardist priority:
 *   1. top voice (the listener's melodic line)
 *   2. 3rd and 7th — the load-bearing guide tones
 *   3. 9 / 11 / 13 extensions — colour above the guide tones
 *   4. b5 / #5 — alterations
 *   5. root — already implied by bass register
 *   6. perfect 5th — the first thing a pro drops
 */
function rankVoices(voicing: number[], rootPc: number): number[] {
  if (voicing.length <= 2) return [...voicing]
  const top = voicing[voicing.length - 1]
  const others = voicing.slice(0, -1)
  const scored = others.map((n) => {
    const interval = (((n - rootPc) % 12) + 12) % 12
    let priority: number
    if (interval === 3 || interval === 4) priority = 9 // 3rd
    else if (interval === 10 || interval === 11) priority = 8 // 7th
    else if (interval === 2 || interval === 5 || interval === 9) priority = 6 // 9 / 11 / 13
    else if (interval === 1 || interval === 6 || interval === 8) priority = 5 // alt extensions
    else if (interval === 0) priority = 4 // root
    else priority = 3 // perfect 5th — first to drop
    return { note: n, priority }
  })
  scored.sort((a, b) => b.priority - a.priority || a.note - b.note)
  return [top, ...scored.map((s) => s.note)]
}

function pickVoices(voicing: number[], rootPc: number, voicesKnob: number): number[] {
  if (voicesKnob <= 0) return []
  if (voicing.length <= 1) return [...voicing]
  const ranked = rankVoices(voicing, rootPc)
  // K scales 1 → voicing.length so voices=0+ε emits at least the top voice.
  const K = Math.max(1, Math.round(voicesKnob * voicing.length))
  return ranked.slice(0, K).sort((a, b) => a - b)
}

function notesForEvent(
  hit: Hit,
  voicing: number[],
  rootPc: number,
  voicesKnob: number,
  bassPitch: number,
): number[] {
  if (voicesKnob <= 0) return []
  if (hit.role === 'bass') {
    // arpIndex 0 = root, 1 = perfect 5th in the bass register. The stride
    // shape alternates between them so a C bass becomes C-G-C-G instead of
    // a static "C-C-C-C". For non-stride shapes arpIndex is undefined and
    // we just play the root.
    if (hit.arpIndex === 1) return [bassPitch + 7]
    return [bassPitch]
  }
  if (hit.role === 'arp') {
    const idx = ((hit.arpIndex ?? 0) % voicing.length + voicing.length) % voicing.length
    return [voicing[idx]]
  }
  return pickVoices(voicing, rootPc, voicesKnob)
}

function velocityForRole(role: Role, voicesKnob: number): number {
  // Bass: louder accents. Chord stabs: medium. Arp: dynamic with voices knob.
  switch (role) {
    case 'bass':  return 100
    case 'arp':   return 75 + Math.round(voicesKnob * 15)
    case 'chord': return 90
  }
}

/* ────────────────────────────────────────────────────────────────────────
 *  piano-roll editing helpers (unchanged)
 *  ──────────────────────────────────────────────────────────────────── */

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
