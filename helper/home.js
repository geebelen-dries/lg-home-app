// The information panel of the home screen: the rain forecast for the coming hours and the scenes in Home Assistant.
// Weather comes from Open-Meteo (free, no account). The place is the one typed on the phone setup page (manager > Voice > Set up
// from your phone), looked up with Open-Meteo's place search, or else the location of the user's Home Assistant.
// Scenes use the Home Assistant address and long-lived token that voice uses (config.json voice.ha); the token stays here. One
// press turns a scene on; All off switches every light off.
// Which scenes show is chosen on the TV (Customise > Scenes) and kept in config.json home.scenes.
// Music: Home Assistant's Spotify integration (a media_player.spotify_* entity). While it plays on this TV (its source is the TV's
// Spotify Connect name), the launcher shows what plays and offers previous, play/pause and next; the cover comes through here.
// API (loopback only): GET /api/weather, GET /api/scenes, GET /api/scenes/all, POST /api/scenes/activate {id},
// POST /api/scenes/pick {ids}, POST /api/lights/off, GET /api/music, GET /api/music/art, POST /api/music/control {action}.
const https = require('https'), http = require('http'), crypto = require('crypto');
const nc = require('./netcompat'), { URL } = nc;

const METEO = () => process.env.CYTV_METEO_URL || 'https://api.open-meteo.com';
const GEO = () => process.env.CYTV_GEO_URL || 'https://geocoding-api.open-meteo.com';
const MAX_JSON = 2 * 1024 * 1024, WEATHER_MS = 15 * 60000, SCENES_MS = 4000, MAX_SCENES = 7, HOURS = 12;
const SCENE = /^scene\.[a-z0-9_]{1,80}$/;
const MUSIC_ACTIONS = { play_pause: 'media_play_pause', next: 'media_next_track', previous: 'media_previous_track' }, MAX_ART = 2 * 1024 * 1024;
// the TV's own name in Spotify Connect looks like "[LG] webOS TV OLED55G56LS"
const TV_SOURCE = /\[LG\]|webos/i;

function request(method, url, hdrs, payload, ms, tls) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (_) { return reject(new Error('bad address')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad address'));
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    let done = false, req = null;
    const fin = (e, v) => { if (done) return; done = true; clearTimeout(hard); e ? reject(e) : resolve(v); };
    const hard = setTimeout(() => { try { req && req.destroy(); } catch (_) {} fin(new Error('timed out')); }, ms || 10000);
    const h = Object.assign({ accept: 'application/json', 'content-length': body ? body.length : 0 }, body ? { 'content-type': 'application/json' } : {}, hdrs);
    req = nc.request(u.protocol === 'https:' ? https : http, u, Object.assign({ method, headers: h, timeout: 8000 }, tls || {}), res => {
      const b = []; let n = 0, ended = false;
      res.on('data', c => { n += c.length; if (n > MAX_JSON) { fin(new Error('the answer is too large')); res.destroy(); } else b.push(c); });
      res.on('end', () => { ended = true; const buf = Buffer.concat(b); fin(null, { status: res.statusCode, text: buf.toString('utf8'), body: buf, type: String(res.headers['content-type'] || '') }); });
      res.on('aborted', () => fin(new Error('the connection was lost'))); res.on('error', fin); res.on('close', () => { if (!ended) fin(new Error('the connection was closed')); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', fin); req.end(body || undefined);
  });
}
const json = r => { if (r.status < 200 || r.status >= 300) { const e = new Error('answered ' + r.status); e.status = r.status; throw e; } return JSON.parse(r.text); };

// WMO weather codes in three kinds the launcher draws: rain (drizzle, rain, showers, thunder), snow, or dry (clear to overcast, fog)
const kind = (c, night) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95 ? 'rain' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c <= 1 ? (night ? 'night' : 'clear') : 'cloud';
const WET = 0.1;   // mm in an hour that counts as rain
// one line for the top of the panel: when the rain starts or stops in the hours given ({t: 'HH:MM', mm})
function summary(hours) {
  if (!hours.length) return '';
  const wet = h => h.mm >= WET;
  if (wet(hours[0])) { for (let i = 1; i < hours.length; i++) if (!wet(hours[i])) return 'Raining, dry by ' + hours[i].t; return 'Raining for the next ' + hours.length + ' hours'; }
  for (let i = 1; i < hours.length; i++) if (wet(hours[i])) return 'Rain from ' + hours[i].t;
  return 'Dry for the next ' + hours.length + ' hours';
}
// Open-Meteo's answer -> what the launcher shows: the hours from now on
function shape(j, nowIso) {
  const h = j && j.hourly || {}, t = h.time || [], out = [];
  const start = Math.max(0, t.findIndex(x => x >= nowIso));
  for (let i = start; i < t.length && out.length < HOURS; i++) {
    out.push({ t: String(t[i]).slice(11, 16), temp: Math.round(Number(h.temperature_2m && h.temperature_2m[i])), mm: Math.round((Number(h.precipitation && h.precipitation[i]) || 0) * 10) / 10, pc: Number(h.precipitation_probability && h.precipitation_probability[i]) || 0, kind: kind(Number(h.weather_code && h.weather_code[i]) || 0, h.is_day && h.is_day[i] === 0) });
  }
  const c = j && j.current || {};
  return { now: { temp: Math.round(Number(c.temperature_2m)), kind: kind(Number(c.weather_code) || 0, c.is_day === 0) }, hours: out, summary: summary(out) };
}

function create(ctx) {
  const haCfg = () => { const h = (ctx.readConf().voice || {}).ha || {}; return h.url && h.token ? h : null; };
  const tlsFor = h => h.selfSigned && /^https:/.test(h.url) ? { rejectUnauthorized: false } : {};
  const ha = (h, method, p, payload) => request(method, h.url + p, { authorization: 'Bearer ' + h.token }, payload, 10000, tlsFor(h)).then(r => {
    if (r.status === 401 || r.status === 403) throw new Error('Home Assistant refused the access token');
    return json(r);
  });

  // ---- weather ----
  let wx = { at: 0, key: '', data: null, error: '' }, wxP = null, haLoc = null;
  async function place() {
    const conf = ctx.readConf(), w = conf.weather || {};
    if (typeof w.place === 'string' && w.place.trim()) {
      if (typeof w.lat === 'number' && typeof w.lon === 'number' && w.for === w.place) return { lat: w.lat, lon: w.lon, name: w.name || w.place };
      const g = json(await request('GET', GEO() + '/v1/search?count=1&format=json&name=' + encodeURIComponent(w.place.trim().slice(0, 100)), {}, undefined, 10000));
      const r = g && g.results && g.results[0];
      if (!r || typeof r.latitude !== 'number') throw new Error('that place was not found');
      const c2 = ctx.readConf(); c2.weather = { place: w.place, for: w.place, lat: r.latitude, lon: r.longitude, name: String(r.name || w.place).slice(0, 60) }; ctx.writeConf(c2);
      return { lat: r.latitude, lon: r.longitude, name: c2.weather.name };
    }
    const h = haCfg();
    if (!h) return null;
    if (haLoc && haLoc.url === h.url && Date.now() - haLoc.at < 86400000) return haLoc.p;
    const c = await ha(h, 'GET', '/api/config');
    const p = typeof c.latitude === 'number' && typeof c.longitude === 'number' ? { lat: c.latitude, lon: c.longitude, name: String(c.location_name || '').slice(0, 60) } : null;
    haLoc = { url: h.url, at: Date.now(), p };
    return p;
  }
  function weather() {
    if (wxP) return wxP;
    wxP = place().then(p => {
      if (!p) return { off: true };
      const key = p.lat.toFixed(3) + ',' + p.lon.toFixed(3);
      if (wx.data && wx.key === key && Date.now() - wx.at < WEATHER_MS) return Object.assign({ place: p.name }, wx.data);
      const q = '/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon + '&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,is_day&forecast_days=2&timezone=auto';
      return request('GET', METEO() + q, {}, undefined, 12000).then(json).then(j => {
        const d = shape(j, String(j.current && j.current.time || '').slice(0, 13));
        wx = { at: Date.now(), key, data: d, error: '' };
        return Object.assign({ place: p.name }, d);
      });
    }).catch(e => (wx.data ? Object.assign({ stale: true }, wx.data) : { error: e.message })).then(x => { wxP = null; return x; });
    return wxP;
  }

  // ---- scenes ----
  // the scenes to show (config home.scenes, else all by name), which one was turned on last, and how many lights are on
  let sc = { at: 0, data: null };
  async function scenes(fresh) {
    const h = haCfg();
    if (!h) return { off: true };
    if (!fresh && sc.data && Date.now() - sc.at < SCENES_MS) return sc.data;
    const pick = (ctx.readConf().home || {}).scenes, states = await ha(h, 'GET', '/api/states');
    const all = states.filter(s => s && SCENE.test(s.entity_id));
    let list = Array.isArray(pick) && pick.length ? pick.map(id => all.find(s => s.entity_id === id)).filter(Boolean) : all.slice().sort((a, b) => name(a).localeCompare(name(b)));
    list = list.slice(0, MAX_SCENES);
    const lightsOn = states.filter(s => s && /^light\./.test(s.entity_id) && s.state === 'on').length;
    // a scene's state is when it was last turned on; it counts as the current one only while some light is on
    let last = null; for (const s of list) { const t = Date.parse(s.state); if (isFinite(t) && (!last || t > last.t)) last = { id: s.entity_id, t }; }
    // scenes named after one room ("Bedroom Relax", "Bedroom Read"): the room goes in the heading, the tiles keep the rest
    const names = list.map(name), first = names.length > 1 ? names[0].split(' ')[0] : '';
    const room = first && names.every(n => n.split(' ')[0] === first && n.length > first.length + 1) ? first : '';
    const data = { items: list.map((s, i) => ({ id: s.entity_id, name: room ? names[i].slice(room.length + 1).replace(/^./, ch => ch.toUpperCase()) : names[i], active: !!(lightsOn && last && last.id === s.entity_id), off: s.state === 'unavailable' })), lightsOn, room };
    sc = { at: Date.now(), data };
    return data;
  }
  const name = s => String((s.attributes || {}).friendly_name || s.entity_id.replace(/^\w+\./, '').replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase())).slice(0, 40);

  // ---- music (Spotify through Home Assistant) ----
  let mu = { at: 0, data: null, art: '' };
  function pickPlayer(states, conf) {
    const want = conf.spotify, players = states.filter(s => s && /^media_player\./.test(s.entity_id));
    if (typeof want === 'string' && want) return players.find(s => s.entity_id === want) || null;
    return players.find(s => /^media_player\.spotify/.test(s.entity_id)) || null;
  }
  async function music(fresh) {
    const h = haCfg();
    if (!h) return { off: true };
    if (!fresh && mu.data && Date.now() - mu.at < 2000) return mu.data;
    const conf = ctx.readConf().home || {}, p = pickPlayer(await ha(h, 'GET', '/api/states'), conf);
    let data;
    if (!p) data = { none: true };
    else {
      const a = p.attributes || {}, src = String(a.source || ''), want = typeof conf.spotifySource === 'string' && conf.spotifySource ? conf.spotifySource : '';
      const here = want ? src === want : TV_SOURCE.test(src), active = p.state === 'playing' || p.state === 'paused';
      let pos = Number(a.media_position) || 0;
      if (p.state === 'playing' && a.media_position_updated_at) { const t = Date.parse(a.media_position_updated_at); if (isFinite(t)) pos += Math.max(0, (Date.now() - t) / 1000); }
      const pic = String(a.entity_picture || '');
      mu.art = pic;
      data = { show: !!(here && active && a.media_title), playing: p.state === 'playing', title: String(a.media_title || '').slice(0, 120), artist: String(a.media_artist || '').slice(0, 120), album: String(a.media_album_name || '').slice(0, 120),
        duration: Math.round(Number(a.media_duration) || 0), position: Math.round(pos), art: pic ? crypto.createHash('sha1').update(pic).digest('hex').slice(0, 12) : '', source: src.slice(0, 80) };
    }
    mu = { at: Date.now(), data, art: mu.art };
    return data;
  }
  // the cover: Home Assistant's picture proxy (with the token, kept here) or Spotify's picture server, nothing else
  async function musicArt() {
    const h = haCfg(), pic = mu.art;
    if (!h || !pic) return null;
    let r;
    if (/^\/api\/media_player_proxy\//.test(pic)) r = await request('GET', h.url + pic, { authorization: 'Bearer ' + h.token }, undefined, 10000, tlsFor(h));
    else if (/^https:\/\/i\.scdn\.co\//.test(pic)) r = await request('GET', pic, {}, undefined, 10000);
    else return null;
    return r.status === 200 && /^image\//.test(r.type) && r.body.length <= MAX_ART ? r : null;
  }

  async function handle(req, res, u, body) {
    const out = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u === '/api/weather') return out(await weather());
    if (u === '/api/scenes') { try { return out(await scenes()); } catch (e) { return out({ error: e.message }, 502); } }
    if (u === '/api/scenes/all') {   // every scene, for choosing; picked: the ones shown, in their order
      const h = haCfg(); if (!h) return out({ off: true });
      try {
        const all = (await ha(h, 'GET', '/api/states')).filter(x => x && SCENE.test(x.entity_id)).map(x => ({ id: x.entity_id, name: name(x) })).sort((a, b) => a.name.localeCompare(b.name));
        const pick = (ctx.readConf().home || {}).scenes; return out({ items: all, picked: Array.isArray(pick) ? pick : [] });
      } catch (e) { return out({ error: e.message }, 502); }
    }
    if (u === '/api/music') { try { return out(await music()); } catch (e) { return out({ error: e.message }, 502); } }
    if (u === '/api/music/art') {
      const r = await musicArt().catch(() => null);
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': r.type, 'cache-control': 'max-age=3600' }); return res.end(r.body);
    }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    const b = await body(req), h = haCfg();
    if (!h) return out({ error: 'Home Assistant is not set up' }, 400);
    try {
      if (u === '/api/music/control') {
        const svc = MUSIC_ACTIONS[String(b.action || '')];
        if (!svc) return out({ error: 'unknown action' }, 400);
        const p = pickPlayer(await ha(h, 'GET', '/api/states'), ctx.readConf().home || {});
        if (!p) return out({ error: 'no Spotify player in Home Assistant' }, 400);
        await ha(h, 'POST', '/api/services/media_player/' + svc, { entity_id: p.entity_id });
        return out(await music(true));
      }
      if (u === '/api/scenes/pick') {   // the scenes to show, in order (empty: the first seven by name)
        const ids = Array.isArray(b.ids) ? b.ids.filter(x => typeof x === 'string' && SCENE.test(x)).slice(0, MAX_SCENES) : null;
        if (!ids) return out({ error: 'send {"ids": [...]}' }, 400);
        const c = ctx.readConf(); c.home = Object.assign({}, c.home || {}, { scenes: ids }); ctx.writeConf(c); sc = { at: 0, data: null };
      } else if (u === '/api/scenes/activate') {
        if (!SCENE.test(String(b.id || ''))) return out({ error: 'not a scene' }, 400);
        await ha(h, 'POST', '/api/services/scene/turn_on', { entity_id: b.id });
      } else if (u === '/api/lights/off') {
        await ha(h, 'POST', '/api/services/light/turn_off', { entity_id: 'all' });
      } else { res.writeHead(404); return res.end(); }
      return out(await scenes(true));
    } catch (e) { return out({ error: e.message }, 502); }
  }
  return { handle, weather, scenes, music };
}

module.exports = { create, summary, shape, kind };
