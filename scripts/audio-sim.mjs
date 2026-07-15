// Drive the REAL analyser + clock at a simulated 60fps with synthetic
// heavily-compressed jungle (174 BPM): loud pinned bass, kicks, snares, hats.
// Verifies: detection rate, tempo estimate, band movement â€” at full and tiny gain.
import { AudioAnalyser, ParamStore, PARAM_DEFS, Clock } from './audio-sim.bundle.mjs';

const BINS = 1024; // FFT 2048 â†’ 1024 bins @ 44100 â†’ 21.5Hz/bin
const BPM = 174;

function makeSpectrum(time, gainScale) {
  const spec = new Uint8Array(BINS);
  const beat = 60 / BPM;
  const kickPhase = time % beat;
  const kick = Math.exp(-kickPhase * 25); // sharp decay
  const snarePhase = (time + beat) % (beat * 2); // backbeat
  const snare = Math.exp(-snarePhase * 20);
  const hatPhase = time % (beat / 2);
  const hat = Math.exp(-hatPhase * 30);

  for (let i = 0; i < BINS; i++) {
    const hz = i * 21.5;
    let v = 0;
    // Compressed pinned sustained bass + music bed (LOUD, constant).
    if (hz < 150) v += 190;
    else if (hz < 2000) v += 150;
    else if (hz < 10000) v += 110;
    // Transients on top (limited headroom â€” heavy compression).
    if (hz < 120) v += 60 * kick;
    if (hz > 150 && hz < 900) v += 45 * snare;
    if (hz > 4000 && hz < 10000) v += 40 * hat;
    // A little noise.
    v += Math.random() * 8;
    spec[i] = Math.max(0, Math.min(255, v * gainScale));
  }
  return spec;
}

function run(gainScale, seconds) {
  const params = new ParamStore(PARAM_DEFS);
  params.set('audio/useManualBpm', false);
  const clock = new Clock(params);
  const a = new AudioAnalyser(params, clock);
  // Inject fake audio graph (bypass getUserMedia).
  a.ctx = { sampleRate: 44100 };
  a.analyser = {
    getByteFrequencyData(arr) {
      arr.set(makeSpectrum(currentTime, gainScale));
    },
  };

  let currentTime = 0;
  let detections = 0;
  const bandSamples = [];
  const dt = 1 / 60;
  for (let f = 0; f < seconds * 60; f++) {
    currentTime = f * dt;
    clock.update(currentTime);
    const frame = a.update(currentTime, dt);
    if (a.detectedBeat) detections++;
    if (f % 30 === 0) bandSamples.push(frame.bands.high);
  }
  const hi = bandSamples.slice(10); // skip warmup
  const bandMin = Math.min(...hi);
  const bandMax = Math.max(...hi);
  return {
    gainScale,
    detections,
    expectedBeats: Math.round((seconds * BPM) / 60),
    detBpm: Math.round(clock.detectedTempo.bpm),
    detConf: Math.round(clock.detectedTempo.confidence * 100) / 100,
    highBandRange: [Math.round(bandMin * 100) / 100, Math.round(bandMax * 100) / 100],
  };
}

console.log(JSON.stringify({ full: run(1, 30), tiny: run(0.05, 30) }, null, 2));

