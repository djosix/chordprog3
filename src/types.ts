export type AccompanimentStyle =
  | 'block'
  | 'arp-up'
  | 'arp-down'
  | 'arp-up-down'
  | 'alberti'
  | 'sustain'
  | 'rest'
  /** root on beat 1, chord on beats 2-4 (bossa-feel comping) */
  | 'bossa'
  /** root on 1, chord on 2 and 3 (oom-pah-pah for triple meter) */
  | 'waltz'
  /** alternating bass + chord (pop ballad / strum) */
  | 'bass-chord'
  /** chord on the off-beats (reggae upbeat) */
  | 'reggae'

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
  /** accompaniment / arpeggio pattern */
  style: AccompanimentStyle
  /** voicing mode */
  voicing: VoicingMode
  /** center pitch (MIDI) of the voicing range */
  rangeCenter: number
  /** half-width of the voicing range, in semitones */
  rangeSpread: number
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
  style: AccompanimentStyle
  voicing: VoicingMode
  rangeCenter: number
  rangeSpread: number
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
