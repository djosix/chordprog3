import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import * as Tone from 'tone'
import { useScoreStore } from './score'
import { cellSeconds, cellsPerBar, cellsPerBeat } from '@/utils/cells'
import { parseChord } from '@/utils/music'
import type { OutputConfig, PlayheadPosition } from '@/types'

interface MidiOutputInfo {
  id: string
  name: string
}

const OUTPUT_KEY = 'chordprog3:output:v1'
const LOOP_KEY = 'chordprog3:loop:v1'

const DEFAULT_OUTPUT: OutputConfig = {
  mode: 'sample',
  midiOutputId: null,
  volume: 0.8,
}

function loadOutput(): OutputConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_OUTPUT }
  try {
    const raw = localStorage.getItem(OUTPUT_KEY)
    if (!raw) return { ...DEFAULT_OUTPUT }
    const parsed = JSON.parse(raw)
    return {
      mode: parsed.mode === 'midi' ? 'midi' : 'sample',
      midiOutputId: typeof parsed.midiOutputId === 'string' ? parsed.midiOutputId : null,
      volume:
        typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_OUTPUT.volume,
    }
  } catch {
    return { ...DEFAULT_OUTPUT }
  }
}

function loadLoop(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(LOOP_KEY) === 'true'
  } catch {
    return false
  }
}

export const usePlaybackStore = defineStore('playback', () => {
  const score = useScoreStore()

  const isPlaying = ref(false)
  const playhead = reactive<PlayheadPosition>({ rowIndex: 0, barIndex: 0, beatIndex: 0 })
  const loop = ref(loadLoop())

  const output = reactive<OutputConfig>(loadOutput())

  watch(
    () => ({ ...output }),
    (v) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(OUTPUT_KEY, JSON.stringify(v))
      }
    },
    { deep: true },
  )
  // Rebuild flags shared between BPM-change and loop-toggle watchers.
  // Declared up front because the loop watcher fires (lazily, on user
  // toggle) and references them via closure — keeping declarations near
  // the watchers keeps the TS-strict ordering happy.
  let bpmRebuildTimer: number | null = null
  let loopRebuildTimer: number | null = null
  let rebuilding = false
  watch(loop, (v) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOOP_KEY, v ? 'true' : 'false')
    }
    // Live loop toggle while playing — schedule was baked with the old loop
    // setting (transport.schedule vs scheduleOnce + transport.loop flag), so
    // rebuild it. Debounced so rapid o-presses don't thrash.
    if (!isPlaying.value || rebuilding) return
    if (loopRebuildTimer !== null) window.clearTimeout(loopRebuildTimer)
    loopRebuildTimer = window.setTimeout(async () => {
      loopRebuildTimer = null
      if (!isPlaying.value || rebuilding) return
      rebuilding = true
      try {
        const t = Tone.getTransport()
        t.stop()
        t.cancel()
        t.position = 0
        stopPlayheadRaf()
        stopClockRepoll()
        panic()
        isPlaying.value = false
        await play()
      } finally {
        rebuilding = false
      }
    }, 50)
  })

  const midiOutputs = ref<MidiOutputInfo[]>([])
  let midiAccess: MIDIAccess | null = null
  let sampler: Tone.Sampler | null = null
  let samplerReady = false
  let samplerLoading = false
  const samplerLoadingState = ref(false)

  async function ensureMidi() {
    if (midiAccess) return midiAccess
    if (!navigator.requestMIDIAccess) {
      console.warn('WebMIDI not supported in this browser')
      return null
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false })
      const refresh = () => {
        midiOutputs.value = []
        if (!midiAccess) return
        midiAccess.outputs.forEach((o) => {
          midiOutputs.value.push({ id: o.id, name: o.name || o.id })
        })
        // only auto-pick if no saved id, or saved id is no longer present
        const have = midiOutputs.value.some((o) => o.id === output.midiOutputId)
        if (!have && midiOutputs.value[0]) {
          output.midiOutputId = midiOutputs.value[0].id
        }
      }
      refresh()
      midiAccess.addEventListener('statechange', refresh)
      return midiAccess
    } catch (e) {
      console.warn('MIDI access denied', e)
      return null
    }
  }

  async function ensureSampler(): Promise<Tone.Sampler> {
    if (sampler && samplerReady) return sampler
    if (sampler && samplerLoading) {
      await Tone.loaded()
      return sampler
    }
    samplerLoading = true
    samplerLoadingState.value = true
    sampler = new Tone.Sampler({
      urls: {
        A1: 'A1.mp3',
        A2: 'A2.mp3',
        A3: 'A3.mp3',
        A4: 'A4.mp3',
        A5: 'A5.mp3',
        A6: 'A6.mp3',
        C2: 'C2.mp3',
        C3: 'C3.mp3',
        C4: 'C4.mp3',
        C5: 'C5.mp3',
        C6: 'C6.mp3',
        C7: 'C7.mp3',
        'D#2': 'Ds2.mp3',
        'D#3': 'Ds3.mp3',
        'D#4': 'Ds4.mp3',
        'D#5': 'Ds5.mp3',
        'F#2': 'Fs2.mp3',
        'F#3': 'Fs3.mp3',
        'F#4': 'Fs4.mp3',
        'F#5': 'Fs5.mp3',
      },
      release: 1,
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
    }).toDestination()
    sampler.volume.value = Tone.gainToDb(output.volume)
    await Tone.loaded()
    samplerReady = true
    samplerLoading = false
    samplerLoadingState.value = false
    return sampler
  }

  watch(
    () => output.volume,
    (v) => {
      if (sampler) sampler.volume.value = Tone.gainToDb(v)
    },
  )

  // Live BPM change while playing — rebuild the (tempo-baked) schedule.
  watch(
    () => score.score.bpm,
    () => {
      if (!isPlaying.value || rebuilding) return
      if (bpmRebuildTimer !== null) window.clearTimeout(bpmRebuildTimer)
      bpmRebuildTimer = window.setTimeout(async () => {
        bpmRebuildTimer = null
        if (!isPlaying.value || rebuilding) return
        rebuilding = true
        try {
          const t = Tone.getTransport()
          t.stop()
          t.cancel()
          t.position = 0
          stopPlayheadRaf()
          stopClockRepoll()
          panic()
          isPlaying.value = false
          await play()
        } finally {
          rebuilding = false
        }
      }, 80)
    },
  )

  function midiOut() {
    if (!midiAccess) return null
    if (!output.midiOutputId) return null
    return midiAccess.outputs.get(output.midiOutputId) || null
  }

  function panic() {
    if (output.mode === 'midi') {
      const o = midiOut()
      if (o) {
        // clear() flushes the OS-side MIDI queue so previously-scheduled
        // future events (note-offs we haven't sent yet) don't keep arriving
        // after stop/pause.
        try { (o as unknown as { clear?: () => void }).clear?.() } catch { /* not supported */ }
        for (let n = 0; n < 128; n++) o.send([0x80, n, 0])
        o.send([0xb0, 123, 0])
      }
    }
    if (sampler && samplerReady) {
      sampler.releaseAll()
    }
  }

  async function prepareOutput() {
    if (output.mode === 'midi') {
      const access = await ensureMidi()
      // No WebMIDI / no devices → fall back to sample output so the user gets
      // SOMETHING audible instead of silently dropping notes.
      if (!access || !access.outputs.size) {
        output.mode = 'sample'
        await Tone.start()
        await ensureSampler()
      }
    } else {
      await Tone.start()
      await ensureSampler()
    }
  }

  /**
   * Audio-context-time → performance-time offset in ms.
   * AudioContext.currentTime and performance.now() are different clocks on
   * different threads and DRIFT (HW clock vs CPU clock + quantum sampling
   * error). Sample the canonical mapping via getOutputTimestamp() and re-poll
   * during playback so MIDI scheduling stays in sync.
   */
  let audioToPerfOffsetMs = 0
  function refreshClockOffset() {
    const ctx: any = Tone.getContext().rawContext
    if (ctx && typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp()
      if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number') {
        audioToPerfOffsetMs = ts.performanceTime - ts.contextTime * 1000
        return
      }
    }
    audioToPerfOffsetMs = performance.now() - Tone.now() * 1000
  }
  let clockRepoll: number | null = null
  function startClockRepoll() {
    stopClockRepoll()
    clockRepoll = window.setInterval(refreshClockOffset, 250)
  }
  function stopClockRepoll() {
    if (clockRepoll !== null) {
      window.clearInterval(clockRepoll)
      clockRepoll = null
    }
  }

  /** Convert audio context time (sec) → DOMHighResTimeStamp (ms) for WebMIDI scheduling. */
  function audioToPerf(atSec: number): number {
    return atSec * 1000 + audioToPerfOffsetMs
  }

  /**
   * MIDI numbers 0..127 → Hz, cached so we don't allocate inside the
   * scheduler hot path (sub-frame allocations cause audible jitter).
   */
  const FREQ_BY_MIDI: number[] = (() => {
    const arr = new Array<number>(128)
    for (let m = 0; m < 128; m++) arr[m] = 440 * Math.pow(2, (m - 69) / 12)
    return arr
  })()

  function triggerNote(midi: number, durSec: number, atSec: number, velocity = 100) {
    if (output.mode === 'midi') {
      const o = midiOut()
      if (!o) return
      // WebMIDI's send(timestamp) is dispatched on the high-priority MIDI
      // scheduler — this is much steadier than setTimeout. Always schedule
      // ≥10ms in the future so it's not interpreted as "now".
      const minTime = performance.now() + 10
      const onAt = Math.max(minTime, audioToPerf(atSec))
      const offAt = Math.max(minTime + 1, audioToPerf(atSec + durSec))
      o.send([0x90, midi & 0x7f, velocity & 0x7f], onAt)
      o.send([0x80, midi & 0x7f, 0], offAt)
    } else if (sampler && samplerReady) {
      sampler.triggerAttackRelease(FREQ_BY_MIDI[midi & 0x7f], durSec, atSec)
    }
  }

  /** Sustained note-on for glide / "press a key" interactions.
   *  Generation token: if noteOff(pitch) is called BEFORE the awaited prepare
   *  resolves, the attack is skipped — prevents hung notes when the user
   *  taps and releases faster than the audio context can warm up. */
  const noteGen = new Map<number, number>()
  async function noteOn(pitch: number, velocity = 100) {
    const p = pitch & 0x7f
    const gen = (noteGen.get(p) ?? 0) + 1
    noteGen.set(p, gen)
    await prepareOutput()
    if (noteGen.get(p) !== gen) return // a noteOff happened during the await
    if (output.mode === 'midi') {
      const o = midiOut()
      if (o) o.send([0x90, p, velocity & 0x7f])
    } else if (sampler && samplerReady) {
      sampler.triggerAttack(FREQ_BY_MIDI[p], Tone.now())
    }
  }
  function noteOff(pitch: number) {
    const p = pitch & 0x7f
    // bump the generation so any in-flight noteOn(p) returns early
    noteGen.set(p, (noteGen.get(p) ?? 0) + 1)
    if (output.mode === 'midi') {
      const o = midiOut()
      if (o) o.send([0x80, p, 0])
    } else if (sampler && samplerReady) {
      sampler.triggerRelease(FREQ_BY_MIDI[p], Tone.now())
    }
  }

  /** Preview a single note (or set of notes) immediately. */
  async function previewNotes(notes: number[], durBeats = 1) {
    await prepareOutput()
    refreshClockOffset()
    const sec = (60 / score.score.bpm) * durBeats
    // 50ms lead — gives MIDI sends a comfortable >40ms headroom against the
    // 10ms minTime clamp in triggerNote, even with mild clock drift.
    const at = Tone.now() + 0.05
    for (const n of notes) triggerNote(n, sec, at)
  }

  /**
   * Listen to the chord at the playhead as a clean block voicing centered
   * around middle C. Ignores the beat's own style/voicing/range. Walks back
   * across bars/rows until it finds a chord-bearing beat — i.e. plays the
   * chord that's currently sustaining at that point in the score.
   */
  async function listenChord() {
    let chord = ''
    let ri = playhead.rowIndex
    let bi = playhead.barIndex
    let bei = playhead.beatIndex
    let scanned = 0
    const MAX_BARS_BACK = 64
    outer: while (ri >= 0) {
      const row = score.score.rows[ri]
      if (!row) break
      while (bi >= 0) {
        const bar = row.bars[bi]
        if (!bar) break
        const start = bei < 0 ? bar.beats.length - 1 : Math.min(bei, bar.beats.length - 1)
        for (let i = start; i >= 0; i--) {
          const c = bar.beats[i]?.chord?.trim()
          if (c) {
            chord = c
            break outer
          }
        }
        bi -= 1
        bei = -1 // for prior bars, start from the last beat
        if (++scanned >= MAX_BARS_BACK) break outer
      }
      ri -= 1
      const prevRow = score.score.rows[ri]
      bi = prevRow ? prevRow.bars.length - 1 : -1
      bei = -1
    }
    if (!chord) return
    const parsed = parseChord(chord)
    if (!parsed.ok) return
    await previewNotes(parsed.midiNotes, 2)
  }

  async function previewBar(rowIndex: number, barIndex: number) {
    await prepareOutput()
    const bar = score.score.rows[rowIndex]?.bars[barIndex]
    if (!bar) return
    const ts = score.score.timeSignature
    const cs = cellSeconds(ts, score.score.bpm)
    const t0 = Tone.now() + 0.05
    for (const n of bar.notes) {
      triggerNote(n.pitch, n.duration * cs, t0 + n.startCell * cs, n.velocity ?? 100)
    }
  }

  /* ---- transport playback ---- */

  /**
   * For the rAF playhead-update loop. We map current transport.seconds back to
   * (row, bar, beat) using the same flat schedule we built when starting play.
   */
  interface BeatTick {
    tSec: number
    row: number
    bar: number
    beat: number
  }
  let scheduleBeats: BeatTick[] = []
  let rafId: number | null = null

  function startPlayheadRaf() {
    stopPlayheadRaf()
    const transport = Tone.getTransport()
    let lastIdx = -1
    const tick = () => {
      if (!isPlaying.value) {
        rafId = null
        return
      }
      const t = transport.seconds
      // find the latest tick whose tSec <= t
      let lo = 0
      let hi = scheduleBeats.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (scheduleBeats[mid].tSec <= t) {
          idx = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      if (idx >= 0 && idx !== lastIdx) {
        const b = scheduleBeats[idx]
        // Object.assign batches reactivity into a single flush.
        Object.assign(playhead, { rowIndex: b.row, barIndex: b.bar, beatIndex: b.beat })
        lastIdx = idx
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }
  function stopPlayheadRaf() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  /** synchronous lock to prevent double-play() during the prepareOutput await */
  let starting = false

  async function play() {
    if (isPlaying.value || starting) return
    starting = true
    try {
      await prepareOutput()
    } finally {
      // unlocked after schedule is built; isPlaying covers further reentry
    }

    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel()
    transport.position = 0
    transport.bpm.value = score.score.bpm

    refreshClockOffset()
    startClockRepoll()

    const ts = score.score.timeSignature
    const cs = cellSeconds(ts, score.score.bpm)
    const cpb = cellsPerBeat(ts)
    const cellsBar = cellsPerBar(ts)

    type Hit = {
      tSec: number
      durSec: number
      pitch: number
      vel: number
    }
    const hits: Hit[] = []
    const beatTicks: BeatTick[] = []

    // Selection always defines the play range when present — pressing space
    // with bars selected plays just those bars (DAW convention). Loop just
    // controls whether it repeats afterwards.
    const selR = score.selectionRange()
    const startRow = selR ? selR.startRow : playhead.rowIndex
    const startBar = selR ? selR.startBar : playhead.barIndex
    const startBeat = selR ? 0 : playhead.beatIndex
    const startCell = startBeat * cpb
    const endRow = selR ? selR.endRow : score.score.rows.length - 1
    const endBarIdxIncl = selR
      ? selR.endBar
      : (score.score.rows[endRow]?.bars.length ?? 1) - 1

    if (selR) {
      // jump playhead onto the selection start so the rAF strip visibly
      // reflects where we're starting from
      playhead.rowIndex = startRow
      playhead.barIndex = startBar
      playhead.beatIndex = 0
    }

    let tCursor = 0
    for (let ri = startRow; ri <= endRow; ri++) {
      const row = score.score.rows[ri]
      if (!row) break
      const bStart = ri === startRow ? startBar : 0
      const bLast = ri === endRow ? Math.min(endBarIdxIncl, row.bars.length - 1) : row.bars.length - 1
      for (let bi = bStart; bi <= bLast; bi++) {
        const bar = row.bars[bi]
        const cellOffset = ri === startRow && bi === startBar ? startCell : 0
        const beatsThisBar = bar.beats.length
        for (let beat = 0; beat < beatsThisBar; beat++) {
          const cellAt = beat * cpb
          if (cellAt < cellOffset) continue
          beatTicks.push({ tSec: tCursor + (cellAt - cellOffset) * cs, row: ri, bar: bi, beat })
        }
        for (const n of bar.notes) {
          if (n.startCell + n.duration <= cellOffset) continue
          const startInBar = Math.max(n.startCell, cellOffset)
          const trimStart = startInBar - n.startCell
          const playDur = n.duration - trimStart
          if (playDur <= 0) continue
          hits.push({
            tSec: tCursor + (startInBar - cellOffset) * cs,
            durSec: playDur * cs,
            pitch: n.pitch,
            vel: n.velocity ?? 100,
          })
        }
        tCursor += (cellsBar - cellOffset) * cs
      }
    }
    const totalDur = tCursor

    // Stable order, ascending tSec — supports binary search in the rAF loop.
    beatTicks.sort((a, b) => a.tSec - b.tSec)
    scheduleBeats = beatTicks

    // Native Tone loop wraps transport.seconds back to 0 at loopEnd so the
    // rAF playhead binary search and transport.schedule callbacks re-fire
    // seamlessly — no stop()/play() pause between iterations.
    //
    // Guard totalDur > 0: setting loopEnd=0 makes Tone's _processTick check
    // `ticks >= loopEnd` true at every tick, pinning the transport at tick 0.
    const safeLoop = !!loop.value && totalDur > 0
    transport.loop = safeLoop
    if (safeLoop) {
      transport.loopStart = 0
      transport.loopEnd = totalDur
    }

    // Note hits — different scheduling primitives for different outputs:
    //
    // SAMPLE: transport.schedule re-fires per loop iteration when
    // transport.loop is on; with loop off, scheduleOnce is sufficient.
    // Inside the callback we call sampler.triggerAttackRelease(freq, dur,
    // time) where `time` is the precise audio time. Web Audio handles
    // sample-accurate scheduling on the audio thread, immune to JS jitter.
    //
    // MIDI: dispatch the first iteration upfront via WebMIDI's
    // `output.send(data, ts)` so the OS-level MIDI scheduler (CoreMIDI /
    // WinMM / ALSA) takes over — not affected by JS main-thread jitter. For
    // looping, scheduleRepeat with startTime=0 fires at each iteration
    // boundary (initial fire + Tone re-runs scheduleRepeat on every
    // 'loopStart' event); inside the cb we send the NEXT iteration with a
    // full totalDur of advance, so the OS gets timestamps well ahead.
    if (output.mode === 'midi') {
      const o = midiOut()
      if (o) {
        try { (o as unknown as { clear?: () => void }).clear?.() } catch { /* not supported */ }
        // Anchor MIDI iter 1 to Tone's transport-start audio time, not
        // performance.now() + arbitrary lead. transport.start() actually fires
        // at audio time Tone.now() + lookAhead; aligning MIDI to the same
        // anchor keeps audio + MIDI phase-locked from beat 1.
        refreshClockOffset()
        const ctx = Tone.getContext() as unknown as { lookAhead?: number }
        const lookAheadSec = typeof ctx.lookAhead === 'number' ? ctx.lookAhead : 0.1
        const startAudio = Tone.now() + lookAheadSec + 0.05
        const startPerf = audioToPerf(startAudio)
        const sendIteration = (startMs: number) => {
          for (const h of hits) {
            const onAt = startMs + h.tSec * 1000
            const offAt = onAt + h.durSec * 1000
            o.send([0x90, h.pitch & 0x7f, h.vel & 0x7f], onAt)
            o.send([0x80, h.pitch & 0x7f, 0], offAt)
          }
        }
        sendIteration(startPerf)
        if (safeLoop) {
          // scheduleRepeat(cb, totalDur, 0) fires at transport.seconds=0
          // (initial start + every loop-wrap restart). Inside, schedule the
          // iteration that comes AFTER this one — totalDur of advance.
          transport.scheduleRepeat((audioTime) => {
            refreshClockOffset()
            sendIteration(audioToPerf(audioTime + totalDur))
          }, totalDur, 0)
        }
      }
    } else {
      const sched = safeLoop
        ? transport.schedule.bind(transport)
        : transport.scheduleOnce.bind(transport)
      for (const h of hits) {
        sched((time) => {
          if (sampler && samplerReady) {
            sampler.triggerAttackRelease(FREQ_BY_MIDI[h.pitch & 0x7f], h.durSec, time)
          }
        }, h.tSec)
      }
    }

    if (!safeLoop) {
      transport.scheduleOnce(() => {
        stop()
      }, Math.max(totalDur + 0.1, 0.2))
    }

    transport.start()
    isPlaying.value = true
    starting = false
    startPlayheadRaf()
  }

  function stop() {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel()
    transport.position = 0
    isPlaying.value = false
    stopPlayheadRaf()
    stopClockRepoll()
    panic()
  }

  function pause() {
    Tone.getTransport().pause()
    isPlaying.value = false
    stopPlayheadRaf()
    stopClockRepoll()
    panic()
  }

  function rewind() {
    playhead.rowIndex = 0
    playhead.barIndex = 0
    playhead.beatIndex = 0
  }

  function setPlayhead(rowIndex: number, barIndex: number, beatIndex = 0) {
    const r = score.score.rows[rowIndex]
    if (!r) return
    const bar = r.bars[barIndex]
    if (!bar) return
    playhead.rowIndex = rowIndex
    playhead.barIndex = barIndex
    playhead.beatIndex = Math.max(0, Math.min(bar.beats.length - 1, beatIndex))
  }

  /* ---- navigation ---- */

  /** ±1 beat globally — wraps across bars and rows. */
  function stepBeat(delta: number) {
    if (!delta) return
    const dir = delta > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(delta); i++) {
      const r = score.score.rows[playhead.rowIndex]
      if (!r) return
      const bar = r.bars[playhead.barIndex]
      if (!bar) return
      const newBeat = playhead.beatIndex + dir
      if (newBeat >= 0 && newBeat < bar.beats.length) {
        playhead.beatIndex = newBeat
      } else if (dir > 0) {
        // next bar / next row
        if (playhead.barIndex + 1 < r.bars.length) {
          playhead.barIndex += 1
          playhead.beatIndex = 0
        } else if (playhead.rowIndex + 1 < score.score.rows.length) {
          playhead.rowIndex += 1
          playhead.barIndex = 0
          playhead.beatIndex = 0
        }
        // else stay
      } else {
        // prev bar / prev row
        if (playhead.barIndex > 0) {
          playhead.barIndex -= 1
          const prev = r.bars[playhead.barIndex]
          playhead.beatIndex = prev.beats.length - 1
        } else if (playhead.rowIndex > 0) {
          playhead.rowIndex -= 1
          const prevR = score.score.rows[playhead.rowIndex]
          playhead.barIndex = prevR.bars.length - 1
          const prevBar = prevR.bars[playhead.barIndex]
          playhead.beatIndex = prevBar.beats.length - 1
        }
      }
    }
  }

  /**
   * Up/Down: ±1 beat within the current bar; if at the edge, jump to the
   * adjacent row's same bar-index, last/first beat.
   */
  function stepBeatVertical(delta: number) {
    if (!delta) return
    const r = score.score.rows[playhead.rowIndex]
    if (!r) return
    const bar = r.bars[playhead.barIndex]
    if (!bar) return
    const newBeat = playhead.beatIndex + (delta > 0 ? 1 : -1)
    if (newBeat >= 0 && newBeat < bar.beats.length) {
      playhead.beatIndex = newBeat
      return
    }
    if (delta > 0) {
      const newRow = playhead.rowIndex + 1
      const next = score.score.rows[newRow]
      if (!next) return
      const newBarIdx = Math.min(playhead.barIndex, next.bars.length - 1)
      if (newBarIdx < 0) return
      playhead.rowIndex = newRow
      playhead.barIndex = newBarIdx
      playhead.beatIndex = 0
    } else {
      const newRow = playhead.rowIndex - 1
      if (newRow < 0) return
      const prev = score.score.rows[newRow]
      if (!prev) return
      const newBarIdx = Math.min(playhead.barIndex, prev.bars.length - 1)
      if (newBarIdx < 0) return
      const prevBar = prev.bars[newBarIdx]
      if (!prevBar) return
      playhead.rowIndex = newRow
      playhead.barIndex = newBarIdx
      playhead.beatIndex = prevBar.beats.length - 1
    }
  }

  /** Shift+Left/Right: ±1 bar, preserving beat-index (clamped). */
  function stepBar(delta: number) {
    if (!delta) return
    const dir = delta > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(delta); i++) {
      const r = score.score.rows[playhead.rowIndex]
      if (!r) return
      const newBar = playhead.barIndex + dir
      if (newBar >= 0 && newBar < r.bars.length) {
        playhead.barIndex = newBar
      } else if (dir > 0) {
        const nextR = score.score.rows[playhead.rowIndex + 1]
        if (!nextR) return
        playhead.rowIndex += 1
        playhead.barIndex = 0
      } else {
        const prevR = score.score.rows[playhead.rowIndex - 1]
        if (!prevR) return
        playhead.rowIndex -= 1
        playhead.barIndex = prevR.bars.length - 1
      }
      const cur = score.score.rows[playhead.rowIndex]?.bars[playhead.barIndex]
      if (cur && playhead.beatIndex >= cur.beats.length) {
        playhead.beatIndex = cur.beats.length - 1
      }
    }
  }

  /** Shift+Up/Down: ±1 row, preserving bar+beat (clamped). */
  function stepRow(delta: number) {
    if (!delta) return
    const newRow = playhead.rowIndex + (delta > 0 ? 1 : -1)
    if (newRow < 0 || newRow >= score.score.rows.length) return
    const r = score.score.rows[newRow]
    if (!r) return
    const newBarIdx = Math.min(playhead.barIndex, r.bars.length - 1)
    if (newBarIdx < 0) return
    const bar = r.bars[newBarIdx]
    if (!bar) return
    playhead.rowIndex = newRow
    playhead.barIndex = newBarIdx
    playhead.beatIndex = Math.min(playhead.beatIndex, bar.beats.length - 1)
  }

  return {
    isPlaying,
    playhead,
    loop,
    output,
    midiOutputs,
    samplerLoadingState,
    play,
    pause,
    stop,
    rewind,
    stepBeat,
    stepBeatVertical,
    stepBar,
    stepRow,
    setPlayhead,
    previewNotes,
    previewBar,
    listenChord,
    noteOn,
    noteOff,
    ensureMidi,
    panic,
  }
})
