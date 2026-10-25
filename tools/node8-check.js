// Checks that the service runs on the older Node.js of webOS 5 and 6 (8.x). Run with tools/node8-check.sh, or with any Node:
//   node tools/node8-check.js
// It parses every service file, loads the modules and runs the parts that used APIs Node 8 lacks (pairing code, URL and
// form handling, outgoing http requests, mkdir -p) against a local server. Nothing leaves this machine.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process'), vm = require('vm');
const root = path.join(__dirname, '..'), helper = path.join(root, 'helper');
let failed = 0;
const ok = (c, name) => { console.log((c ? 'ok   ' : 'FAIL ') + name); if (!c) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cytv-n8-'));
process.env.CYTV_LIVE_DIR = path.join(tmp, 'live', 'deep');   // exercises mkdir -p as well
process.env.CYTV_DIR = path.join(tmp, 'cytv'); fs.mkdirSync(process.env.CYTV_DIR);
process.env.CYTV_SERVICE_DIR = path.join(tmp, 'svc'); fs.mkdirSync(process.env.CYTV_SERVICE_DIR);

// 1. syntax of everything that runs on the TV under Node
const files = fs.readdirSync(helper).filter(f => /\.js$/.test(f)).map(f => path.join(helper, f)).concat(path.join(root, 'scripts', 'jtool.js'));
for (const f of files) { const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); ok(r.status === 0, 'syntax ' + path.relative(root, f) + (r.status ? '\n' + r.stderr : '')); }

// 2. modules load (helper.js starts the service, so it is only parsed above)
for (const m of ['netcompat', 'notify', 'notifyapi', 'sharelog', 'picker', 'inputhook', 'manager', 'live', 'voice', 'theme']) { try { require(path.join(helper, m)); ok(true, 'loads ' + m); } catch (e) { ok(false, 'loads ' + m + ': ' + e.message); } }

const nc = require(path.join(helper, 'netcompat'));
const call = (fn, url, method, body) => new Promise((resolve, reject) => {
  let b = ''; const rq = nc.request(http, url, { method, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body || '') }, timeout: 4000 }, r => { r.on('data', c => b += c); r.on('end', () => resolve({ status: r.statusCode, body: b })); });
  rq.on('error', reject); rq.end(body || '');
});
const fake = (url, method) => { const res = { code: 0, out: '', writeHead(c) { this.code = c; }, end(s) { this.out = s || ''; } }; return { req: { url, method: method || 'GET', headers: {} }, res }; };

(async () => {
  // 3. compatibility layer against a local server
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'x-path': q.url, 'x-ua': q.headers['user-agent'] || '' });
    if (q.url === '/pl.m3u') return r.end('#EXTM3U\n#EXTINF:-1 group-title="G",Chan A\nhttp://127.0.0.1:1/live/u/p/1.m3u8\n');
    r.end(q.method); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  const port = srv.address().port;
  const g = await new Promise((resolve, reject) => nc.get(http, 'http://127.0.0.1:' + port + '/a/b?x=1#h', { headers: { 'User-Agent': 't' }, timeout: 3000 }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => resolve({ r, b })); }).on('error', reject));
  ok(g.r.headers['x-path'] === '/a/b?x=1' && g.r.headers['x-ua'] === 't' && g.b === 'GET', 'http get with an address and options');
  const d = path.join(tmp, 'a', 'b', 'c'); nc.mkdirp(d); nc.mkdirp(d); ok(fs.existsSync(d), 'mkdir -p');
  ok(new nc.URLSearchParams('a=1&b=x').get('b') === 'x' && new nc.URL('http://h/p?q=1').searchParams.get('q') === '1', 'URL and URLSearchParams');
  let lo = 1e9, hi = -1, all = true; for (let i = 0; i < 3000; i++) { const n = nc.randomInt(100000, 1000000); if (n < 100000 || n >= 1000000 || n !== Math.floor(n)) all = false; lo = Math.min(lo, n); hi = Math.max(hi, n); }
  ok(all && hi - lo > 800000, 'randomInt stays in range and spreads');
  const dice = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6000; i++) dice[nc.randomInt(0, 6)]++; ok(dice.every(c => c > 800 && c < 1200), 'randomInt is evenly spread');

  // 4. Live TV pairing end to end: code, form post, playlist fetch
  const live = require(path.join(helper, 'live'));
  let f = fake('/api/live/pair', 'POST'); await live.handle(f.req, f.res, '/api/live/pair', async () => ({}));
  const pairInfo = JSON.parse(f.res.out); ok(/^\d{6}$/.test(String(pairInfo.code)) && /^http:\/\//.test(pairInfo.url), 'live pairing gives a 6 digit code and an address');
  const pairUrl = new nc.URL(pairInfo.url);
  const wrong = await call(null, 'http://127.0.0.1:' + pairUrl.port + '/set', 'POST', 'code=000000&playlist=' + encodeURIComponent('http://127.0.0.1:' + port + '/pl.m3u'));
  ok(wrong.status === 403, 'a wrong code is refused');
  const saved = await call(null, 'http://127.0.0.1:' + pairUrl.port + '/set', 'POST', 'code=' + pairInfo.code + '&epg=&playlist=' + encodeURIComponent('http://127.0.0.1:' + port + '/pl.m3u'));
  ok(saved.status === 200, 'the right code saves the playlist address');
  let n = 0; for (let i = 0; i < 40 && !n; i++) { await new Promise(r => setTimeout(r, 150)); f = fake('/api/live/channels'); await live.handle(f.req, f.res, '/api/live/channels', async () => ({})); n = (JSON.parse(f.res.out).channels || []).length; }
  ok(n === 1, 'the playlist is fetched and parsed');

  // 4b. playlist details: quality, country, language, flags, categories, merged streams
  const pl = live.parseM3U(['#EXTM3U',
    '#EXTINF:-1 tvg-id="CNN.us@SD" tvg-country="US" tvg-language="English" group-title="News;World",CNN (480p)', 'http://h/a1.m3u8',
    '#EXTINF:-1 tvg-id="CNN.us@HD" group-title="News;World",CNN HD', 'http://h/a2.m3u8',
    '#EXTINF:-1 tvg-id="Foo.nl" group-title="Kids",Foo [Geo-blocked]', 'http://h/b.m3u8',
    '#EXTGRP:Sport', '#EXTINF:-1,Bar 4K [Not 24/7]', '#EXTVLCOPT:http-user-agent=X', 'http://h/c.m3u8|User-Agent=Y',
    '#EXTINF:-1,#### SEPARATOR ####', 'http://h/x',
    '#EXTINF:-1 tvg-id="" group-title="",Same', 'http://h/d.m3u8', '#EXTINF:-1 tvg-id="" group-title="",Same', 'http://h/e.m3u8'].join('\n'));
  const [cnn, foo, bar, same1, same2] = pl.channels;
  ok(pl.v === 2 && pl.channels.length === 5 && pl.channels.map(c => c.num).join() === '1,2,3,4,5', 'playlist: five channels, separators skipped, numbers in order');
  ok(cnn.alt.length === 1 && cnn.alt[0].url === 'http://h/a2.m3u8' && cnn.alt[0].q === 'HD' && cnn.q === 'SD', 'playlist: the same channel id with @SD/@HD is one channel with another stream');
  ok(cnn.cc === 'US' && cnn.lang === 'English' && cnn.cats.join() === 'News,World' && pl.groups.join() === 'News,World,Kids,Sport', 'playlist: country, language and several categories');
  ok(foo.fl === 1 && foo.cc === 'NL' && bar.fl === 6 && bar.q === '4K' && bar.group === 'Sport', 'playlist: geo-blocked, part-time and header markers, quality, #EXTGRP');
  ok(new Set(pl.channels.map(c => c.key)).size === 5 && /^[0-9a-f]{10}$/.test(cnn.key), 'playlist: every channel has its own key');

  // 4c. what the viewer did is kept in the service
  const st = async (b) => { const x = fake('/api/live/state', 'POST'); await live.handle(x.req, x.res, '/api/live/state', async () => b); return x.res.code; };
  const getSt = async () => { const x = fake('/api/live/state'); await live.handle(x.req, x.res, '/api/live/state', async () => ({})); return JSON.parse(x.res.out); };
  const k1 = 'abcdef0123', k2 = 'abcdef0124';
  await st({ op: 'fav', key: k1, on: true }); await st({ op: 'fav', key: k2, on: true }); await st({ op: 'fav', key: k1, on: false });
  await st({ op: 'recent', key: k1 }); await st({ op: 'recent', key: k2 }); await st({ op: 'recent', key: k1 }); await st({ op: 'failed', key: k2, on: true });
  let sv = await getSt(); ok(sv.fav.join() === k2 && sv.recent.join() === k1 + ',' + k2 && !!sv.failed[k2], 'state: favourites, recents (newest first) and failed channels');
  ok(await st({ op: 'fav', key: '../x', on: true }) === 400 && await st({ op: 'nope', key: k1 }) === 400, 'state: bad keys and operations are refused');
  for (let i = 0; i < 40; i++) await st({ op: 'recent', key: ('0000000000' + i.toString(16)).slice(-10) }); sv = await getSt(); ok(sv.recent.length === 30, 'state: recents are capped');
  await new Promise(r => setTimeout(r, 1300)); ok(JSON.parse(fs.readFileSync(path.join(process.env.CYTV_LIVE_DIR, 'state.json'), 'utf8')).fav.join() === k2, 'state: written to the live folder');

  // 4d. why a stream does not play
  const big = Buffer.alloc(9000, 1);
  const ps = http.createServer((q, r) => {
    const t = (c, type, body) => { r.writeHead(c, type ? { 'content-type': type } : {}); r.end(body || ''); };
    if (q.url === '/ok.ts') return t(200, 'video/mp2t', big);
    if (q.url === '/hls.m3u8') return t(200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nseg.ts\n');
    if (q.url === '/drm.m3u8') return t(200, 'application/x-mpegurl', '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:10,\nseg.ts\n');
    if (q.url === '/page') return t(200, 'text/html', '<!doctype html><title>login</title>');
    if (q.url === '/go') { r.writeHead(302, { location: '/ok.ts' }); return r.end(); }
    if (q.url === '/forbidden') return t(403);
    if (q.url === '/missing') return t(404);
    if (q.url === '/boom') return t(502);
    t(200, 'video/mp2t', big);
  }).listen(0, '127.0.0.1'); await new Promise(r => ps.on('listening', r));
  const pp = 'http://127.0.0.1:' + ps.address().port, why = async u => (await live.probe(u)).reason;
  const got = [await why(pp + '/ok.ts'), await why(pp + '/hls.m3u8'), await why(pp + '/drm.m3u8'), await why(pp + '/page'), await why(pp + '/go'), await why(pp + '/forbidden'), await why(pp + '/missing'), await why(pp + '/boom'), await why('http://127.0.0.1:1/x')];
  ok(got.join() === 'ok,ok,drm,notvideo,ok,refused,gone,server,unreachable', 'probe: ok, ok, drm, not a video, redirect followed, refused, gone, server error, unreachable (' + got.join() + ')');
  f = fake('/api/live/probe?key=zzzzzzzzzz&i=0'); await live.handle(f.req, f.res, '/api/live/probe', async () => ({})); ok(f.res.code === 404, 'probe: only streams of the playlist are asked about');
  ps.close();
  f = fake('/api/live/reset', 'POST'); await live.handle(f.req, f.res, '/api/live/reset', async () => ({}));

  // 5. version comparison used by the updater
  const { cmp } = require(path.join(helper, 'manager')); ok(cmp('1.5.10', '1.5.9') > 0 && cmp('1.5.3', '1.5.3') === 0 && cmp('1.4.9', '1.5.0') < 0, 'version compare');

  // 6. update channels: stable release or a test build, against a mock of the GitHub API
  const rel = (tag, ver, fe, body, pre) => ({ tag_name: tag, name: pre ? 'Test build: ' + tag.replace(/^test-/, '') : tag, prerelease: !!pre, body, published_at: '2026-10-23T10:00:00Z', assets: [].concat(...['com.cleanyourtv.manager_' + ver + '_all.ipk', 'frontend-' + fe + '.tgz'].map(n => [{ name: n, browser_download_url: 'http://x/' + n }, { name: n + '.sha256', browser_download_url: 'http://x/' + n + '.sha256' }])) });
  const api = http.createServer((q, r) => {
    const send = o => { r.writeHead(o ? 200 : 404, { 'content-type': 'application/json' }); r.end(JSON.stringify(o || {})); };
    if (q.url === '/repos/o/r/releases/latest') return send(rel('v1.5.3', '1.5.3', '1.4.5', 'stable'));
    if (q.url === '/repos/o/r/releases/tags/test-foo-bar') return send(rel('test-foo-bar', '1.5.4', '1.4.6', 'build: abc1234\nbranch: foo/bar', true));
    if (q.url === '/repos/o/r/releases?per_page=40') return send([rel('test-foo-bar', '1.5.4', '1.4.6', 'build: abc1234\nbranch: foo/bar', true), rel('v1.5.3', '1.5.3', '1.4.5', 'stable'), rel('test-main', '9.9.9', '9.9.9', 'x', false)]);
    send(null); }).listen(0, '127.0.0.1');
  await new Promise(r => api.on('listening', r));
  process.env.CYTV_API = 'http://127.0.0.1:' + api.address().port;
  fs.writeFileSync(path.join(process.env.CYTV_DIR, 'source'), 'o/r main\n');
  const mgr = require(path.join(helper, 'manager'));
  let m;   // the service reads its own version when it starts, so each scenario starts one
  const start = v => { m = mgr.create({ luna: async () => ({}), readConf: () => ({}), writeConf() {}, inputhook: { status: () => ({}), ensure() {} }, VERSION: v, pickerShown: () => 0 }); };
  const ask = async (act, method, body) => { const x = fake('/api/manager/' + act, method); await m.handle(x.req, x.res, '/api/manager/' + act, async () => body || {}); return { code: x.res.code, j: JSON.parse(x.res.out) }; };
  const bf = path.join(process.env.CYTV_DIR, 'BUILD');
  start('1.5.2'); let r = await ask('check', 'POST'); ok(r.j.service.updateTo === '1.5.3' && r.j.channel === '', 'stable: offers the newer release');
  start('1.5.3'); r = await ask('check', 'POST'); ok(r.j.service.updateTo === null, 'stable: nothing to offer at the same version');
  r = await ask('tests', 'GET'); ok(r.j.builds.length === 1 && r.j.builds[0].tag === 'test-foo-bar' && r.j.builds[0].build === 'abc1234' && r.j.builds[0].service === '1.5.4', 'the list holds pre-releases named test-* only');
  r = await ask('channel', 'POST', { tag: 'test-../x' }); ok(r.code === 400, 'a bad channel name is refused');
  r = await ask('channel', 'POST', { tag: 'test-foo-bar' }); ok(r.j.channel === 'test-foo-bar' && r.j.service.updateTo === '1.5.4' && r.j.release.test === true, 'a test channel offers the test build');
  start('1.5.4'); fs.writeFileSync(bf, 'abc1234\n'); r = await ask('check', 'POST'); ok(r.j.service.updateTo === null && r.j.service.build === 'abc1234', 'the same build is not offered again');
  fs.writeFileSync(bf, 'def5678\n'); r = await ask('check', 'POST'); ok(r.j.service.updateTo === '1.5.4', 'another commit of the same version is offered');
  r = await ask('channel', 'POST', { tag: '' }); ok(r.j.channel === '' && r.j.service.updateTo === '1.5.3', 'back on stable after a test build offers the stable release, even an older one');
  fs.unlinkSync(bf); start('1.5.3'); r = await ask('check', 'POST'); ok(r.j.service.updateTo === null, 'stable without a test build installed: no offer at the same version');

  // 7. Live TV is optional: the option is stored and the key binds are refreshed
  let store = {}, ensured = 0;
  m = mgr.create({ luna: async () => ({}), readConf: () => JSON.parse(JSON.stringify(store)), writeConf: c => { store = JSON.parse(JSON.stringify(c)); }, inputhook: { status: () => ({}), ensure() { ensured++; } }, VERSION: '1.5.8', pickerShown: () => 0 });
  r = await ask('status', 'GET'); ok(r.j.options.liveTv === true && r.j.keys.guide === '', 'Live TV is on by default and no Guide key is learned');
  r = await ask('options', 'POST', { liveTv: false }); ok(r.j.options.liveTv === false && store.options.liveTv === false && ensured > 0, 'switching Live TV off is stored and refreshes the key binds');
  r = await ask('options', 'POST', { liveTv: 'no' }); ok(r.j.options.liveTv === false, 'only a boolean changes the option');
  r = await ask('options', 'POST', { liveTv: true }); ok(r.j.options.liveTv === true, 'switching Live TV on again');
  // 8. Home Assistant (Assist): a mock server for success, not understood, bad token, unreachable and slow answers
  const haLog = [], TOKEN = 'secret-ha-token-123';
  const haSrv = http.createServer((q, r) => {
    let b = ''; q.on('data', c => b += c); q.on('end', () => {
      const send = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
      if (q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { message: '401: Unauthorized' });
      if (q.url === '/api/config') return send(200, { location_name: 'Home', version: '2026.10.0' });
      if (q.url === '/api/states') return send(200, [{ entity_id: 'light.x', attributes: {} }, { entity_id: 'conversation.home_assistant', attributes: { friendly_name: 'Home Assistant' } }, { entity_id: 'conversation.llm', attributes: {} }]);
      if (q.url !== '/api/conversation/process') return send(404, {});
      const o = JSON.parse(b); haLog.push(o);
      const reply = (type, speech, code) => send(200, { conversation_id: 'conv-1', response: { response_type: type, data: code ? { code } : {}, speech: { plain: { speech } } } });
      if (o.text === 'turn on the light') return reply('action_done', 'Turned on the light');
      if (o.text === 'quiet') return reply('action_done', '');
      if (o.text === 'slow') return setTimeout(() => reply('query_answer', 'Finally'), 600);
      reply('error', 'Sorry, I couldn\'t understand that', 'no_intent_match');
    });
  }).listen(0, '127.0.0.1');
  const orSrv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ choices: [{ message: { content: 'The AI says hello' } }] })); }); }).listen(0, '127.0.0.1');
  await Promise.all([haSrv, orSrv].map(x => new Promise(r => x.on('listening', r))));
  process.env.CYTV_OPENROUTER = 'http://127.0.0.1:' + orSrv.address().port;
  const voice = require(path.join(helper, 'voice'));
  let vconf = {}; const cards = [];
  const v = voice.create({ readConf: () => JSON.parse(JSON.stringify(vconf)), writeConf: c => { vconf = JSON.parse(JSON.stringify(c)); }, notify: { show: async o => { cards.push(o); } } });
  const vask = async (act, body, method) => { const x = fake('/api/voice/' + act, method || 'POST'); await v.handle(x.req, x.res, '/api/voice/' + act, async () => body || {}); return { code: x.res.code, j: JSON.parse(x.res.out || '{}') }; };
  const haUrl = 'http://127.0.0.1:' + haSrv.address().port;
  r = await vask('set', { ha: { url: 'ftp://x' } }); ok(r.code === 400, 'a Home Assistant address that is not http(s) is refused');
  r = await vask('set', { ha: { route: 'sideways' } }); ok(r.code === 400, 'an unknown routing is refused');
  r = await vask('set', { ha: { url: haUrl + '/', token: 'wrong' } }); ok(r.code === 200 && r.j.ha.url === haUrl && r.j.ha.route === 'ha-first', 'the address is stored without a trailing slash; the default routing is Home Assistant first');
  ok(JSON.stringify(r.j).indexOf('wrong') < 0 && r.j.ha.hasToken === true, 'the status never contains the token');
  r = await vask('ha-test'); ok(r.code === 502 && /refused the access token/.test(r.j.error), 'a bad token is reported');
  await vask('set', { ha: { token: TOKEN } });
  r = await vask('ha-test'); ok(r.j.name === 'Home' && r.j.version === '2026.10.0', 'test connection reads the name and version');
  r = await vask('ha-agents'); ok(r.j.agents.length === 2 && r.j.agents[0].id === 'conversation.home_assistant' && r.j.agents[0].name === 'Home Assistant', 'agents are the conversation.* entities');
  r = await vask('ask', { text: 'turn on the light', card: false }); ok(r.j.answer === 'Turned on the light' && r.j.via === 'ha', 'Assist answers an understood command');
  r = await vask('ask', { text: 'quiet', card: false }); ok(r.j.answer === 'Done', 'an action without speech shows Done');
  ok(haLog[1].conversation_id === 'conv-1' && !haLog[0].conversation_id, 'the conversation id is passed on to the next request');
  r = await vask('ask', { text: 'slow', card: false }); ok(r.j.answer === 'Finally', 'a slow answer is waited for');
  r = await vask('ask', { text: 'what is love', card: false }); ok(r.j.answer === 'Sorry, I couldn\'t understand that' && r.j.via === 'ha', 'not understood and no AI: Assist\'s own message is shown');
  await vask('set', { llm: { key: 'sk-test', enabled: true } });
  r = await vask('ask', { text: 'what is love', card: false }); ok(r.j.answer === 'The AI says hello' && r.j.via === 'ai', 'not understood: the same text goes to the AI');
  r = await vask('ask', { text: 'turn on the light', card: false }); ok(r.j.via === 'ha', 'understood: the AI is not asked');
  await vask('set', { ha: { route: 'ha-only' } });
  r = await vask('ask', { text: 'what is love', card: false }); ok(r.j.via === 'ha' && /couldn't understand/.test(r.j.answer), 'Home Assistant only: never the AI');
  await vask('set', { ha: { route: 'ai-only' } }); const n0 = haLog.length;
  r = await vask('ask', { text: 'turn on the light', card: false }); ok(r.j.via === 'ai' && haLog.length === n0, 'AI only: Home Assistant is not asked');
  await vask('set', { ha: { route: 'ha-first', agent: 'conversation.llm' } });
  await vask('ask', { text: 'turn on the light', card: false }); ok(haLog[haLog.length - 1].agent_id === 'conversation.llm', 'the chosen agent is sent');
  await vask('set', { ha: { agent: '' } }); await vask('forget'); await vask('ask', { text: 'turn on the light', card: false }); ok(!haLog[haLog.length - 1].conversation_id && !('agent_id' in haLog[haLog.length - 1]), 'forgetting starts a new conversation; no agent means the default');
  r = await vask('set', { ha: { url: 'http://127.0.0.1:1' } }); r = await vask('ask', { text: 'turn on the light', card: false }); ok(r.j.answer === 'The AI says hello' && r.j.via === 'ai', 'Home Assistant unreachable: the AI answers');
  await vask('set', { llm: { clearKey: true } }); r = await vask('ask', { text: 'turn on the light', card: false }); ok(!r.j.answer && /Home Assistant:/.test(r.j.error), 'Home Assistant unreachable and no AI: the error is reported');
  await vask('set', { ha: { clear: true } }); r = await vask('status', null, 'GET'); ok(r.j.ha.configured === false && r.j.ha.hasToken === false, 'removing Home Assistant clears the address and token');
  haSrv.close(); orSrv.close();
  // 9. Themes are read from GitHub: the repository's themes/ folder is valid, values are whitelisted and clamped, extends works, a theme is
  // downloaded when chosen and kept, a bad download is refused, and the service ships none
  const themeMod = require(path.join(helper, 'theme')), tdir = path.join(root, 'themes');
  const folders = fs.readdirSync(tdir).filter(n => fs.statSync(path.join(tdir, n)).isDirectory());
  ok(folders.length >= 5 && folders.indexOf('classic') >= 0, 'the themes folder holds one folder per theme');
  const known = new Set(themeMod.SCHEMA.map(r => r[0])), unknownKeys = [], walk = (o, pre) => { for (const k of Object.keys(o)) { const key = pre ? pre + '.' + k : k; if (o[k] && typeof o[k] === 'object') walk(o[k], key); else if (!known.has(key) && ['name', 'author', 'description', 'extends'].indexOf(key) < 0) unknownKeys.push(key); } };
  let allOk = true; const tbad = [];
  for (const id of folders) {
    const fd = path.join(tdir, id); let raw; try { raw = JSON.parse(fs.readFileSync(path.join(fd, 'theme.json'), 'utf8')); } catch (e) { allOk = false; tbad.push(id + ': theme.json'); continue; }
    const t = themeMod.normalize(raw, id, null, fd); walk(raw, '');
    if (!t || (raw.effects && raw.effects.wallpaper && t.v['effects.wallpaper'] !== raw.effects.wallpaper)) { allOk = false; tbad.push(id + ': theme or wallpaper'); }
    const pv = ['jpg', 'png', 'webp'].map(x => path.join(fd, 'preview.' + x)).filter(f => fs.existsSync(f))[0];
    if (!pv || !themeMod.imageOk(fs.readFileSync(pv), pv, 600 * 1024)) { allOk = false; tbad.push(id + ': screenshot (preview.jpg, an image of at most 600 KB)'); }
  }
  ok(allOk, 'every theme folder has a valid theme.json, its wallpaper and a screenshot' + (tbad.length ? ': ' + tbad.join('; ') : ''));
  ok(unknownKeys.length === 0, 'theme files use only keys of the schema' + (unknownKeys.length ? ': ' + unknownKeys.join(', ') : ''));
  ok(fs.readFileSync(path.join(tdir, 'index.json'), 'utf8') === require(path.join(root, 'tools', 'theme-index.js')).build(), 'themes/index.json is up to date (run: node tools/theme-index.js)');
  ok(themeMod.SCHEMA.every(r => ['name', 'author', 'description', 'extends'].indexOf(r[0].split('.')[0]) < 0), 'no setting group shares a name with the theme\'s own fields (name, author, description, extends)');
  const bad = themeMod.normalize({ name: 'x'.repeat(500), colors: { night: 'red; background:url(//evil)', ink: '#12345', accent: 5 }, grid: { cols: 99, tileH: -5, radius: 1e9, mode: 'sideways', align: 'middle' }, type: { scale: '2', font: 'comic' }, clock: { layout: 'sideways', scale: 50 }, effects: { glow: 7, speed: NaN, wallpaper: '../../etc/passwd', wallpaperDim: 5 }, css: 'body{display:none}' }, 'evil');
  ok(bad.name.length === 40 && bad.v['colors.night'] === '#07080b' && bad.v['colors.ink'] === '#f5f6f8' && bad.v['colors.accent'] === '#f5f6f8', 'colours must be #rrggbb, anything else falls back');
  ok(bad.v['grid.cols'] === 14 && bad.v['grid.tileH'] === 80 && bad.v['grid.radius'] === 100 && bad.v['grid.mode'] === 'below' && bad.v['grid.align'] === 'left' && bad.v['type.scale'] === 1 && bad.v['type.font'] === 'default' && bad.v['clock.layout'] === 'inline' && bad.v['clock.scale'] === 2.5, 'numbers are clamped, enums and types are checked');
  ok(bad.v['effects.glow'] === 1 && bad.v['effects.speed'] === 1 && bad.v['effects.wallpaper'] === '' && bad.v['effects.wallpaperDim'] === 0.9 && !('css' in bad.v), 'effects are clamped, a wallpaper path is refused and unknown keys are dropped');
  ok(themeMod.normalize({}, '../x') === null, 'a bad theme id is refused');
  const badLift = themeMod.normalize({ tile: { focus: 'glow', label: 7 }, grid: { lift: 99, icon: 'stretch' }, effects: { glowShape: 'round' } }, 'badlift');
  ok(badLift.v['tile.focus'] === 'ring' && badLift.v['tile.label'] === 'none' && badLift.v['grid.lift'] === 40 && badLift.v['grid.icon'] === 'fill' && badLift.v['effects.glowShape'] === 'corner', 'the focus style, label, lift, icon and glow shape are checked and fall back');
  const page = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8'), fonts = (page.match(/url\(([\w.-]+\.woff2)\)/g) || []).map(u => u.slice(4, -1));
  ok(fonts.length === 3 && fonts.every(f => fs.existsSync(path.join(root, 'app', f))) && fs.readdirSync(path.join(root, 'app')).every(n => fs.statSync(path.join(root, 'app', n)).isFile()), 'the fonts the launcher names are in app/, which has no folders (bootstrap.sh copies app/* flat)');
  const tbase = themeMod.normalize({ grid: { cols: 7 }, dock: { count: 6 } }, 'base'), tkid = themeMod.normalize({ grid: { cols: 'many' }, bar: { style: 'round' } }, 'kid', tbase.v);
  ok(tkid.v['grid.cols'] === 7 && tkid.v['dock.count'] === 6 && tkid.v['bar.style'] === 'round', 'a theme that extends another keeps its values where its own are missing or invalid');
  // a stand-in for raw.githubusercontent.com: the repository's folder, plus a few themes that are wrong on purpose
  const tWrong = { kid: JSON.stringify({ name: 'Kid', extends: 'bloom', bar: { style: 'flat' } }), notjson: '{ this is not json', huge: JSON.stringify({ name: 'x'.repeat(40000) }),
    badwall: JSON.stringify({ name: 'Bad wallpaper', effects: { wallpaper: 'w.jpg' } }), orphan: JSON.stringify({ name: 'Orphan', extends: 'missing-base' }) };
  let ghUp = true; const ghHits = [];
  const gh = http.createServer((q, r) => {
    const u = q.url.split('?')[0]; ghHits.push(u);
    const send = (c, b, t) => { r.writeHead(c, { 'content-type': t || 'application/octet-stream' }); r.end(b); };
    if (!ghUp) { q.socket.destroy(); return; }
    let m = /^\/themes\/([a-z0-9-]+)\/theme\.json$/.exec(u); if (m && tWrong[m[1]]) return send(200, tWrong[m[1]]);
    m = /^\/themes\/badwall\/w\.jpg$/.exec(u); if (m) return send(200, Buffer.from('this is not a jpeg at all, just text'));
    const f = path.join(root, u); if (!f.startsWith(tdir + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, 'no');
    send(200, fs.readFileSync(f));
  }).listen(0, '127.0.0.1');
  await new Promise(r => gh.on('listening', r));
  const tlocal = path.join(tmp, 'themes-local'); nc.mkdirp(path.join(tlocal, 'wallpapers')); fs.writeFileSync(path.join(tlocal, 'old.json'), '{}'); fs.writeFileSync(path.join(tlocal, 'wallpapers', 'x.jpg'), 'x');
  process.env.CYTV_THEMES = tlocal; process.env.CYTV_THEMES_URL = 'http://127.0.0.1:' + gh.address().port + '/themes';
  let tconf = {}; const th = themeMod.create({ readConf: () => JSON.parse(JSON.stringify(tconf)), writeConf: c => { tconf = JSON.parse(JSON.stringify(c)); }, noStartup: true });
  ok(!fs.existsSync(path.join(tlocal, 'old.json')) && !fs.existsSync(path.join(tlocal, 'wallpapers')), 'the files of the earlier layout (themes shipped with the service) are removed');
  const tcall = async (act, body, method) => { const x = fake('/api/theme/' + act, method || 'POST'); x.res.raw = null; await th.handle(x.req, x.res, '/api/theme/' + act, async () => body || {}); return { code: x.res.code, j: x.res.out && x.res.out[0] === '{' ? JSON.parse(x.res.out) : x.res.out, body: x.res.out }; };
  r = await tcall('list', null, 'GET');
  ok(r.j.current.id === 'classic' && r.j.themes.length === folders.length && r.j.themes[0].id === 'classic' && r.j.catalogue.ok === true, 'the list comes from themes/index.json on GitHub, Classic first');
  const rb = r.j.themes.find(x => x.id === 'bloom'); ok(rb && rb.installed === false && rb.preview === true && /flower/i.test(rb.description), 'a theme that is not on the TV is listed with its description and screenshot');
  ok(th.resolved().vars['--cols'] === '10' && th.resolved().vars['--tile-h'] === '151px' && th.resolved().vars['--acc'] === '#f5f6f8' && th.resolved().vars['--view-top'] === '300px' && th.resolved().vars['--dock-t'] === '60px' && th.resolved().vars['--grid-t'] === '350px' && th.resolved().cols === 10 && th.resolved().attrs.grid === 'below', 'Classic is built in and resolves to the original positions');
  const gotPv = await new Promise(res => { const x = { out: null }; const rs = { writeHead(c, h) { x.code = c; x.type = h && h['content-type']; }, end(b) { x.out = b; res(x); } }; th.handle({ url: '/api/theme/preview/bloom', method: 'GET', headers: {} }, rs, '/api/theme/preview/bloom', async () => ({})); });
  ok(gotPv.code === 200 && gotPv.type === 'image/jpeg' && Buffer.isBuffer(gotPv.out) && gotPv.out.length > 1000, 'the screenshot is fetched from GitHub and served');
  const hitsBefore = ghHits.length; await new Promise(res => { th.handle({ url: '/api/theme/preview/bloom', method: 'GET', headers: {} }, { writeHead() {}, end() { res(); } }, '/api/theme/preview/bloom', async () => ({})); });
  ok(ghHits.length === hitsBefore, 'a screenshot is kept on the TV and not fetched again');
  r = await tcall('set', { id: 'bloom' }); ok(r.code === 200 && r.j.current.id === 'bloom' && r.j.themes.find(x => x.id === 'bloom').installed === true, 'choosing a theme downloads it and applies it');
  ok(fs.existsSync(path.join(tlocal, 'bloom', 'theme.json')) && fs.existsSync(path.join(tlocal, 'bloom', 'bloom.jpg')), 'the theme file and its wallpaper are kept on the TV');
  const bl = th.resolved();
  ok(bl.wallpaper && bl.wallpaper.id === 'bloom' && bl.wallpaper.file === 'bloom.jpg' && bl.attrs.grid === 'push' && bl.attrs.galign === 'center' && bl.push && bl.push.up > 0 && bl.dockN === 6 && bl.vars['--dock-t'] !== 'auto' && bl.vars['--dock-b'] === 'auto' && bl.vars['--tile-w'] === '193px', 'a dock at the bottom with the push layout resolves to a scrolling grid below it, centred');
  r = await tcall('wallpaper/bloom/bloom.jpg', null, 'GET'); ok(r.code === 200, 'a downloaded wallpaper is served');
  r = await tcall('wallpaper/bloom/other.jpg', null, 'GET'); ok(r.code === 404, 'a file the theme does not name is not served');
  r = await tcall('wallpaper/..%2f..%2fpasswd', null, 'GET'); ok(r.code === 404, 'a path is not served as a wallpaper');
  r = await tcall('set', { id: 'kid' }); ok(r.code === 200 && fs.existsSync(path.join(tlocal, 'kid', 'theme.json')) && th.resolved().attrs.bar === 'flat' && th.resolved().attrs.grid === 'push', 'a theme that extends another one downloads and uses it');
  r = await tcall('set', { id: 'nope' }); ok(r.code === 400 && /unknown theme/.test(r.j.error), 'a theme that is not on GitHub is refused');
  r = await tcall('set', { id: 'notjson' }); ok(r.code === 502 && !fs.existsSync(path.join(tlocal, 'notjson')), 'a theme file that is not JSON is refused and nothing is kept');
  r = await tcall('set', { id: 'huge' }); ok(r.code === 502 && /too large/.test(r.j.error) && !fs.existsSync(path.join(tlocal, 'huge')), 'a theme file over 32 KB is refused');
  r = await tcall('set', { id: 'badwall' }); ok(r.code === 502 && /not an image/.test(r.j.error) && !fs.existsSync(path.join(tlocal, 'badwall')), 'a wallpaper that is not an image is refused and nothing is kept');
  r = await tcall('set', { id: 'orphan' }); ok(r.code === 502 && !fs.existsSync(path.join(tlocal, 'orphan', 'theme.json')), 'a theme whose base theme is missing is refused');
  r = await tcall('set', { id: '../x' }); ok(r.code === 400, 'a bad theme id is refused');
  r = await tcall('set', { accent: 'blue' }); ok(r.code === 400, 'an accent must be a hex colour');
  r = await tcall('set', { id: 'bloom', accent: '#FF8A3D' }); ok(th.resolved().vars['--acc'] === '#ff8a3d' && th.resolved().vars['--acc-ink'] === '#0b0c10' && th.resolved().vars['--focus'] === '#ff8a3d', 'an accent overrides the theme\'s own, with readable text on it');
  r = await tcall('revert'); ok(r.j.current.id === 'bloom' || r.j.current.id === 'kid', 'revert goes back to the previous theme');
  r = await tcall('set', { id: 'lift' }); const lf = th.resolved();
  ok(r.code === 200 && lf.attrs.focus === 'lift' && lf.attrs.tlabel === 'focus' && lf.attrs.gicon === 'center' && lf.attrs.glow === 'top' && lf.attrs.font === 'inter' && lf.vars['--grid-lift'] === '-8px' && lf.vars['--tile-w'] === '313px' && lf.cols === 5 && /^"CYTV Inter"/.test(lf.vars['--font']) && lf.push && lf.push.up > 0, 'Lift resolves to five 16:9 tiles that lift on focus, labels, a top glow and Inter');
  ghUp = false; await th.refreshCatalogue(true);
  r = await tcall('list', null, 'GET'); ok(r.j.catalogue.ok === false && r.j.catalogue.error && r.j.themes.some(x => x.id === 'bloom' && x.installed), 'GitHub unreachable: the list shows the themes on the TV and says why');
  r = await tcall('set', { id: 'bloom' }); ok(r.code === 200 && r.j.current.id === 'bloom', 'GitHub unreachable: a downloaded theme can still be chosen');
  r = await tcall('set', { id: 'midnight' }); ok(r.code === 502 && /could not download/.test(r.j.error), 'GitHub unreachable: a theme that was never downloaded says it could not be downloaded');
  ghUp = true; gh.close();
  // the documentation table is generated from the schema
  const gen = require(path.join(root, 'tools', 'theme-docs.js')), docs = fs.readFileSync(path.join(root, 'docs', 'themes.md'), 'utf8');
  ok(docs.indexOf(gen.table()) >= 0, 'docs/themes.md holds the table generated from the schema (run: node tools/theme-docs.js)');
  delete process.env.CYTV_THEMES; delete process.env.CYTV_THEMES_URL;
  // the service ships no themes
  ok(!/themes/.test(fs.readFileSync(path.join(root, 'ipk', 'build.py'), 'utf8').replace(/#.*$/gm, '')) && !/themes/.test(fs.readFileSync(path.join(root, 'scripts', 'bootstrap.sh'), 'utf8').replace(/#.*$/gm, '')), 'the package build and the setup do not ship or copy themes');

  // restarting the system app manager leaves the media server treating no app as in front (black video everywhere):
  // every restart goes through scripts/restart-sam.sh, which restarts the media server after it
  const shDir = path.join(root, 'scripts'), shText = n => fs.readFileSync(path.join(shDir, n), 'utf8').replace(/#.*$/gm, '');
  const rsam = shText('restart-sam.sh');
  ok(fs.readdirSync(shDir).filter(n => n !== 'restart-sam.sh').every(n => !/systemctl\s+restart\s+sam\b/.test(shText(n))) && rsam.indexOf('systemctl restart umediaserver') > rsam.indexOf('systemctl restart sam') && rsam.indexOf('systemctl restart sam') >= 0,
    'only scripts/restart-sam.sh restarts the app manager, and it restarts the media server after it');

  // 9b. The backdrop photo: picked from Wikimedia Commons' featured nature pictures (a stand-in here), only wide pictures with a licence,
  // served by its own name only, and nothing fetched while the theme does not use it
  const bdMod = require(path.join(helper, 'backdrop'));
  ok(bdMod.plain('<a href="//commons.wikimedia.org/wiki/User:X">Jane &amp; Doe</a>') === 'Jane & Doe' && bdMod.credit({ extmetadata: { Artist: { value: '<b>Jo</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }) === 'Jo \u00B7 CC BY-SA 4.0 \u00B7 Wikimedia Commons' && bdMod.credit({ extmetadata: { Artist: { value: 'Jo' } } }) === '', 'a backdrop credit is plain text, and a picture without a licence gets none');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]), bdHits = [];
  const wm = http.createServer((q, rq) => {
    const full = q.url, send = (b, t) => { rq.writeHead(200, { 'content-type': t || 'application/json' }); rq.end(b); }; bdHits.push(full);
    if (/^\/thumb\//.test(full)) return send(jpeg, 'image/jpeg');
    if (/list=categorymembers/.test(full)) return send(JSON.stringify({ query: { categorymembers: /mountains/.test(full) ? [{ title: 'File:Narrow.jpg' }, { title: 'File:Wide.jpg' }] : [] } }));
    const narrow = /Narrow/.test(decodeURIComponent(full)), base = 'http://127.0.0.1:' + wm.address().port;
    send(JSON.stringify({ query: { pages: [{ imageinfo: [{ width: narrow ? 2000 : 4000, height: narrow ? 3000 : 2400, thumburl: base + '/thumb/' + (narrow ? 'n' : 'w') + '.jpg', extmetadata: { Artist: { value: '<a>Jo</a>' }, LicenseShortName: { value: 'CC0' } } }] }] } }));
  }).listen(0, '127.0.0.1');
  await new Promise(r => wm.on('listening', r));
  process.env.CYTV_BACKDROP_URL = 'http://127.0.0.1:' + wm.address().port + '/w/api.php'; process.env.CYTV_BACKDROP_DIR = path.join(tmp, 'backdrop');
  let bdOn = false; const bd = bdMod.create({ active: () => bdOn, hours: () => 1 });
  const bget = async u => { const x = fake(u, 'GET'); x.res.raw = null; await bd.handle(x.req, x.res, u); return { code: x.res.code, j: x.res.out && x.res.out[0] === '{' ? JSON.parse(x.res.out) : null, out: x.res.out }; };
  let br = await bget('/api/backdrop'); ok(br.j && br.j.off === true && bdHits.length === 0, 'a theme without a backdrop fetches nothing');
  bdOn = true; br = await bget('/api/backdrop'); ok(br.j && br.j.pending === true, 'the first request starts the download and says it is pending');
  await bd.prefetch(); br = await bget('/api/backdrop');
  const f1 = br.j && br.j.file;
  ok(/^bd-\d+\.jpg$/.test(f1 || '') && br.j.credit === 'Jo \u00B7 CC0 \u00B7 Wikimedia Commons' && bdHits.some(h => /\/thumb\/w\.jpg/.test(h)) && !bdHits.some(h => /\/thumb\/n\.jpg/.test(h)), 'a wide picture is downloaded with its credit; a tall one is skipped');
  br = await bget('/api/backdrop/img/' + f1); ok(br.code === 200, 'the picture is served by its name');
  br = await bget('/api/backdrop/img/bd-123456789.jpg'); const br2 = await bget('/api/backdrop/img/..%2fstate.json'); ok(br.code === 404 && br2.code === 404, 'other files are not served');
  await bd.prefetch(); bd.state().cur.at = Date.now() - 2 * 3600000; br = await bget('/api/backdrop');
  ok(br.j.file && br.j.file !== f1 && !fs.existsSync(path.join(tmp, 'backdrop', f1)), 'after the set hours the next picture takes over and the old file is removed');
  await bd.prefetch(); wm.close(); delete process.env.CYTV_BACKDROP_URL; delete process.env.CYTV_BACKDROP_DIR;

  // 9c. Plex On Deck: sign-in with a plex.tv/link code (a stand-in for plex.tv and for the user's server), the token stays in config.json,
  // the page gets titles, progress and pictures through the service, and only library pictures are fetched
  const plexMod = require(path.join(helper, 'plex'));
  const psrv = plexMod.pickServer([{ provides: 'player', connections: [{ uri: 'http://a' }] }, { name: 'Box', provides: 'server', owned: true, clientIdentifier: 'm1', connections: [{ uri: 'https://x.plex.direct:32400', local: true, protocol: 'https', address: '10.0.0.5', port: 32400 }, { uri: 'https://relay', relay: true }] }]);
  ok(psrv && psrv.uri === 'http://10.0.0.5:32400' && psrv.name === 'Box', 'the owned server is used over its local address');
  const plxCard = plexMod.card({ ratingKey: 7, type: 'episode', grandparentTitle: 'Show', title: 'Pilot', parentIndex: 1, index: 2, viewOffset: 300, duration: 1200, thumb: '/library/metadata/7/thumb/99' });
  ok(plxCard.title === 'Show' && /S1 \u00B7 E2 \u00B7 Pilot/.test(plxCard.sub) && plxCard.progress === 0.25 && plxCard.img === '/library/metadata/7/thumb/99' && plexMod.card({ ratingKey: 8, type: 'movie', title: 'M', art: 'http://evil/x' }).img === '', 'an On Deck item becomes a card; a picture outside the library is dropped');
  let plxPolls = 0; const plxHits = [];
  const plxSrv = http.createServer((q, rq) => {
    const u = q.url, send = (o, t) => { rq.writeHead(200, { 'content-type': t || 'application/json' }); rq.end(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o)); }; plxHits.push(q.method + ' ' + u + ' ' + (q.headers['x-plex-token'] || ''));
    if (q.method === 'POST' && /^\/api\/v2\/pins/.test(u)) return send({ id: 42, code: 'AB12', expiresIn: 900 });
    if (/^\/api\/v2\/pins\/42/.test(u)) return send(++plxPolls < 2 ? { id: 42, authToken: null } : { id: 42, authToken: 'TOK' });
    if (/^\/api\/v2\/resources/.test(u)) return send([{ name: 'Home', provides: 'server', owned: true, accessToken: 'SRV', connections: [{ uri: 'http://127.0.0.1:' + plxSrv.address().port, local: true, protocol: 'http' }] }]);
    if (/^\/library\/onDeck/.test(u)) return q.headers['x-plex-token'] === 'SRV' ? send({ MediaContainer: { Metadata: [{ ratingKey: 5, type: 'movie', title: 'Film', year: 2020, viewOffset: 50, duration: 100, art: '/library/metadata/5/art/1' }] } }) : (rq.writeHead(401), rq.end());
    if (/^\/photo\/:\/transcode/.test(u)) return send(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
    rq.writeHead(404); rq.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => plxSrv.on('listening', r));
  process.env.CYTV_PLEXTV_URL = 'http://127.0.0.1:' + plxSrv.address().port;
  let plxConf = {}; const plx = plexMod.create({ readConf: () => JSON.parse(JSON.stringify(plxConf)), writeConf: c => { plxConf = JSON.parse(JSON.stringify(c)); } });
  const plxCall = async (act, method) => { const x = fake('/api/plex/' + act, method || 'GET'); x.res.raw = null; await plx.handle(x.req, x.res, '/api/plex/' + act.split('?')[0], async () => ({})); x.req.url = '/api/plex/' + act; return { code: x.res.code, j: x.res.out && x.res.out[0] === '{' ? JSON.parse(x.res.out) : null, out: x.res.out }; };
  let plxR = await plxCall('status'); ok(plxR.j.state === 'off', 'Plex starts signed out');
  plxR = await plxCall('link', 'POST'); ok(plxR.j.state === 'linking' && plxR.j.code === 'AB12' && /^[0-9a-f]{24}$/.test(plxConf.plex.clientId), 'signing in shows a plex.tv/link code and keeps an id for this TV');
  for (let i = 0; i < 100 && !(plxConf.plex && plxConf.plex.token); i++) await new Promise(r => setTimeout(r, 200));   // the service asks every 3 s; a busy runner is slower
  ok(plxConf.plex.token === 'TOK' && plxConf.plex.serverToken === 'SRV' && plxConf.plex.server.name === 'Home', 'the token arrives once the code is entered, and the server is found');
  plxR = await plxCall('ondeck'); ok(plxR.j.items.length === 1 && plxR.j.items[0].title === 'Film' && plxR.j.items[0].progress === 0.5 && JSON.stringify(plxR.j).indexOf('SRV') < 0 && JSON.stringify(plxR.j).indexOf('TOK') < 0, 'On Deck comes from the server, without the token');
  const plxIx = fake('/api/plex/img?p=' + encodeURIComponent('/library/metadata/5/art/1')); await plx.handle(plxIx.req, plxIx.res, '/api/plex/img', async () => ({}));
  const plxIy = fake('/api/plex/img?p=' + encodeURIComponent('http://evil/x')); await plx.handle(plxIy.req, plxIy.res, '/api/plex/img', async () => ({}));
  ok(plxIx.res.code === 200 && plxIy.res.code === 404, 'pictures come through the service, library pictures only');
  plxR = await plxCall('unlink', 'POST'); ok(plxR.j.state === 'off' && !plxConf.plex.token && plxConf.plex.clientId, 'signing out forgets the token');
  ok(/plex: _p/.test(fs.readFileSync(path.join(helper, 'helper.js'), 'utf8')), 'the launcher\'s copy of the settings leaves out the Plex token');
  plxSrv.close(); delete process.env.CYTV_PLEXTV_URL;

  // 9d. The hero layout's panel: the rain forecast (a stand-in for Open-Meteo) and Home Assistant lights (a stand-in for Home Assistant);
  // the place comes from the phone page or Home Assistant, the token never reaches the page, only lights can be switched
  const homeMod = require(path.join(helper, 'home'));
  ok(homeMod.summary([{ t: '20:00', mm: 0 }, { t: '21:00', mm: 0 }, { t: '22:00', mm: 0.4 }]) === 'Rain from 22:00' && homeMod.summary([{ t: '20:00', mm: 1 }, { t: '21:00', mm: 0 }]) === 'Raining, dry by 21:00' && homeMod.summary([{ t: '20:00', mm: 0 }, { t: '21:00', mm: 0.05 }]) === 'Dry for the next 2 hours', 'the forecast line says when rain starts or stops');
  const hmHits = [];
  const hmSrv = http.createServer((q, rq) => {
    let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
      hmHits.push(q.method + ' ' + q.url + ' ' + (q.headers.authorization || '') + ' ' + b);
      const send = (o, code) => { rq.writeHead(code || 200, { 'content-type': 'application/json' }); rq.end(JSON.stringify(o)); };
      if (/^\/v1\/search/.test(q.url)) return send(/name=Nowhere/.test(q.url) ? { results: [] } : { results: [{ name: 'Ghent', latitude: 51.05, longitude: 3.72 }] });
      if (/^\/v1\/forecast/.test(q.url)) return send({ current: { time: '2026-10-25T20:15', temperature_2m: 12.4, weather_code: 3 }, hourly: { time: ['2026-10-25T19:00', '2026-10-25T20:00', '2026-10-25T21:00', '2026-10-25T22:00'], temperature_2m: [13, 12.4, 11.6, 11], precipitation: [0, 0, 0, 0.8], precipitation_probability: [0, 5, 20, 80], weather_code: [3, 3, 3, 61] } });
      if (q.url === '/api/config') return q.headers.authorization === 'Bearer HATOK' ? send({ latitude: 50.85, longitude: 4.35, location_name: 'Home' }) : send({}, 401);
      if (q.url === '/api/states') return send([{ entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen' } }, { entity_id: 'light.living', state: 'on', attributes: { friendly_name: 'Living room', brightness: 178 } }, { entity_id: 'light.hall', state: 'unavailable', attributes: {} }, { entity_id: 'switch.boiler', state: 'on', attributes: {} }]);
      if (/^\/api\/services\/light\//.test(q.url)) return send([]);
      send({}, 404);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => hmSrv.on('listening', r));
  const hmBase = 'http://127.0.0.1:' + hmSrv.address().port; process.env.CYTV_METEO_URL = hmBase; process.env.CYTV_GEO_URL = hmBase;
  let hmConf = {}; const hm = homeMod.create({ readConf: () => JSON.parse(JSON.stringify(hmConf)), writeConf: c => { hmConf = JSON.parse(JSON.stringify(c)); } });
  const hmCall = async (u, method, b) => { const x = fake(u, method || 'GET'); await hm.handle(x.req, x.res, u, async () => b || {}); return { code: x.res.code, j: JSON.parse(x.res.out || '{}'), out: x.res.out }; };
  let hmR = await hmCall('/api/weather'); ok(hmR.j.off === true && hmHits.length === 0, 'no place and no Home Assistant: no forecast and nothing fetched');
  hmR = await hmCall('/api/lights'); ok(hmR.j.off === true, 'no Home Assistant: no lights');
  hmConf = { voice: { ha: { url: hmBase, token: 'HATOK' } } };
  hmR = await hmCall('/api/weather');
  ok(hmR.j.place === 'Home' && hmHits.some(h => /latitude=50\.85&longitude=4\.35/.test(h)) && hmR.j.hours[0].t === '20:00' && hmR.j.hours.length === 3 && hmR.j.now.temp === 12 && hmR.j.summary === 'Rain from 22:00' && hmR.j.hours[2].kind === 'rain', 'without a place the forecast is for Home Assistant\'s location, from this hour on');
  hmConf.weather = { place: 'Ghent' };
  await hmCall('/api/weather').then(() => {}); hmR = await hmCall('/api/weather');
  ok(hmR.j.place === 'Ghent' && hmConf.weather.lat === 51.05 && hmConf.weather.for === 'Ghent' && hmHits.some(h => /latitude=51\.05/.test(h)) && hmHits.filter(h => /\/v1\/search/.test(h)).length === 1, 'a typed place is looked up once and kept');
  hmConf.weather = { place: 'Nowhere' }; hmR = await hmCall('/api/weather'); ok(hmR.j.stale === true || !!hmR.j.error, 'a place that is not found does not break the panel');
  hmR = await hmCall('/api/lights');
  ok(hmR.j.items.length === 3 && hmR.j.items[0].name === 'Hall' && hmR.j.items[0].off === true && hmR.j.items[2].name === 'Living room' && hmR.j.items[2].on && hmR.j.items[2].level === 70 && hmR.out.indexOf('HATOK') < 0 && hmR.out.indexOf('boiler') < 0, 'the lights are listed by name with their state, without the token or other devices');
  hmR = await hmCall('/api/lights/toggle', 'POST', { id: 'light.kitchen' }); ok(hmR.code === 200 && hmHits.some(h => /^POST \/api\/services\/light\/toggle Bearer HATOK \{"entity_id":"light.kitchen"\}/.test(h)), 'OK on a light toggles it in Home Assistant');
  hmR = await hmCall('/api/lights/toggle', 'POST', { id: 'switch.boiler' }); ok(hmR.code === 400 && !hmHits.some(h => /boiler/.test(h) && /^POST/.test(h)), 'only lights can be switched');
  hmR = await hmCall('/api/lights/off', 'POST'); ok(hmR.code === 200 && hmHits.some(h => /^POST \/api\/services\/light\/turn_off Bearer HATOK \{"entity_id":"all"\}/.test(h)), 'All off switches every light off');
  hmSrv.close(); delete process.env.CYTV_METEO_URL; delete process.env.CYTV_GEO_URL;
  const heroTh = themeMod.normalize({ home: { layout: 'hero' }, hero: { w: 1040, y: 136 }, dock: { anchor: 'bottom' } }, 'herotest');
  ok(heroTh.v['home.layout'] === 'hero' && heroTh.v['hero.live'] === true && themeMod.normalize({ home: { layout: 'grid' } }, 'x').v['home.layout'] === 'dock', 'the hero layout is a theme setting; an unknown layout keeps the dock');
  ok(/name=wplace/.test(fs.readFileSync(path.join(helper, 'voice.js'), 'utf8')), 'the phone setup page asks for the place of the weather');

  // 10. The picker keepalive stops when the system keeps closing the hidden picker (issue 5)
  const pickerMod = require(path.join(helper, 'picker'));
  let pkClock = 1000, pkLaunches = 0, pkRunning = [], pkSaved = {};
  const pluna = async uri => { if (/getPowerState/.test(uri)) return { state: 'Active' }; if (/running/.test(uri)) return { running: pkRunning }; if (/getAppInfo/.test(uri)) return { returnValue: true }; if (/launch/.test(uri)) { pkLaunches++; return { returnValue: true }; } return {}; };
  const pkMake = () => { pkLaunches = 0; pkSaved = {}; pkClock = 1000; return pickerMod.make(pluna, () => true, { get: () => pkSaved, set: v => { pkSaved = v; } }, () => pkClock); };
  let pkTick = pkMake();
  await pkTick(); ok(pkLaunches === 1, 'the picker is started once when it is not running');
  pkClock += 5000; await pkTick(); ok(pkLaunches === 1, 'it is not started again while it is still starting');
  pkClock += 25000; await pkTick(); pkClock += 30000; await pkTick(); ok(pkLaunches === 3 && pkSaved.prewarm === undefined, 'a picker that vanishes is started again');
  pkClock += 30000; const r10 = await pkTick(); ok(pkLaunches === 3 && pkSaved.prewarm === false && r10 === true && /keeps closing/.test(pkSaved.reason), 'three starts in ten minutes: prewarming is switched off and saved');
  pkClock += 60000; await pkTick(); await pkTick(); ok(pkLaunches === 3, 'it is never started again while switched off');
  pkTick = pkMake(); await pkTick();   // it is listed as running for a moment after every start, then closed: that still counts
  for (let i = 0; i < 4; i++) { pkRunning = [{ id: 'com.cleanyourtv.picker' }]; pkClock += 5000; await pkTick(); pkRunning = []; pkClock += 40000; await pkTick(); }
  ok(pkSaved.prewarm === false && pkLaunches === 3, 'a picker that is listed once after each start but then closed still ends up switched off');
  pkTick = pkMake(); pkRunning = [{ appId: 'com.cleanyourtv.picker' }]; await pkTick(); pkClock += 3600000; await pkTick(); await pkTick();
  ok(pkLaunches === 0 && pkSaved.prewarm === undefined, 'a picker that stays running (listed by id or appId) is never started');
  pkTick = pkMake(); pkRunning = []; await pkTick(); pkClock += 15 * 60000; await pkTick(); pkClock += 15 * 60000; await pkTick(); pkClock += 15 * 60000; await pkTick();
  ok(pkLaunches === 4 && pkSaved.prewarm === undefined, 'a start every quarter of an hour (standby, wake) is normal and stays on');
  pkTick = pkMake(); pkSaved = { prewarm: true }; await pkTick(); ok(pkLaunches === 1, 'switching it back on in the manager starts it again');

  ok(pickerMod.modeOf({}, 10) === 'overlay' && pickerMod.modeOf({}, 25) === 'overlay' && pickerMod.modeOf({}, 6) === 'ondemand' && pickerMod.modeOf({}, 0) === 'ondemand', 'the picker is kept ready on webOS 10 and newer and started when pressed before that');
  ok(pickerMod.modeOf({ mode: 'overlay' }, 6) === 'overlay' && pickerMod.modeOf({ mode: 'launcher' }, 25) === 'launcher' && pickerMod.modeOf({ mode: 'ondemand' }, 25) === 'ondemand' && pickerMod.modeOf({ mode: 'x' }, 6) === 'ondemand', 'a saved choice wins over the default');
  pkTick = pkMake(); pkRunning = []; await pkTick(); pkClock += 40000; await pkTick(); pkClock += 40000; await pkTick(); pkClock += 40000; await pkTick();
  ok(pkSaved.mode === 'ondemand' && pkSaved.prewarm === false, 'when the system keeps closing the picker it is started when pressed instead');

  let psynced = 0, pconf = {};
  m = mgr.create({ luna: async () => ({}), readConf: () => JSON.parse(JSON.stringify(pconf)), writeConf: c => { pconf = JSON.parse(JSON.stringify(c)); }, inputhook: { status: () => ({}), ensure() {} }, VERSION: '1.5.13', pickerShown: () => 0, pickerMode: () => (pconf.picker || {}).mode || 'launcher', syncPickerMode: () => { psynced++; } });
  r = await ask('options', 'POST', { pickerMode: 'overlay' }); ok(r.j.picker.mode === 'overlay' && pconf.picker.prewarm === true && psynced > 0, 'choosing the overlay in the manager is saved and the Input key script is told');
  r = await ask('options', 'POST', { pickerMode: 'ondemand' }); ok(r.j.picker.mode === 'ondemand', 'choosing the on-demand picker');
  r = await ask('options', 'POST', { pickerMode: 'launcher' }); ok(r.j.picker.mode === 'launcher', 'choosing the launcher\'s list');
  r = await ask('options', 'POST', { pickerMode: 'sideways' }); ok(r.j.picker.mode === 'launcher', 'an unknown mode is ignored');
  let keyOn = true; m = mgr.create({ luna: async () => ({}), readConf: () => ({}), writeConf() {}, inputhook: { status: () => ({}), ensure(on) { keyOn = on; } }, VERSION: '1.5.13', pickerShown: () => 0, pickerMode: () => 'launcher', syncPickerMode() {}, inputKeyOn: () => false });
  r = await ask('options', 'POST', { liveTv: true }); ok(keyOn === false && r.j.picker.released === true, 'the Input key is released to LG when its target needs CleanYourTV as Home and LG\'s Home is selected');
  // 11. Diagnostics: child processes with their own timeout; the last operations survive a process that died
  process.env.CYTV_RUNFILE = path.join(tmp, 'run.json');
  const diag = require(path.join(helper, 'diag'));
  const dx = (cmd, args, o) => new Promise(res => diag.execFile(cmd, args, o || {}, (e, out, err) => res({ e, out, err })));
  let dr = await dx('/bin/sh', ['-c', 'echo hi; echo oops 1>&2']); ok(dr.e === null && dr.out === 'hi\n' && dr.err === 'oops\n', 'execFile returns stdout and stderr');
  dr = await dx('/bin/sh', ['-c', 'exit 3']); ok(dr.e && dr.e.code === 3, 'a failing command reports its exit code');
  const t0 = Date.now(); dr = await dx('/bin/sh', ['-c', 'sleep 5'], { timeout: 300 }); ok(dr.e && dr.e.killed === true && Date.now() - t0 < 2000, 'a command that takes too long is killed once and reported');
  dr = await dx('/nonexistent/command', []); ok(dr.e && /ENOENT/.test(String(dr.e.code || dr.e.message)), 'a missing command is reported');
  dr = await dx('/bin/sh', ['-c', 'head -c 3000000 /dev/zero | tr "\\0" "a"'], { maxBuffer: 1000 }); ok(dr.e === null && dr.out.length >= 1000 && dr.out.length < 200000, 'output beyond maxBuffer is dropped, not a crash');
  diag.note('request', 'GET http://192.168.1.3:36400/live/user/secret/123.m3u8');
  ok(diag.ops().some(x => /\/live\/\*\/\*\/123/.test(x)) && !diag.ops().some(x => /secret/.test(x)), 'logged operations hide the credentials of a stream address');
  fs.writeFileSync(process.env.CYTV_RUNFILE, JSON.stringify({ pid: 999999, started: 1790000000, ops: ['1790000001 exec luna-send -n 1', '1790000002 request GET http://x/y'] }));
  const logged = []; const oe = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  diag.start(); console.error = oe;
  ok(logged.length === 1 && /ended without a clean exit/.test(logged[0]) && /luna-send/.test(logged[0]), 'a start that finds the file of a dead process logs its last operations');
  ok(JSON.parse(fs.readFileSync(process.env.CYTV_RUNFILE, 'utf8')).pid === process.pid, 'the file now belongs to the running process');

  // 12. A connection that drops after the headers must end an update check or a playlist read with an error, never hang (issue 5)
  const drop = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json', 'content-length': '100000' }); r.write('{"tag_name": "v9.9.9", "assets": ['); setTimeout(() => r.socket.destroy(), 150); }).listen(0, '127.0.0.1');
  await new Promise(r => drop.on('listening', r));
  const savedApi = process.env.CYTV_API; process.env.CYTV_API = 'http://127.0.0.1:' + drop.address().port;
  start('1.5.3'); const tdrop = Date.now(); r = await ask('check', 'POST');
  ok(Date.now() - tdrop < 6000 && r.j.checkError && r.j.checking === false, 'an update check on a connection that drops mid-answer ends with an error');
  process.env.CYTV_API = savedApi;
  f = fake('/api/live/settings', 'POST'); await live.handle(f.req, f.res, '/api/live/settings', async () => ({ playlistUrl: 'http://127.0.0.1:' + drop.address().port + '/pl.m3u' }));
  let lerr = ''; for (let i = 0; i < 40 && !lerr; i++) { await new Promise(r => setTimeout(r, 150)); f = fake('/api/live/status'); await live.handle(f.req, f.res, '/api/live/status', async () => ({})); const js = JSON.parse(f.res.out); if (js.state === 'idle' && js.error) lerr = js.error; }
  ok(/lost|closed|reset|socket/i.test(lerr), 'a playlist read on a connection that drops mid-answer ends with an error' + (lerr ? '' : ' (it hung)'));
  f = fake('/api/live/reset', 'POST'); await live.handle(f.req, f.res, '/api/live/reset', async () => ({})); drop.close();
  // 14. The favourite star and the menus' right-hand text both had the class st: the star's 26 px width squeezed the menu text into a column
  const launcherHtml = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  ok(!/(^|\n)\.st\{/.test(launcherHtml) && /svg\.st\{width:26px/.test(launcherHtml), 'the favourite star is styled as svg.st, so the menu\'s .st text keeps its natural width');
  // 14b. A dock entry may be an external input ("input:HDMI_3") next to the plain app ids. The helpers that resolve one are
  // marked in the page so they can be run here, without a browser: see the input-dock-start/end comments in app/index.html.
  const dockStart = launcherHtml.indexOf('/* input-dock-start */'), dockEnd = launcherHtml.indexOf('/* input-dock-end */');
  ok(dockStart > 0 && dockEnd > dockStart, 'the dock entry helpers are marked, so they can be run outside the browser');
  const dockCtx = {}; vm.createContext(dockCtx);
  vm.runInContext(launcherHtml.slice(dockStart, dockEnd), dockCtx);
  const hdmi3 = { id: 'HDMI_3', port: 3, label: 'TelenetTV Box', appId: 'com.webos.app.hdmi3', hdmiPlugIn: true };
  ok(dockCtx.isInputEntry('input:HDMI_3') && !dockCtx.isInputEntry('netflix') && !dockCtx.isInputEntry(null) && !dockCtx.isInputEntry(42), 'only a string with the input: prefix is an input dock entry');
  const a3 = dockCtx.inputApp('input:HDMI_3', [hdmi3], true);
  ok(a3 && a3.appId === 'com.webos.app.hdmi3' && a3.title === 'TelenetTV Box' && a3.input === true, 'an input entry resolves to the device it names, with the name the TV shows for it');
  ok(dockCtx.inputApp('input:HDMI_3', [], true) === null, 'an input the TV no longer lists drops out of the dock instead of leaving a dead tile');
  const early = dockCtx.inputApp('input:HDMI_3', [], false);
  ok(early && early.title === 'HDMI 3' && early.appId === '', 'before the input list arrives the entry keeps its place and shows the port');
  ok(dockCtx.inputApp('netflix', [hdmi3], true) === null, 'an app id is never resolved as an input');
  const unlabelled = dockCtx.inputApp('input:HDMI_4', [{ id: 'HDMI_4', port: 4, label: '', appId: 'com.webos.app.hdmi4' }], true);
  ok(unlabelled && unlabelled.title === 'HDMI 4', 'an input with no name of its own is shown by its port');
  ok(/if\(a\.input\)\{/.test(launcherHtml) && /launch\(a\.appId\|\|a\.id\)/.test(launcherHtml), 'an input tile draws the HDMI glyph and opens the input app, not the entry id');
  ok(/function title\(id\)\{if\(isInputEntry\(id\)\)/.test(launcherHtml), 'the "replace which app?" list names an input entry by its own name');
  // 15. The QR code in the manager opens a short-lived page on the TV that shows the notification address and token
  const freePort = await new Promise(res => { const x = http.createServer(); x.listen(0, '127.0.0.1', () => { const pp = x.address().port; x.close(() => res(pp)); }); });
  let nconf = { notifyApi: { enabled: false, port: freePort, token: '', allow: [] } };
  const napiMod = require(path.join(helper, 'notifyapi')).create({ notify: { handle: async () => {} }, readConf: () => JSON.parse(JSON.stringify(nconf)), writeConf: c => { nconf = JSON.parse(JSON.stringify(c)); } });
  let ninfo = napiMod.set({ page: true }); ok(!ninfo.pageUrl, 'no token page while notifications are off');
  ninfo = napiMod.set({ enabled: true }); ok(ninfo.enabled && ninfo.token.length >= 32 && ninfo.listening, 'notifications on: a token is made and the listener runs');
  const getPage = (p2) => new Promise(res => { const rq = nc.get(http, 'http://127.0.0.1:' + freePort + p2, { timeout: 4000 }, rs => { let b = ''; rs.on('data', c => b += c); rs.on('end', () => res({ code: rs.statusCode, body: b, type: rs.headers['content-type'] })); }); rq.on('error', e => res({ code: 0, body: String(e) })); });
  process.env.CYTV_NOTIFY_PAGE_MS = '1500';
  ninfo = napiMod.set({ page: true }); const pagePath = ninfo.pageUrl.replace(/^http:\/\/[^/]+/, '');
  ok(/^http:\/\/.*:\d+\/t\/[0-9a-f]{24}$/.test(ninfo.pageUrl) && ninfo.pageSeconds === 2 || ninfo.pageSeconds === 1, 'the QR code points at a page with a random address');
  let pg = await getPage(pagePath); ok(pg.code === 200 && /text\/html/.test(pg.type) && pg.body.indexOf(ninfo.token) >= 0 && /Authorization: Bearer /.test(pg.body), 'the page shows the address and the token');
  ok(!/<script src|http:\/\/[^"' ]+\.js/.test(pg.body) && pg.body.indexOf('<') >= 0, 'the page is self-contained');
  pg = await getPage('/t/' + '0'.repeat(24)); ok(pg.code === 401, 'a wrong page address is treated like a wrong token');
  pg = await getPage('/notify'); ok(pg.code === 401, 'the notification address itself still needs the token');
  await new Promise(r => setTimeout(r, 1700)); pg = await getPage(pagePath); ok(pg.code === 401, 'the page stops working after its time');
  ninfo = napiMod.set({ page: true }); nconf.notifyApi.allow = ['10.0.0.0/24']; pg = await getPage('/t/' + ninfo.pageUrl.split('/t/')[1]); ok(pg.code === 403, 'the allow list applies to the page too');
  delete process.env.CYTV_NOTIFY_PAGE_MS; napiMod.set({ enabled: false });

  console.log(failed ? '\n' + failed + ' check(s) failed on Node ' + process.version : '\nall checks passed on Node ' + process.version);
  fs.rmSync ? fs.rmSync(tmp, { recursive: true, force: true }) : cp.spawnSync('rm', ['-rf', tmp]);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('error:', e); process.exit(1); });
