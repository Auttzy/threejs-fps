// Synthesised sound, no audio files: every effect is an oscillator or a burst
// of filtered noise through one AudioContext, created on the first user
// gesture. Every call is safe before the context exists.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return false;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!context) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now, Math.random() * 0.2, duration);
    source.stop(now + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(freq, now);
    if (slideTo !== null) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  const SHOTS = {
    p9: { noise: 0.09, freq: 900, gain: 0.5, tone: 190 },
    vk9: { noise: 0.07, freq: 1200, gain: 0.42, tone: 210 },
    ar77: { noise: 0.12, freq: 700, gain: 0.55, tone: 150 },
    lw50: { noise: 0.22, freq: 420, gain: 0.7, tone: 95 },
  };

  return {
    ensure,
    shot(kind) {
      const def = SHOTS[kind] ?? SHOTS.ar77;
      noise(def.noise, def.freq, def.gain);
      tone(def.tone, 0.09, 0.3, 'square', 60);
    },
    enemyShot(distance) {
      const volume = Math.max(0.06, 0.4 - distance * 0.006);
      noise(0.08, 800, volume);
    },
    dry() {
      tone(1200, 0.04, 0.12, 'square');
    },
    reload() {
      tone(500, 0.05, 0.14, 'square');
      setTimeout(() => tone(700, 0.05, 0.14, 'square'), 260);
    },
    hit(head) {
      tone(head ? 1750 : 1250, 0.06, 0.2, 'sine');
    },
    kill() {
      tone(660, 0.07, 0.22, 'sine');
      setTimeout(() => tone(990, 0.1, 0.22, 'sine'), 70);
    },
    hurt() {
      noise(0.15, 300, 0.35);
      tone(110, 0.18, 0.3, 'sawtooth', 55);
    },
    explosion() {
      noise(0.9, 240, 0.9);
      tone(70, 0.8, 0.5, 'sine', 30);
    },
    beep(planted) {
      tone(planted ? 1100 : 880, 0.09, 0.18, 'sine');
    },
    plantDone() {
      tone(880, 0.1, 0.2, 'sine');
      setTimeout(() => tone(1320, 0.14, 0.2, 'sine'), 110);
    },
    roundWin() {
      [523, 659, 784].forEach((freq, i) => setTimeout(() => tone(freq, 0.22, 0.22, 'triangle'), i * 120));
    },
    roundLose() {
      [392, 330, 262].forEach((freq, i) => setTimeout(() => tone(freq, 0.22, 0.2, 'triangle'), i * 130));
    },
    buy() {
      tone(990, 0.05, 0.16, 'sine');
      setTimeout(() => tone(1320, 0.06, 0.16, 'sine'), 60);
    },
    step() {
      noise(0.04, 500, 0.05);
    },
    denied() {
      tone(220, 0.12, 0.18, 'square', 160);
    },
  };
}
