// Plex "On Deck" on the home screen. Signing in uses Plex's own link code: the service asks plex.tv for a short code, the launcher shows
// it, and the user enters it at plex.tv/link on a phone or computer; no password passes through the TV. The token, the chosen server and a
// random id for this TV are kept in config.json under "plex" (never sent to the page). The service then reads On Deck from the user's own
// Plex Media Server on the local network and hands the launcher titles, progress and pictures; the pictures are fetched through the
// service so the token stays here.
// OK on a card: the Plex app on the TV ignores launch links, so the launcher only opens Plex and the service then asks the user's
// server to start the item on that app (the way Plex's own cast button does): it waits until the app is signed in and online
// (after the profile picker), makes a play queue on the server and sends playMedia, resuming where the user left off.
// API (loopback only): GET /api/plex/status, POST /api/plex/link, POST /api/plex/unlink, GET /api/plex/ondeck, GET /api/plex/img?p=<path>,
// POST /api/plex/play {key}.
const https = require('https'), http = require('http'), crypto = require('crypto'), os = require('os');
const nc = require('./netcompat'), { URL } = nc;

const PLEX_TV = () => process.env.CYTV_PLEXTV_URL || 'https://plex.tv';
const MAX_JSON = 4 * 1024 * 1024, MAX_IMG = 3 * 1024 * 1024, DECK_MS = 60000, MAX_ITEMS = 12, PLAY_WAIT_MS = 120000, PLAY_POLL_MS = 3000;
const KEY = /^\d{1,12}$/;
// pictures the page may ask for: a library item's own thumb or art (/library/metadata/<id>/thumb/<version>)
const IMG_PATH = /^\/library\/metadata\/\d{1,12}\/(?:thumb|art|grandparentThumb|grandparentArt)\/\d{1,14}$/;

function headers(conf, token) {
  const h = { Accept: 'application/json', 'X-Plex-Product': 'CleanYourTV', 'X-Plex-Version': '1', 'X-Plex-Client-Identifier': conf.clientId, 'X-Plex-Device': 'LG webOS', 'X-Plex-Platform': 'webOS' };
  if (token) h['X-Plex-Token'] = token;
  return h;
}
// one request: plex.tv only over https; the user's server may be plain http on the local network (that is how Plex serves it there)
function request(method, url, hdrs, max, ms) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (_) { return reject(new Error('bad address')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad address'));
    let done = false, req = null;
    const fin = (e, v) => { if (done) return; done = true; clearTimeout(hard); e ? reject(e) : resolve(v); };
    const hard = setTimeout(() => { try { req && req.destroy(); } catch (_) {} fin(new Error('timed out')); }, ms || 10000);
    req = nc.request(u.protocol === 'https:' ? https : http, u, { method, headers: Object.assign({ 'content-length': 0 }, hdrs), timeout: 8000 }, res => {
      const b = []; let n = 0, ended = false;
      res.on('data', c => { n += c.length; if (n > max) { fin(new Error('the answer is too large')); res.destroy(); } else b.push(c); });
      res.on('end', () => { ended = true; fin(null, { status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(b) }); });
      res.on('aborted', () => fin(new Error('the connection was lost'))); res.on('error', fin); res.on('close', () => { if (!ended) fin(new Error('the connection was closed')); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', fin); req.end();
  });
}
const json = r => { if (r.status < 200 || r.status >= 300) { const e = new Error('Plex answered ' + r.status); e.status = r.status; throw e; } return JSON.parse(r.body.toString('utf8')); };

// the server to use from plex.tv's resources: one the user owns (else any), reached on the local network over http when possible
function pickServer(resources) {
  const servers = (Array.isArray(resources) ? resources : []).filter(r => r && String(r.provides || '').split(',').indexOf('server') >= 0 && Array.isArray(r.connections));
  servers.sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || (b.presence ? 1 : 0) - (a.presence ? 1 : 0));
  for (const s of servers) {
    const conns = s.connections.filter(c => c && typeof c.uri === 'string' && !c.relay);
    const best = conns.filter(c => c.local && c.protocol === 'http')[0] || conns.filter(c => c.local)[0] || conns[0];
    if (best) {
      const uri = best.local && best.protocol !== 'http' && best.address && best.port ? 'http://' + best.address + ':' + best.port : best.uri;
      return { uri: uri.replace(/\/+$/, ''), name: String(s.name || 'Plex').slice(0, 60), id: String(s.clientIdentifier || ''), token: s.accessToken || null };
    }
  }
  return null;
}
// this TV's Plex app among the account's players: the one reached at one of this TV's own addresses, else the only webOS player
function lanAddrs() { const out = []; for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address); return out; }
function pickPlayer(resources, addrs) {
  const players = (Array.isArray(resources) ? resources : []).filter(r => r && String(r.provides || '').split(',').indexOf('player') >= 0 && Array.isArray(r.connections) && r.clientIdentifier);
  const here = players.filter(r => r.connections.some(c => c && addrs.indexOf(c.address) >= 0));
  if (here.length) return here[0];
  const webos = players.filter(r => /webos/i.test(String(r.platform || '')));
  return webos.length === 1 ? webos[0] : null;
}
// what the launcher shows for one On Deck item
function card(m) {
  if (!m || !m.ratingKey) return null;
  const ep = m.type === 'episode', dur = Number(m.duration) || 0, off = Number(m.viewOffset) || 0;
  const pic = ep ? (m.thumb || m.grandparentArt || m.art) : (m.art || m.thumb);
  const sub = ep ? ['S' + (m.parentIndex || '?') + ' · E' + (m.index || '?'), m.title].join(' · ') : (m.year ? String(m.year) : '');
  return { key: String(m.ratingKey), title: String((ep ? m.grandparentTitle : m.title) || '').slice(0, 80), sub: String(sub).slice(0, 100), progress: dur ? Math.min(1, Math.max(0, off / dur)) : 0, img: IMG_PATH.test(pic || '') ? pic : '' };
}

function create(ctx) {
  const conf = () => { const c = ctx.readConf().plex; return c && typeof c === 'object' ? c : {}; };
  const save = p => { const c = ctx.readConf(); if (p) c.plex = p; else delete c.plex; ctx.writeConf(c); };
  const ensureId = () => { const p = conf(); if (!p.clientId) { p.clientId = crypto.randomBytes(12).toString('hex'); save(p); } return p; };
  let link = null, pollT = null, deck = { at: 0, items: [], error: '' }, deckP = null, play = null;

  async function finish(token) {   // a token arrived: find the server and keep both
    const p = conf();
    const res = json(await request('GET', PLEX_TV() + '/api/v2/resources?includeHttps=1&includeRelay=0', headers(p, token), MAX_JSON, 15000));
    const s = pickServer(res);
    p.token = token; p.server = s ? { uri: s.uri, name: s.name, id: s.id } : null; if (s && s.token) p.serverToken = s.token; else delete p.serverToken;
    save(p); deck = { at: 0, items: [], error: '' };
  }
  function poll() {
    clearTimeout(pollT);
    if (!link) return;
    if (Date.now() > link.until) { link = null; return; }
    request('GET', PLEX_TV() + '/api/v2/pins/' + link.id, headers(conf()), MAX_JSON).then(json).then(j => {
      if (j && j.authToken) { const tok = j.authToken; link = null; return finish(tok).catch(e => { console.error('plex: ' + e.message); }); }
      pollT = setTimeout(poll, 3000);
    }).catch(() => { pollT = setTimeout(poll, 5000); });
  }
  async function startLink() {
    const p = ensureId();
    const j = json(await request('POST', PLEX_TV() + '/api/v2/pins?strong=false', headers(p), MAX_JSON));
    if (!j || !j.id || !j.code) throw new Error('Plex did not give a code');
    link = { id: j.id, code: String(j.code), until: Date.now() + Math.min(900, Number(j.expiresIn) || 900) * 1000 };
    pollT = setTimeout(poll, 3000);
    return link;
  }
  const status = () => { const p = conf(); return p.token ? { state: 'on', server: p.server ? p.server.name : '' } : link ? { state: 'linking', code: link.code } : { state: 'off' }; };

  function onDeck() {
    const p = conf();
    if (!p.token || !p.server) return Promise.resolve({ items: [], off: !p.token });
    if (Date.now() - deck.at < DECK_MS) return Promise.resolve({ items: deck.items });
    if (deckP) return deckP;
    deckP = request('GET', p.server.uri + '/library/onDeck?X-Plex-Container-Size=' + MAX_ITEMS, headers(p, p.serverToken || p.token), MAX_JSON).then(json).then(j => {
      const items = ((j && j.MediaContainer && j.MediaContainer.Metadata) || []).map(card).filter(Boolean).slice(0, MAX_ITEMS);
      deck = { at: Date.now(), items, error: '' };
    }).catch(e => { deck = { at: Date.now(), items: deck.items, error: e.message }; if (e.status === 401) console.error('plex: the token was refused'); })
      .then(() => { deckP = null; return { items: deck.items, error: deck.error || undefined }; });
    return deckP;
  }
  async function image(pathQ, w, h) {
    const p = conf();
    if (!p.token || !p.server || !IMG_PATH.test(pathQ)) return null;
    const q = 'width=' + w + '&height=' + h + '&minSize=1&upscale=1&url=' + encodeURIComponent(pathQ);
    const r = await request('GET', p.server.uri + '/photo/:/transcode?' + q, Object.assign(headers(p, p.serverToken || p.token), { Accept: 'image/*' }), MAX_IMG, 15000);
    return r.status === 200 && /^image\//.test(r.type) ? r : null;
  }

  // ---- play an item on this TV's Plex app ----
  async function playNow(key) {
    const p = conf(), st = p.serverToken || p.token, su = new URL(p.server.uri);
    const rs = json(await request('GET', PLEX_TV() + '/api/v2/resources?includeHttps=1&includeRelay=0', headers(p, p.token), MAX_JSON, 15000));
    const tv = pickPlayer(rs, ctx.addrs ? ctx.addrs() : lanAddrs());
    if (!tv) throw new Error('the Plex app of this TV is not known to the account');
    if (!tv.presence) return false;   // not open, or still at the profile picker
    const m = json(await request('GET', p.server.uri + '/library/metadata/' + key, headers(p, st), MAX_JSON));
    const item = m && m.MediaContainer && m.MediaContainer.Metadata && m.MediaContainer.Metadata[0];
    if (!item) throw new Error('the item is not on the server any more');
    const uri = 'server://' + p.server.id + '/com.plexapp.plugins.library/library/metadata/' + key;
    const pq = json(await request('POST', p.server.uri + '/playQueues?type=video&repeat=0&own=1&uri=' + encodeURIComponent(uri), headers(p, st), MAX_JSON));
    const pqid = pq && pq.MediaContainer && pq.MediaContainer.playQueueID;
    if (!pqid) throw new Error('the server did not make a play queue');
    const q = 'key=' + encodeURIComponent('/library/metadata/' + key) + '&offset=' + (Number(item.viewOffset) || 0) + '&machineIdentifier=' + encodeURIComponent(p.server.id) +
      '&address=' + encodeURIComponent(su.hostname) + '&port=' + (su.port || (su.protocol === 'https:' ? 443 : 32400)) + '&protocol=' + su.protocol.replace(':', '') + '&token=' + encodeURIComponent(st) +
      '&containerKey=' + encodeURIComponent('/playQueues/' + pqid + '?own=1&window=200') + '&commandID=' + (++playCmd) + '&type=video&providerIdentifier=com.plexapp.plugins.library';
    const conns = tv.connections.filter(c => c && c.local).concat(tv.connections.filter(c => c && !c.local));
    let last = null;
    for (const c of conns) {
      try {
        const r = await request('GET', String(c.uri).replace(/\/+$/, '') + '/player/playback/playMedia?' + q, Object.assign(headers(p), { 'X-Plex-Target-Client-Identifier': tv.clientIdentifier }), MAX_JSON, 10000);
        if (r.status === 200 && !/code="[45]\d\d"/.test(r.body.toString('utf8'))) return true;
        last = new Error('the Plex app answered ' + r.status);
      } catch (e) { last = e; }
    }
    throw last || new Error('the Plex app could not be reached');
  }
  let playCmd = 0;
  // ask for an item: tries now, then every few seconds until the app is online, for two minutes; a newer request replaces it
  function startPlay(key) {
    if (play) clearTimeout(play.t);
    const job = play = { key, until: Date.now() + PLAY_WAIT_MS, state: 'waiting', t: null };
    const step = () => {
      if (play !== job) return;
      playNow(key).then(done => {
        if (play !== job) return;
        if (done) { job.state = 'playing'; return; }
        if (Date.now() > job.until) { job.state = 'timeout'; return; }
        job.t = setTimeout(step, PLAY_POLL_MS);
      }, e => { if (play !== job) return; job.state = 'error'; job.error = e.message; console.error('plex: ' + e.message); });
    };
    step();
    return job;
  }

  async function handle(req, res, u, body) {
    const out = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const act = u.replace('/api/plex/', '');
    if (act === 'status') return out(status());
    if (act === 'play-status') return out(play ? { key: play.key, state: play.state, error: play.error } : { state: 'none' });
    if (act === 'ondeck') return out(await onDeck());
    if (act === 'img') {
      const qs = new nc.URLSearchParams((req.url.split('?')[1]) || ''), r = await image(qs.get('p') || '', 640, 360).catch(() => null);
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': r.type, 'cache-control': 'max-age=86400' }); return res.end(r.body);
    }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    const pb = await body(req) || {};
    if (act === 'play') {
      const key = String(pb.key || '');
      if (!KEY.test(key)) return out({ error: 'not a library item' }, 400);
      const p = conf(); if (!p.token || !p.server) return out({ error: 'Plex is not signed in' }, 400);
      const j = startPlay(key); return out({ state: j.state });
    }
    if (act === 'link') { try { const l = await startLink(); return out({ state: 'linking', code: l.code }); } catch (e) { return out({ error: 'could not reach plex.tv: ' + e.message }, 502); } }
    if (act === 'unlink') { clearTimeout(pollT); link = null; const p = conf(); save(p.clientId ? { clientId: p.clientId } : null); deck = { at: 0, items: [], error: '' }; return out(status()); }
    res.writeHead(404); res.end();
  }
  return { handle, status, onDeck };
}

module.exports = { create, pickServer, pickPlayer, card, IMG_PATH };
