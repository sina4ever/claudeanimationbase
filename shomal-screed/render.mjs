// Renders index.html frame by frame in headless Chromium and encodes with ffmpeg.
//   node render.mjs --sheet=1,4,8,12,15.5,18.5   contact sheet of stills -> out/sheet.jpg
//   node render.mjs                              full video -> out/shomal-screed.mp4 (with out/bed.wav if present)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const CHROME = args.chrome || process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome']
  .find(p => fs.existsSync(p));
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(url);
await page.evaluate(() => window.ready);
const { W, H, FPS, DURATION } = await page.evaluate(() => window.META);
const frame = t => page.evaluate(t => { renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', .95).split(',')[1]; }, t)
  .then(b64 => Buffer.from(b64, 'base64'));

function ffmpeg(argv) {
  const p = spawn('ffmpeg', ['-v', 'error', '-y', ...argv], { stdio: ['pipe', 'inherit', 'inherit'] });
  return { stdin: p.stdin, done: new Promise((ok, no) => p.on('close', c => c ? no(new Error('ffmpeg ' + c)) : ok())) };
}

if (args.sheet) {
  const times = args.sheet.split(',').map(Number);
  const dir = path.join(ROOT, 'out', '.sheet'); fs.mkdirSync(dir, { recursive: true });
  for (const [i, t] of times.entries()) fs.writeFileSync(path.join(dir, `${i}.jpg`), await frame(t));
  const cols = Math.min(times.length, 3), rows = Math.ceil(times.length / cols);
  const f = ffmpeg(['-i', path.join(dir, '%d.jpg'), '-vf', `scale=360:-1,tile=${cols}x${rows}:padding=8:color=white`, '-frames:v', '1', path.join(ROOT, 'out', 'sheet.jpg')]);
  f.stdin.end(); await f.done;
  console.log('wrote out/sheet.jpg');
} else {
  const out = path.join(ROOT, 'out', args.out || 'shomal-screed.mp4');
  const bed = path.join(ROOT, 'out', 'bed.wav');
  const audio = fs.existsSync(bed) ? ['-i', bed, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : [];
  const f = ffmpeg(['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...audio,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  const n = Math.round(DURATION * FPS), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (!f.stdin.write(await frame(i / FPS))) await new Promise(r => f.stdin.once('drain', r));
    if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${n}`);
  }
  f.stdin.end(); await f.done;
  console.log(`\rwrote ${path.relative(ROOT, out)}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close(); server.close();
