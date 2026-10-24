// A photo behind the home screen, for themes with effects.backdrop "nature". The pictures are the featured pictures of mountains, lakes,
// forests, waterfalls and coasts on Wikimedia Commons (the ones the Commons community voted among its best, all under free licences).
// The service lists them once a week, downloads the 1920 px version of one at a time into D/backdrop, keeps the next one ready and moves
// on after effects.backdropHours. The launcher shows the photographer and the licence with it, as those licences require. Nothing is
// fetched while the theme does not use it.
// API (loopback only): GET /api/backdrop -> {file, credit} (or {pending: true} until the first picture is in), GET /api/backdrop/img/<file>.
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http');
const nc = require('./netcompat'), { URL } = nc;

const CATEGORIES = ['Featured_pictures_of_mountains', 'Featured_pictures_of_lakes', 'Featured_pictures_of_forests', 'Featured_pictures_of_waterfalls', 'Featured_pictures_of_coasts'];
const LIST_DAYS = 7, RETRY_MS = 10 * 60000, MAX_IMAGE = 6 * 1024 * 1024, MAX_JSON = 2 * 1024 * 1024, RECENT = 40;
const FILE = /^bd-\d{6,16}\.(?:jpg|png)$/;
// the Commons API; a test can point it at a stand-in (plain http is then allowed, for that address only)
const api = () => process.env.CYTV_BACKDROP_URL || 'https://commons.wikimedia.org/w/api.php';
const dir = () => process.env.CYTV_BACKDROP_DIR || '/media/developer/cleanyourtv/backdrop';

function fetchBuf(url, max, ms, hops) {
  return new Promise((resolve, reject) => {
    if ((hops || 0) > 3) return reject(new Error('too many redirects'));
    let u; try { u = new URL(url); } catch (_) { return reject(new Error('bad address')); }
    const test = process.env.CYTV_BACKDROP_URL && u.origin === new URL(process.env.CYTV_BACKDROP_URL).origin;
    // only Wikimedia's own hosts (the API and the picture server), over https
    if (!test && !(u.protocol === 'https:' && /(^|\.)wikimedia\.org$/.test(u.hostname))) return reject(new Error('refusing ' + u.hostname));
    let done = false, req = null;
    const fin = (e, v) => { if (done) return; done = true; clearTimeout(hard); e ? reject(e) : resolve(v); };
    const hard = setTimeout(() => { try { req && req.destroy(); } catch (_) {} fin(new Error('timed out')); }, ms || 20000);
    req = nc.get(u.protocol === 'https:' ? https : http, u, { headers: { 'User-Agent': 'CleanYourTV (https://github.com/lasharor/cleanyourtv-WebOS) home screen backdrop' }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); clearTimeout(hard); done = true; return resolve(fetchBuf(new URL(res.headers.location, u).toString(), max, ms, (hops || 0) + 1)); }
      if (res.statusCode !== 200) { res.resume(); return fin(new Error('Wikimedia answered ' + res.statusCode)); }
      const b = []; let n = 0, ended = false;
      res.on('data', c => { n += c.length; if (n > max) { fin(new Error('the file is too large')); res.destroy(); } else b.push(c); });
      res.on('end', () => { ended = true; fin(null, Buffer.concat(b)); });
      res.on('aborted', () => fin(new Error('the connection was lost'))); res.on('error', fin); res.on('close', () => { if (!ended) fin(new Error('the connection was closed')); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', fin);
  });
}
const getJson = q => fetchBuf(api() + '?' + q + '&format=json&formatversion=2', MAX_JSON).then(b => JSON.parse(b.toString('utf8')));
const kind = b => b.length > 12 && b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.length > 12 && b.slice(1, 4).toString() === 'PNG' ? 'png' : '';
// "Artist" is HTML on Commons (often a link to the user page): plain text, short
function plain(h) {
  return String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}
// the credit line for a picture's imageinfo, or '' when its licence is not given
function credit(info) {
  const m = (info && info.extmetadata) || {}, lic = plain(m.LicenseShortName && m.LicenseShortName.value), who = plain(m.Artist && m.Artist.value);
  if (!lic) return '';
  return (who ? who + ' · ' : '') + lic + ' · Wikimedia Commons';
}
// wide enough to fill a 16:9 screen without losing much (cover crops the rest)
const wideEnough = info => info && info.width > 0 && info.height > 0 && info.width / info.height >= 1.45 && info.width / info.height <= 2.4 && info.width >= 1600;

function create(ctx) {
  const D = dir(), SF = path.join(D, 'state.json');
  let st = { list: null, cur: null, next: null, recent: [] };
  try { const s = JSON.parse(fs.readFileSync(SF, 'utf8')); if (s && typeof s === 'object') st = Object.assign(st, s); } catch (_) {}
  const save = () => { try { nc.mkdirp(D); fs.writeFileSync(SF + '.tmp', JSON.stringify(st)); fs.renameSync(SF + '.tmp', SF); } catch (_) {} };
  const exists = p => p && FILE.test(p.file) && fs.existsSync(path.join(D, p.file));
  if (!Array.isArray(st.recent)) st.recent = [];
  if (st.cur && !exists(st.cur)) st.cur = null;
  if (st.next && !exists(st.next)) st.next = null;
  // remove pictures that are neither shown nor next
  const tidy = () => { try { for (const f of fs.readdirSync(D)) if (FILE.test(f) && !(st.cur && st.cur.file === f) && !(st.next && st.next.file === f)) fs.unlinkSync(path.join(D, f)); } catch (_) {} };

  async function titles() {
    if (st.list && st.list.titles && st.list.titles.length && Date.now() - st.list.at < LIST_DAYS * 86400000) return st.list.titles;
    const all = [];
    for (const c of CATEGORIES) {
      try { const j = await getJson('action=query&list=categorymembers&cmtype=file&cmlimit=500&cmtitle=Category:' + c); for (const m of (j.query && j.query.categorymembers) || []) if (m && typeof m.title === 'string') all.push(m.title); } catch (_) {}
    }
    if (all.length) { st.list = { at: Date.now(), titles: all }; save(); }
    return all.length ? all : ((st.list && st.list.titles) || []);
  }
  // one picture, downloaded: {file, title, credit}
  async function fetchOne() {
    const list = await titles();
    if (!list.length) throw new Error('no pictures listed');
    for (let i = 0; i < 6; i++) {
      // CYTV_BACKDROP_PICK names one picture (tools/theme-preview.mjs uses a public-domain one for the screenshot in the repository)
      const fresh = list.filter(t => st.recent.indexOf(t) < 0), pool = fresh.length ? fresh : list, title = process.env.CYTV_BACKDROP_PICK || pool[Math.floor(Math.random() * pool.length)];
      st.recent = st.recent.concat(title).slice(-RECENT);
      const j = await getJson('action=query&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=1920&titles=' + encodeURIComponent(title));
      const pg = j.query && j.query.pages && j.query.pages[0], info = pg && pg.imageinfo && pg.imageinfo[0];
      const cr = credit(info);
      if (!wideEnough(info) || !info.thumburl || !cr) continue;
      const b = await fetchBuf(info.thumburl, MAX_IMAGE, 60000), k = kind(b);
      if (!k) continue;
      nc.mkdirp(D);
      const file = 'bd-' + Date.now() + '.' + k;
      fs.writeFileSync(path.join(D, file + '.tmp'), b); fs.renameSync(path.join(D, file + '.tmp'), path.join(D, file));
      return { file, title, credit: cr };
    }
    throw new Error('no usable picture found');
  }
  let busy = null, failedAt = 0;
  function prefetch() {   // keeps the next picture ready; one download at a time, and a pause after a failure
    if (busy || st.next || Date.now() - failedAt < RETRY_MS) return busy;
    busy = fetchOne().then(p => { st.next = p; save(); }, e => { failedAt = Date.now(); console.error('backdrop: ' + e.message); }).then(() => { busy = null; });
    return busy;
  }
  // the picture to show now: the next one takes over when there is none yet or the current one has been up for `hours`
  function current() {
    const hours = Math.max(1, Number(ctx.hours()) || 6), now = Date.now();
    if (st.next && (!st.cur || now - st.cur.at > hours * 3600000)) { st.cur = Object.assign({}, st.next, { at: now }); st.next = null; save(); tidy(); }
    prefetch();
    return st.cur;
  }

  async function handle(req, res, u) {
    const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const m = /^\/api\/backdrop\/img\/([\w.-]+)$/.exec(u);
    if (m) {
      const ok = FILE.test(m[1]) && ((st.cur && st.cur.file === m[1]) || (st.next && st.next.file === m[1]));
      if (!ok) { res.writeHead(404); return res.end(); }
      try { const b = fs.readFileSync(path.join(D, m[1])); res.writeHead(200, { 'content-type': /\.png$/.test(m[1]) ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=31536000' }); return res.end(b); }
      catch (_) { res.writeHead(404); return res.end(); }
    }
    if (u !== '/api/backdrop') { res.writeHead(404); return res.end(); }
    if (!ctx.active()) return json({ off: true });
    const c = current();
    return json(c ? { file: c.file, credit: c.credit } : { pending: true });
  }
  return { handle, current, prefetch: () => prefetch() || Promise.resolve(), state: () => st };
}

module.exports = { create, credit, plain, wideEnough, CATEGORIES };
