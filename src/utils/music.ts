import { Chord, Note, Interval, Key, RomanNumeral } from 'tonal'

export interface ParsedChord {
  symbol: string
  ok: boolean
  /** the canonical name, e.g. "Cmaj7" */
  name: string
  /** root letter+accidental, e.g. "C" */
  tonic: string | null
  /** "major", "minor 7th", etc */
  quality: string
  /** stack of MIDI note numbers from low to high, near middle C */
  midiNotes: number[]
  /** abstract pitch classes ["C","E","G","B"] */
  notes: string[]
  /** explicit bass (slash chord) e.g. "B" */
  bass: string | null
}

const MIDDLE_C = 60

/**
 * Parse a chord symbol with tonal. Returns ok=false if the symbol can't be
 * recognised. Builds MIDI notes around middle C.
 */
export function parseChord(symbol: string): ParsedChord {
  const trimmed = symbol.trim()
  if (!trimmed) {
    return {
      symbol: '',
      ok: false,
      name: '',
      tonic: null,
      quality: '',
      midiNotes: [],
      notes: [],
      bass: null,
    }
  }
  const c = Chord.get(trimmed)
  if (c.empty || !c.tonic) {
    return {
      symbol: trimmed,
      ok: false,
      name: trimmed,
      tonic: null,
      quality: '',
      midiNotes: [],
      notes: [],
      bass: null,
    }
  }

  const tonic = c.tonic
  const bass = c.bass || null

  // Build pitch classes -> MIDI notes anchored to the octave that places the
  // root closest to middle C (C4 = 60).
  const rootMidi = pitchClassToMidiNear(tonic, MIDDLE_C)
  let last = rootMidi - 1
  const midi: number[] = []
  for (const n of c.notes) {
    let m = pitchClassToMidiNear(n, last + 1)
    if (m <= last) m += 12
    midi.push(m)
    last = m
  }
  if (bass) {
    const bassMidi = pitchClassToMidiNear(bass, rootMidi - 12)
    if (!midi.includes(bassMidi)) midi.unshift(bassMidi)
  }

  return {
    symbol: trimmed,
    ok: true,
    name: c.symbol || trimmed,
    tonic,
    quality: c.quality || c.type || '',
    midiNotes: midi,
    notes: c.notes,
    bass,
  }
}

/**
 * Find the MIDI number for a pitch-class name (e.g. "C", "F#", "Bb")
 * with the chosen octave so the resulting MIDI is closest to `nearMidi`.
 */
export function pitchClassToMidiNear(pc: string, nearMidi: number): number {
  const semis = pcSemis(pc)
  if (semis < 0) return nearMidi
  // place at octave so |result - nearMidi| minimal
  const baseOct = Math.floor(nearMidi / 12)
  const candidates = [baseOct - 1, baseOct, baseOct + 1].map(
    (o) => o * 12 + semis,
  )
  let best = candidates[0]
  for (const c of candidates) {
    if (Math.abs(c - nearMidi) < Math.abs(best - nearMidi)) best = c
  }
  return best
}

const PC_TO_SEMI: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

function pcSemis(pc: string): number {
  if (!pc) return -1
  const letter = pc[0].toUpperCase()
  let semi = PC_TO_SEMI[letter]
  if (semi === undefined) return -1
  for (let i = 1; i < pc.length; i++) {
    const ch = pc[i]
    if (ch === '#') semi += 1
    else if (ch === 'b') semi -= 1
    else break
  }
  return ((semi % 12) + 12) % 12
}

/** Convert MIDI int to scientific pitch like C4, F#5 */
export function midiToName(m: number): string {
  return Note.fromMidi(m)
}

/**
 * Compute the roman numeral analysis of a chord in a given key
 * (e.g. "C major" + "Am7" -> "vi7"). Returns null when not analysable.
 */
export function romanInKey(chordSymbol: string, key: string | null): string | null {
  if (!key) return null
  const c = Chord.get(chordSymbol)
  if (c.empty || !c.tonic) return null
  const [tonic, mode] = key.split(/\s+/)
  if (!tonic) return null
  try {
    const k = mode === 'minor' ? Key.minorKey(tonic) : Key.majorKey(tonic)
    const ivl = Interval.distance(k.tonic, c.tonic)
    const rn = RomanNumeral.get(RomanNumeral.get(ivl).name)
    if (!rn || !rn.name) return null

    // Decide minor vs other-quality for casing. Treat "Minor" / "Minor Seventh"
    // as minor; "diminished" / "augmented" / "Major" / "Major Seventh" /
    // "Dominant Seventh" / "Suspended" are NOT minor (don't lowercase the
    // numeral letters just because the word "dim" contains an "m").
    const q = (c.quality || '').toLowerCase()
    const isMinor = /^minor/.test(q)

    // Preserve any leading accidental (b / # / bb / ##) on the roman numeral,
    // then case the letter portion only.
    const accidental = (rn.name.match(/^[#b]+/) ?? [''])[0]
    const letters = rn.name.slice(accidental.length)
    const cased = isMinor ? letters.toLowerCase() : letters.toUpperCase()
    const base = accidental + cased

    // Build the tail by stripping the chord's tonic + (only the bare "m" /
    // "min", NOT "maj") so qualifiers like "maj7", "dim", "sus4", "7" survive.
    const tail = chordSymbol
      .replace(/^[A-G][#b]?/, '')
      .replace(/^(m(?!aj)|min)/, '')
    return base + tail
  } catch {
    return null
  }
}

export const KEY_OPTIONS: string[] = (() => {
  const tonics = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
  const out: string[] = []
  for (const t of tonics) out.push(`${t} major`)
  for (const t of tonics) out.push(`${t} minor`)
  return out
})()
