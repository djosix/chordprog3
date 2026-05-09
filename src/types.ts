/**
 * Rhythmic *shape* of accompaniment — the "feel" / cell template the
 * generator uses. Density / syncopation / voices knobs operate on top of
 * the shape's canonical hit list (see utils/cells.ts).
 *
 * Replaces the old per-beat `AccompanimentStyle` enum, which conflated
 * rhythm and polyphony into a single dimension and forced single-note
 * arpeggios for the arp variants — meaning a 7-note chord like C13 could
 * never be fully heard.
 */
export type RhythmShape =
  /** one held event over the whole span (block / pad) */
  | 'sustain'
  /** even subdivisions: 8th-note pulse */
  | 'pulse'
  /** root on 1+3, chord on 2+4 + offbeats (stride / pop ballad / waltz) */
  | 'bass-chord'
  | 'arp-up'
  | 'arp-down'
  | 'arp-updown'
  /** classical low-high-mid-high cycle */
  | 'alberti'
  /** the universal pop/jazz cell: 1, &-of-2, 4 */
  | 'charleston'
  /** dotted-quarter pulse: 1, &-2, 4 */
  | 'syncopated'
  /** 3-2 son clave (bossa / latin) */
  | 'clave'

export type VoicingMode =
  | 'close'
  | 'drop2'
  | 'drop3'
  | 'spread'
  | 'rootless'
  | 'shell'
  /** root + perfect fifth + octave (rock power-chord stripped of 3rd / 7th) */
  | 'power'
  /** bass root an octave below, upper chord close-voiced (gospel / pop) */
  | 'open'
  /** each note at least an octave apart (modern wide voicing) */
  | 'wide'
  /** stacked-4ths feel — re-spaces the chord's own notes in ascending fourths */
  | 'quartal'
  /** close voicing with the root doubled an octave higher (extra brightness) */
  | 'octave-doubled'

export interface Beat {
  /** chord symbol like "Cmaj7", "G/B", or "" for none */
  chord: string
  /** voicing mode (which chord-tones / inversion / spacing) */
  voicing: VoicingMode
  /** center pitch (MIDI) of the voicing range */
  rangeCenter: number
  /** half-width of the voicing range, in semitones */
  rangeSpread: number
  /** rhythmic cell — the *shape* of the accompaniment */
  shape: RhythmShape
  /** 0..1: how many of the shape's canonical hits actually fire */
  density: number
  /** 0..1: probability of pushing a strong-beat hit onto its &-of (off-beat) */
  syncopation: number
  /** 0..1: how many voicing-notes fire on each chord stab; 0 = single line, 1 = full stack */
  voices: number
}

/**
 * A single piano-roll note within a bar. Cells are 1/32-notes wide; the bar
 * has `numerator * (32 / denominator)` cells total.
 */
export interface PianoRollNote {
  pitch: number
  startCell: number
  duration: number
  velocity?: number
}

export interface Bar {
  id: string
  /** length is `beatsPerBar` (= time-signature numerator) */
  beats: Beat[]
  /** notes inside this bar, sorted by startCell. Source-of-truth for playback. */
  notes: PianoRollNote[]
  /** optional per-bar key override (e.g. "C major", "A minor"); null = inherit row */
  key: string | null
}

export interface Row {
  id: string
  title: string
  description: string
  /** optional banner / marker text shown above the bars */
  marker: string
  /** key for the entire row, null = inherit from previous */
  key: string | null
  bars: Bar[]
}

export interface TimeSignature {
  numerator: number
  denominator: number
}

/** Editable subset of a Beat used for the y/p settings clipboard. */
export interface BeatSettings {
  voicing: VoicingMode
  rangeCenter: number
  rangeSpread: number
  shape: RhythmShape
  density: number
  syncopation: number
  voices: number
}

export interface Score {
  title: string
  bpm: number
  timeSignature: TimeSignature
  rows: Row[]
  /** piano-roll panel UI state */
  pianoRollOpen: boolean
  /** piano-roll panel pixel height */
  pianoRollHeight: number
}

export interface PlayheadPosition {
  rowIndex: number
  barIndex: number
  beatIndex: number
}

export type OutputMode = 'sample' | 'midi'

export interface OutputConfig {
  mode: OutputMode
  /** for midi: id of the selected MIDIOutput */
  midiOutputId: string | null
  /** master volume 0-1 */
  volume: number
}

export interface SelectionRange {
  startRow: number
  startBar: number
  endRow: number
  endBar: number
}

export interface ClipboardData {
  bars: Bar[]
}
