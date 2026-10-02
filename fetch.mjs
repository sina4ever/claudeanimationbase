// fetch.mjs: downloads video, audio or images from YouTube, TikTok, Instagram, SoundCloud and the other platforms cobalt
// supports (https://github.com/imputnet/cobalt), through a cobalt API instance. Use it for reference footage or music.
//
//   node fetch.mjs <url> [--audio | --mute] [--format=mp3|ogg|wav|opus|best] [--quality=1080|720|max|...] [--out=assets]
//     --audio      audio only (e.g. a song for render.mjs --audio=assets/<file>)
//     --mute       video without sound
//     --out        folder to save into (default assets/); posts with several items (carousels, slideshows) save them all
//
// Needs a cobalt instance. Public ones such as api.cobalt.tools use bot protection and don't take requests from scripts,
// so run your own (Docker):
//   docker run -d --name cobalt -p 9000:9000 -e API_URL=http://localhost:9000/ ghcr.io/imputnet/cobalt:11
// Then point at it with --api=<url> or COBALT_API_URL (default http://localhost:9000/), and pass --key=<api key> or
// COBALT_API_KEY if the instance requires one.
// Only download what you have the right to use.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const url = argv.find(a => !a.startsWith('--'));
if (!url) { console.error('usage: node fetch.mjs <url> [--audio | --mute] [--format=mp3] [--quality=1080] [--out=assets]'); process.exit(1); }

const API = args.api || process.env.COBALT_API_URL || 'http://localhost:9000/';
const KEY = args.key || process.env.COBALT_API_KEY;
const OUT = args.out || 'assets';

const body = {
  url,
  downloadMode: args.audio ? 'audio' : args.mute ? 'mute' : 'auto',
  audioFormat: args.format || 'mp3',
  audioBitrate: '320',
  videoQuality: String(args.quality || '1080'),
  filenameStyle: 'pretty',
};

let res;
try {
  res = await fetch(API, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Api-Key ${KEY}` } : {}) },
    body: JSON.stringify(body),
  });
} catch (e) {
  console.error(`can't reach the cobalt API at ${API} (${e.cause?.code || e.message}). Start one with:\n` +
    '  docker run -d --name cobalt -p 9000:9000 -e API_URL=http://localhost:9000/ ghcr.io/imputnet/cobalt:11');
  process.exit(1);
}
const data = await res.json().catch(() => ({ status: 'error', error: { code: `http ${res.status}, not JSON` } }));

// a name that's safe on every OS, keeping cobalt's extension
const safe = name => basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
// cobalt's filename from a tunnel URL's Content-Disposition, else the URL's last path segment
const nameFrom = (r, src, i) => {
  const cd = r.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  if (m) return decodeURIComponent(m[1]);
  const last = new URL(src).pathname.split('/').pop();
  return last && last.includes('.') ? last : `item_${i + 1}`;
};

async function save(src, name, i = 0) {
  const r = await fetch(src);
  if (!r.ok || !r.body) throw new Error(`download failed: HTTP ${r.status} for ${src}`);
  const file = join(OUT, safe(name || nameFrom(r, src, i)));
  mkdirSync(OUT, { recursive: true });
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  console.log('wrote ' + file);
}

switch (data.status) {
  case 'tunnel':
  case 'redirect':
    await save(data.url, data.filename);
    break;
  case 'picker':
    for (const [i, item] of data.picker.entries()) await save(item.url, null, i);
    if (data.audio) await save(data.audio, data.audioFilename);
    break;
  case 'local-processing':
    // only sent when localProcessing is requested, which this script doesn't do
    console.error('the instance asked for local processing, which fetch.mjs does not support');
    process.exit(1);
  case 'error': {
    const { code, context } = data.error || {};
    console.error(`cobalt error: ${code}${context ? ' ' + JSON.stringify(context) : ''}`);
    if (String(code).startsWith('error.api.auth')) console.error('this instance needs an API key: pass --key=<key> or set COBALT_API_KEY');
    process.exit(1);
  }
  default:
    console.error('unexpected response from cobalt: ' + JSON.stringify(data));
    process.exit(1);
}
