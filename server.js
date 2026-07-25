const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');

const PORT = Number(process.env.PORT || 8798);
const ROOT = __dirname;
const STORE_FILE = path.join(ROOT, 'data', 'store.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const loginAttempts = new Map();

const seed = {
  tenants: [
    { id: 'salon-lumiere', name: 'Salon Lumiere 青山店', plan: 'トライアル' },
    { id: 'salon-bloom', name: 'Hair Bloom 吉祥寺店', plan: 'スタンダード' }
  ],
  users: [
    { id: 'u1', tenantId: 'salon-lumiere', name: '佐藤 美咲', email: 'owner@lumiere.jp', password: 'demo123', role: 'owner' },
    { id: 'u2', tenantId: 'salon-lumiere', name: '鈴木 彩', email: 'staff@lumiere.jp', password: 'demo123', role: 'staff' },
    { id: 'u3', tenantId: 'salon-bloom', name: '田中 実', email: 'owner@bloom.jp', password: 'demo123', role: 'owner' }
  ],
  templates: [{
    id: 'tpl1', tenantId: 'salon-lumiere', name: 'フェイシャル初回カルテ', updatedAt: '2026-07-24', active: true,
    fields: [
      { id: 'name', label: 'お名前', type: 'text', x: 7, y: 8, w: 42, h: 8, required: true, alert: false },
      { id: 'visitDate', label: '来店日', type: 'date', x: 55, y: 8, w: 36, h: 8, required: true, alert: false },
      { id: 'concern', label: 'お悩み・ご要望', type: 'textarea', x: 7, y: 24, w: 84, h: 14, required: false, alert: false },
      { id: 'allergy', label: 'アレルギー', type: 'textarea', x: 7, y: 44, w: 40, h: 12, required: false, alert: true },
      { id: 'redness', label: '赤み・刺激', type: 'textarea', x: 51, y: 44, w: 40, h: 12, required: false, alert: true },
      { id: 'treatment', label: '施術内容', type: 'textarea', x: 7, y: 63, w: 84, h: 12, required: true, alert: false },
      { id: 'preference', label: '好み・申し送り', type: 'textarea', x: 7, y: 81, w: 84, h: 11, required: false, alert: true }
    ]
  }],
  customers: [
    { id: 'c1', tenantId: 'salon-lumiere', name: '山田 花子', kana: 'ヤマダ ハナコ', phone: '090-1234-5678', lastVisit: '2026-06-28', alerts: ['アルコール成分で赤みが出やすい', 'ラテックスアレルギー'], preferences: ['弱めのマッサージ', '無香料を希望'] },
    { id: 'c2', tenantId: 'salon-lumiere', name: '高橋 結衣', kana: 'タカハシ ユイ', phone: '080-2222-7731', lastVisit: '2026-07-12', alerts: ['肌が乾燥しやすい'], preferences: ['温かめのタオル'] },
    { id: 'c3', tenantId: 'salon-lumiere', name: '小林 恵', kana: 'コバヤシ メグミ', phone: '070-9898-1122', lastVisit: '2026-05-19', alerts: [], preferences: ['静かな接客を希望'] }
  ],
  records: [
    { id: 'r1', tenantId: 'salon-lumiere', customerId: 'c1', visitDate: '2026-06-28', staff: '佐藤 美咲', templateId: 'tpl1', values: { concern: '頬の乾燥とくすみ', allergy: 'ラテックス', redness: 'アルコール成分で赤み', treatment: '保湿フェイシャル60分、低刺激パック', preference: 'マッサージは弱め、無香料希望' }, alerts: ['ラテックスアレルギー', 'アルコール成分で赤みが出やすい'], note: '施術後の赤みなし。保湿状態良好。', createdAt: '2026-06-28T10:30:00+09:00' },
    { id: 'r2', tenantId: 'salon-lumiere', customerId: 'c1', visitDate: '2026-04-10', staff: '鈴木 彩', templateId: 'tpl1', values: { concern: '春先の乾燥', treatment: '敏感肌コース45分', preference: '無香料' }, alerts: ['アルコール成分で赤みが出やすい'], note: 'Tゾーンを避けて保湿。', createdAt: '2026-04-10T14:00:00+09:00' }
  ]
};

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch { fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true }); fs.writeFileSync(STORE_FILE, JSON.stringify(seed, null, 2)); return structuredClone(seed); }
}
let db;
let storageMode = 'starting';
const save = () => storage.saveData(db);
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if (s.length > 22_000_000) reject(new Error('ファイルが大きすぎます')); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON形式が不正です')); } }); });
const tokenOf = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const auth = async req => { const userId = await storage.findSession(tokenOf(req)); return db.users.find(u => u.id === userId); };
const tenantRows = (name, user) => db[name].filter(x => x.tenantId === user.tenantId);
const id = prefix => prefix + crypto.randomUUID().slice(0, 8);

function safeUser(user) { const { password, passwordHash, ...rest } = user; return { ...rest, tenant: db.tenants.find(t => t.id === user.tenantId) }; }
function loginAllowed(ip) { const now = Date.now(), recent = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000); loginAttempts.set(ip, recent); return recent.length < 10; }
function recordLoginFailure(ip) { loginAttempts.set(ip, [...(loginAttempts.get(ip) || []), Date.now()]); }
function outputText(result) { return result.output_text || (result.output || []).flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text || ''; }
function parseModelJson(text) { const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim(); return JSON.parse(cleaned); }

async function runOcr(image, template) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。デモ読取をご利用ください。'), { status: 503 });
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image || '')) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を選択してください。'), { status: 400 });
  const fieldGuide = template.fields.map(f => `- ${f.id}: ${f.label}（種類:${f.type}、範囲:x${f.x}% y${f.y}% w${f.w}% h${f.h}%）`).join('\n');
  const prompt = `日本語の手書きサロンカルテを読み取ってください。指定範囲を優先し、推測できない値は空文字にします。JSON以外は出力しません。\n項目:\n${fieldGuide}\n出力形式: {"values":{"項目ID":"読取値"},"confidence":{"項目ID":0から1},"alerts":["アレルギー、赤み、禁忌、注意すべき内容"],"customerName":"氏名","visitDate":"YYYY-MM-DD"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image, detail: 'original' }] }] }) });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function api(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!loginAllowed(ip)) return json(res, 429, { error: 'ログイン試行回数が多すぎます。15分後にお試しください' });
    const b = await body(req); const email = String(b.email || '').toLowerCase();
    const candidates = db.users.filter(x => x.email.toLowerCase() === email && (!b.tenantId || x.tenantId === b.tenantId));
    const verified = (await Promise.all(candidates.map(async user => ({ user, valid: await storage.verifyPassword(user, b.password) })))).filter(x => x.valid).map(x => x.user);
    if (!verified.length) { recordLoginFailure(ip); return json(res, 401, { error: 'メールアドレスまたはパスワードが違います' }); }
    if (!b.tenantId && verified.length > 1) return json(res, 409, { error: 'ログインする店舗を選択してください', code: 'TENANT_SELECTION_REQUIRED', tenants: verified.map(user => ({ id: user.tenantId, name: db.tenants.find(t => t.id === user.tenantId)?.name || user.tenantId })) });
    const user = verified[0];
    loginAttempts.delete(ip); const token = await storage.createSession(user.id); return json(res, 200, { token, user: safeUser(user) });
  }
  if (req.method === 'POST' && pathname === '/api/logout') { await storage.deleteSession(tokenOf(req)); return json(res, 204, {}); }
  const user = await auth(req); if (!user) return json(res, 401, { error: 'ログインが必要です' });
  if (pathname === '/api/me') return json(res, 200, safeUser(user));
  if (pathname === '/api/dashboard') {
    const customers = tenantRows('customers', user), records = tenantRows('records', user);
    return json(res, 200, { customers: customers.length, recordsThisMonth: records.filter(r => r.visitDate.startsWith(new Date().toISOString().slice(0, 7))).length, alerts: customers.filter(c => c.alerts.length).length, recent: [...records].sort((a,b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5).map(r => ({ ...r, customer: customers.find(c => c.id === r.customerId) })) });
  }
  if (pathname === '/api/customers' && req.method === 'GET') return json(res, 200, tenantRows('customers', user));
  if (pathname === '/api/customers' && req.method === 'POST') { const b = await body(req); const row = { id: id('c'), tenantId: user.tenantId, name: b.name, kana: b.kana || '', phone: b.phone || '', lastVisit: '', alerts: b.alerts || [], preferences: b.preferences || [] }; db.customers.push(row); await save(); return json(res, 201, row); }
  const cm = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (cm && req.method === 'GET') { const customer = tenantRows('customers', user).find(x => x.id === cm[1]); if (!customer) return json(res, 404, { error: '顧客が見つかりません' }); return json(res, 200, { customer, records: tenantRows('records', user).filter(r => r.customerId === customer.id).sort((a,b) => b.visitDate.localeCompare(a.visitDate)) }); }
  if (pathname === '/api/templates' && req.method === 'GET') return json(res, 200, tenantRows('templates', user));
  if (pathname === '/api/templates' && req.method === 'POST') { if (user.role !== 'owner') return json(res, 403, { error: 'オーナー権限が必要です' }); const b = await body(req); const row = { id: id('tpl'), tenantId: user.tenantId, name: b.name || '新しいカルテ', active: true, updatedAt: new Date().toISOString().slice(0,10), fields: b.fields || [] }; db.templates.push(row); await save(); return json(res, 201, row); }
  const tm = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (tm && req.method === 'PUT') { if (user.role !== 'owner') return json(res, 403, { error: 'オーナー権限が必要です' }); const row = tenantRows('templates', user).find(x => x.id === tm[1]); if (!row) return json(res, 404, { error: 'テンプレートが見つかりません' }); Object.assign(row, await body(req), { id: row.id, tenantId: row.tenantId, updatedAt: new Date().toISOString().slice(0,10) }); await save(); return json(res, 200, row); }
  if (pathname === '/api/ocr' && req.method === 'POST') { const b = await body(req); const template = tenantRows('templates', user).find(x => x.id === b.templateId); if (!template) return json(res, 404, { error: 'テンプレートが見つかりません' }); return json(res, 200, await runOcr(b.image, template)); }
  if (pathname === '/api/ocr/demo' && req.method === 'POST') return json(res, 200, { customerName: '山田 花子', visitDate: new Date().toISOString().slice(0,10), values: { name: '山田 花子', visitDate: new Date().toISOString().slice(0,10), concern: '頬の乾燥、夕方のくすみが気になる', allergy: 'ラテックスアレルギーあり', redness: 'アルコール配合化粧水で赤みが出やすい', treatment: '保湿フェイシャル 60分', preference: '香りのない製品、マッサージは弱め希望' }, confidence: { name: .98, visitDate: .96, concern: .87, allergy: .93, redness: .84, treatment: .91, preference: .86 }, alerts: ['ラテックスアレルギー', 'アルコール成分で赤みが出やすい'] });
  if (pathname === '/api/records' && req.method === 'POST') { const b = await body(req); const customer = tenantRows('customers', user).find(c => c.id === b.customerId); if (!customer) return json(res, 400, { error: '顧客を選択してください' }); const row = { id: id('r'), tenantId: user.tenantId, customerId: customer.id, visitDate: b.visitDate || new Date().toISOString().slice(0,10), staff: user.name, templateId: b.templateId, values: b.values || {}, alerts: b.alerts || [], note: b.note || '', createdAt: new Date().toISOString() }; db.records.push(row); customer.lastVisit = row.visitDate; customer.alerts = [...new Set([...(customer.alerts || []), ...row.alerts])]; await save(); return json(res, 201, row); }
  return json(res, 404, { error: 'APIが見つかりません' });
}

function staticFile(res, pathname) {
  const wanted = pathname === '/' ? 'index.html' : pathname.slice(1); const file = path.normalize(path.join(ROOT, 'public', wanted));
  if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml' }; const headers = { 'Content-Type': types[ext] || 'application/octet-stream' }; if (['.html','.css','.js'].includes(ext)) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'; res.writeHead(200, headers); res.end(data); });
}
const server = http.createServer(async (req, res) => { try {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/healthz') return json(res, 200, { status: 'ok', ...(await storage.health()) });
  if (pathname.startsWith('/api/')) await api(req, res, pathname); else staticFile(res, pathname);
} catch (e) { console.error(e); json(res, e.status || 500, { error: e.message || 'サーバーエラー' }); } });

async function start() {
  if (IS_PRODUCTION && !process.env.DATABASE_URL && process.env.ALLOW_JSON_IN_PRODUCTION !== 'true') throw new Error('本番環境には DATABASE_URL が必要です');
  let initial;
  if (!IS_PRODUCTION || process.env.SEED_DEMO_DATA === 'true') initial = loadStore();
  else {
    const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD, salonName = process.env.SALON_NAME;
    if (!email || !password || !salonName) throw new Error('本番初期化には ADMIN_EMAIL、ADMIN_PASSWORD、SALON_NAME が必要です');
    if (password.length < 12) throw new Error('ADMIN_PASSWORD は12文字以上にしてください');
    const tenantId = 'tenant-primary';
    initial = {
      tenants: [{ id: tenantId, name: salonName, plan: 'スタンダード' }],
      users: [{ id: 'owner-primary', tenantId, name: process.env.ADMIN_NAME || 'オーナー', email, password, role: 'owner' }],
      templates: [{ ...structuredClone(seed.templates[0]), id: 'template-primary', tenantId, name: '標準フェイシャルカルテ' }],
      customers: [], records: []
    };
  }
  const initialized = await storage.initStorage(ROOT, initial);
  db = initialized.data; storageMode = initialized.mode;
  await provisionStoresFromEnvironment();
  server.listen(PORT, '0.0.0.0', () => console.log(`SalonRecord started on port ${PORT} (${storageMode})`));
}

async function provisionStoresFromEnvironment() {
  let stores;
  if (process.env.PROVISION_STORES_JSON) {
    try { stores = JSON.parse(process.env.PROVISION_STORES_JSON); } catch { throw new Error('PROVISION_STORES_JSON が正しいJSONではありません'); }
  } else if (IS_PRODUCTION && process.env.ADMIN_EMAIL) {
    stores = [
      { name: 'Lycon渋谷店', adminName: 'Aska1', email: process.env.ADMIN_EMAIL },
      { name: 'Lycon代官山店', adminName: 'Aska2', email: process.env.ADMIN_EMAIL }
    ];
  } else return;
  if (!Array.isArray(stores) || !stores.length) return;
  let changed = false;
  for (let index = 0; index < stores.length; index++) {
    const spec = stores[index];
    if (!spec?.name || !spec?.adminName || !spec?.email) throw new Error('店舗設定には name、adminName、email が必要です');
    let tenant = db.tenants.find(t => t.name === spec.name);
    let user = tenant && db.users.find(u => u.tenantId === tenant.id && u.email.toLowerCase() === spec.email.toLowerCase());
    if (!tenant && index === 0) {
      user = db.users.find(u => u.email.toLowerCase() === spec.email.toLowerCase());
      tenant = user && db.tenants.find(t => t.id === user.tenantId);
      if (tenant) { tenant.name = spec.name; user.name = spec.adminName; changed = true; }
    }
    if (!tenant) {
      const sourceUser = db.users.find(u => u.email.toLowerCase() === spec.email.toLowerCase());
      if (!sourceUser) throw new Error(`${spec.email} の既存管理者が見つかりません`);
      const suffix = crypto.createHash('sha256').update(`${spec.email}:${spec.name}`).digest('hex').slice(0, 12);
      tenant = { id: `tenant-${suffix}`, name: spec.name, plan: 'スタンダード' };
      user = { id: `owner-${suffix}`, tenantId: tenant.id, name: spec.adminName, email: spec.email, passwordHash: sourceUser.passwordHash, role: 'owner' };
      db.tenants.push(tenant); db.users.push(user);
      const baseTemplate = db.templates[0] || seed.templates[0];
      db.templates.push({ ...structuredClone(baseTemplate), id: `template-${suffix}`, tenantId: tenant.id, name: '標準フェイシャルカルテ', updatedAt: new Date().toISOString().slice(0,10) });
      changed = true;
    } else if (user && user.name !== spec.adminName) { user.name = spec.adminName; changed = true; }
  }
  if (changed) { await save(); console.log(`Provisioned ${stores.length} stores`); }
}
start().catch(error => { console.error('Startup failed:', error); process.exit(1); });
