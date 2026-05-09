import type { BeatSettings } from '@/types'

/**
 * Hand-curated genre presets for the dice button. Each preset is a
 * complete BeatSettings tuple (voicing / range / shape / density /
 * syncopation / voices) plus a sample weight — the dice samples by
 * weight, NOT uniform random, so the casual user is much more likely
 * to land on a tasteful "pop ballad" or "jazz comp" than on a niche
 * preset.
 *
 * Adding a preset is data-only: extend this array, no other code change.
 */
export interface AccompanimentPreset extends BeatSettings {
  name: string
  description: string
  weight: number
}

export const PRESETS: AccompanimentPreset[] = [
  {
    name: 'pop ballad',
    description: 'sustained pad, full voicing — slow 4/4 over major/minor triads',
    voicing: 'close',
    rangeCenter: 60,
    rangeSpread: 12,
    shape: 'sustain',
    density: 0.2,
    syncopation: 0.05,
    voices: 1.0,
    weight: 14,
  },
  {
    name: 'jazz comp',
    description: 'rootless guide-tone shells over a charleston cell — swing-friendly',
    voicing: 'rootless',
    rangeCenter: 62,
    rangeSpread: 10,
    shape: 'charleston',
    density: 0.5,
    syncopation: 0.4,
    voices: 0.55,
    weight: 10,
  },
  {
    name: 'stride',
    description: 'left-hand alternating root/fifth + right-hand chord on 2+4',
    voicing: 'open',
    rangeCenter: 54,
    rangeSpread: 18,
    shape: 'bass-chord',
    density: 0.7,
    syncopation: 0.0,
    voices: 0.8,
    weight: 6,
  },
  {
    name: 'bossa',
    description: 'Latin clave-driven comp on a drop-2 voicing',
    voicing: 'drop2',
    rangeCenter: 60,
    rangeSpread: 14,
    shape: 'clave',
    density: 0.55,
    syncopation: 0.5,
    voices: 0.7,
    weight: 9,
  },
  {
    name: 'gospel pad',
    description: 'spread voicing, sustained, full chord — lush bed for sus / add9 / maj9',
    voicing: 'spread',
    rangeCenter: 64,
    rangeSpread: 18,
    shape: 'sustain',
    density: 0.1,
    syncopation: 0.0,
    voices: 1.0,
    weight: 8,
  },
  {
    name: 'alberti classical',
    description: 'low-high-mid-high broken-chord pattern — classical / lullaby',
    voicing: 'close',
    rangeCenter: 60,
    rangeSpread: 12,
    shape: 'alberti',
    density: 0.85,
    syncopation: 0.0,
    voices: 0.4,
    weight: 6,
  },
  {
    name: 'arp pulse',
    description: 'continuous broken chord across the span — ambient / cinematic',
    voicing: 'close',
    rangeCenter: 67,
    rangeSpread: 16,
    shape: 'arp-up',
    density: 0.7,
    syncopation: 0.0,
    voices: 0.45,
    weight: 7,
  },
  {
    name: 'pop pulse',
    description: 'driving 8th-note chord stabs with a touch of syncopation',
    voicing: 'close',
    rangeCenter: 60,
    rangeSpread: 14,
    shape: 'pulse',
    density: 0.7,
    syncopation: 0.1,
    voices: 0.85,
    weight: 6,
  },
  {
    name: 'drop2 ballad',
    description: 'jazz-flavored sustained voicing — smoother than close, less busy than comp',
    voicing: 'drop2',
    rangeCenter: 62,
    rangeSpread: 14,
    shape: 'sustain',
    density: 0.3,
    syncopation: 0.1,
    voices: 0.85,
    weight: 6,
  },
  {
    name: 'shell jazz',
    description: 'minimal 1-3-7 shell over an anticipated rhythm — Bill Evans left hand',
    voicing: 'shell',
    rangeCenter: 56,
    rangeSpread: 12,
    shape: 'syncopated',
    density: 0.55,
    syncopation: 0.45,
    voices: 0.7,
    weight: 5,
  },
  {
    name: 'rock power',
    description: 'root + 5th block voicing on every beat — rock / metal driving feel',
    voicing: 'power',
    rangeCenter: 50,
    rangeSpread: 14,
    shape: 'pulse',
    density: 0.6,
    syncopation: 0.0,
    voices: 1.0,
    weight: 4,
  },
  {
    name: 'wide ambient',
    description: 'one-octave-gap voicing held forever — pad / pad / pad',
    voicing: 'wide',
    rangeCenter: 64,
    rangeSpread: 24,
    shape: 'sustain',
    density: 0.1,
    syncopation: 0.0,
    voices: 1.0,
    weight: 4,
  },
]

/**
 * Soft chord-aware weighting. Multiplies a preset's base weight when the
 * current chord matches a family — e.g. a maj7 nudges the dice toward
 * jazz/bossa, a sus chord toward gospel pad. Returns a multiplier per
 * preset name. Missing entries default to 1.
 */
function chordBias(chord: string | null): Record<string, number> {
  if (!chord) return {}
  const c = chord.toLowerCase()
  if (/maj7|maj9|maj13|△|\bmaj\b/.test(c)) {
    return { 'jazz comp': 1.6, bossa: 1.4, 'drop2 ballad': 1.4, 'shell jazz': 1.3, 'rock power': 0.3 }
  }
  if (/sus|add9|add2/.test(c)) {
    return { 'gospel pad': 2.0, 'arp pulse': 1.5, 'pop ballad': 1.3, stride: 0.4, 'rock power': 0.2 }
  }
  if (/m7|min7|m9/.test(c)) {
    return { 'jazz comp': 1.5, 'arp pulse': 1.3, bossa: 1.2, 'shell jazz': 1.3 }
  }
  if (/m\b|min\b|-/.test(c)) {
    return { stride: 1.2, 'pop pulse': 1.2, 'alberti classical': 1.2, 'rock power': 1.2 }
  }
  if (/dim|°/.test(c)) {
    return { 'jazz comp': 1.4, 'shell jazz': 1.4, 'pop ballad': 0.6 }
  }
  if (/7|9|11|13|alt|b5|#5/.test(c)) {
    return { 'jazz comp': 1.5, 'shell jazz': 1.4, bossa: 1.3 }
  }
  // plain triad
  return { 'pop ballad': 1.2, 'pop pulse': 1.1, 'rock power': 1.1 }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Roll a tasteful preset, optionally biased by the current chord, with
 * small ±10% jitter on the continuous knobs so consecutive rolls feel
 * fresh. NOT uniform random — heavy weighting toward "pop ballad" /
 * "jazz comp" so the casual user almost always lands on something nice.
 */
export function rollDicePreset(chord: string | null = null, rng: () => number = Math.random): BeatSettings {
  const bias = chordBias(chord)
  const weighted = PRESETS.map((p) => p.weight * (bias[p.name] ?? 1))
  const total = weighted.reduce((a, b) => a + b, 0)
  let r = rng() * total
  let pick = PRESETS[0]
  for (let i = 0; i < PRESETS.length; i++) {
    r -= weighted[i]
    if (r <= 0) {
      pick = PRESETS[i]
      break
    }
  }
  // Jitter ±10% on continuous knobs, ±3 semitones on range to add variety
  // without escaping the preset's character.
  const j = (v: number, amt = 0.1) => clamp01(v + (rng() * 2 - 1) * amt)
  const jitterInt = (v: number, amt: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(v + (rng() * 2 - 1) * amt)))
  return {
    voicing: pick.voicing,
    rangeCenter: jitterInt(pick.rangeCenter, 3, 24, 96),
    rangeSpread: jitterInt(pick.rangeSpread, 3, 0, 36),
    shape: pick.shape,
    density: j(pick.density),
    syncopation: j(pick.syncopation),
    voices: j(pick.voices),
  }
}

/** Look up a preset by name. */
export function presetByName(name: string): AccompanimentPreset | undefined {
  return PRESETS.find((p) => p.name === name)
}
