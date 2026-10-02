// An original electronic bed, synthesised in code (nothing to license), cut to the picture:
// pad + riser under the hook, a 120 BPM pulse through the four steps, a riser into the end card,
// one impact on the logo and a held chord to the end.
//   node bed.mjs out/bed.wav
import fs from 'node:fs';

const SR = 44100, DUR = 22, N = SR * DUR, BEAT = .5, BAR = 2;
const L = new Float32Array(N), R = new Float32Array(N);
const PULSE = [3.0, 19.2], HIT = 19.45;
let seed = 7; const noise = () => (seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

// Chords per bar (Am, F, C, G), as [bass, ...pad] in Hz.
const CH = [[110, 220, 261.6, 329.6], [87.3, 174.6, 220, 261.6], [130.8, 196, 261.6, 329.6], [98, 196, 246.9, 293.7]];
const chordAt = t => CH[Math.floor(t / BAR) % 4];

// Pad: detuned saws, low-passed, slow swell; wider in stereo.
{ const ph = new Float64Array(16); let yl = 0, yr = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, c = t >= HIT ? CH[0] : chordAt(t);
    let l = 0, r = 0;
    for (let v = 0; v < 3; v++) for (let d = 0; d < 2; d++) {
      const k = v * 2 + d, f = c[v + 1] * (d ? 1.006 : .994);
      ph[k] = (ph[k] + f / SR) % 1; const s = ph[k] * 2 - 1;
      if (d) r += s; else l += s;
    }
    const cut = t < PULSE[0] ? .02 + .04 * t / 3 : t >= HIT ? .09 : .05;
    yl += cut * (l - yl); yr += cut * (r - yr);
    const env = Math.min(1, t / 1.5) * (t > HIT ? 1.3 : t > 19.2 ? .3 : 1) * Math.min(1, (DUR - t) / 1.2);
    add(i, yl * .05 * env, yr * .05 * env);
  }
}
// Kick on every beat through the steps.
for (let t = PULSE[0]; t < PULSE[1]; t += BEAT) {
  let p = 0; const i0 = Math.round(t * SR);
  for (let j = 0; j < SR * .35; j++) { const u = j / SR, f = 45 + 95 * Math.exp(-u * 28); p += f / SR;
    add(i0 + j, Math.sin(2 * Math.PI * p) * Math.exp(-u * 9) * .55); }
}
// Hats on the off-beats, a little left/right.
for (let t = PULSE[0] + BEAT / 2, n = 0; t < PULSE[1]; t += BEAT, n++) {
  const i0 = Math.round(t * SR); let prev = 0;
  for (let j = 0; j < SR * .06; j++) { const x = noise(), hp = x - prev; prev = x; const e = Math.exp(-j / SR * 70) * .09;
    add(i0 + j, hp * e * (n % 2 ? .7 : 1), hp * e * (n % 2 ? 1 : .7)); }
}
// Bass: low-passed saw on eighths, ducked by the kick.
{ let ph = 0, y = 0;
  for (let i = Math.round(PULSE[0] * SR); i < PULSE[1] * SR; i++) {
    const t = i / SR, f = chordAt(t)[0] / 2, inStep = (t - PULSE[0]) % (BEAT / 2);
    ph = (ph + f / SR) % 1; y += .06 * ((ph * 2 - 1) - y);
    const gate = Math.exp(-inStep * 9), duck = 1 - .7 * Math.exp(-((t - PULSE[0]) % BEAT) * 14);
    add(i, y * .5 * gate * duck);
  }
}
// Risers: filtered noise sweeping up into the first step and into the end card.
for (const [a, b, g] of [[1.6, 3.0, .12], [17.4, 19.4, .2]]) {
  let y = 0;
  for (let i = Math.round(a * SR); i < b * SR; i++) { const k = (i / SR - a) / (b - a); y += (.01 + .25 * k * k) * (noise() - y); add(i, y * g * k, y * g * k * .8); }
}
// Impact on the logo: deep boom + noise burst.
{ const i0 = Math.round(HIT * SR); let p = 0;
  for (let j = 0; j < SR * 1.6; j++) { const u = j / SR, f = 38 + 70 * Math.exp(-u * 10); p += f / SR;
    const s = Math.sin(2 * Math.PI * p) * Math.exp(-u * 2.6) * .8 + noise() * Math.exp(-u * 14) * .25; add(i0 + j, s); } }

// Normalise and write 16-bit stereo WAV.
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = .89 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
fs.writeFileSync(process.argv[2] || 'out/bed.wav', buf);
console.log('bed', DUR, 's');
