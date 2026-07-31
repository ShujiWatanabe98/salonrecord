const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');

const ROOT = __dirname;
function loadLocalEnv() {
  if (process.env.NODE_ENV === 'production') return;
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadLocalEnv();
if (!process.env.OPENAI_API_KEY && process.env.OPEN_AI_APIKEY) process.env.OPENAI_API_KEY = process.env.OPEN_AI_APIKEY;

const PORT = Number(process.env.PORT || 8798);
const STORE_FILE = path.join(ROOT, 'data', 'store.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const loginAttempts = new Map();
const serverStartedAt = new Date();
const FREE_CUSTOMERS_PER_COMPANY = 30;
const systemAdminId = String(process.env.SYSTEM_ADMIN_ID || 'admin').toLowerCase();
const systemAdminPassword = process.env.SYSTEM_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'password');

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
const body = req => new Promise((resolve, reject) => { let s = '', stopped = false; req.on('data', c => { if (stopped) return; s += c; if (s.length > 14_000_000) { stopped = true; reject(Object.assign(new Error('画像容量が大きすぎます。画像を小さくして再度お試しください'), { status: 413 })); } }); req.on('end', () => { if (stopped) return; try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON形式が不正です')); } }); });
const tokenOf = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const auth = async req => { const userId = await storage.findSession(tokenOf(req)); return db.users.find(u => u.id === userId); };
const tenantRows = (name, user) => db[name].filter(x => x.tenantId === user.tenantId);
const companyTenantIds = user => { const tenant=db.tenants.find(row=>row.id===user.tenantId); if(!tenant?.companyName)return [user.tenantId]; return db.tenants.filter(row=>row.companyName===tenant.companyName).map(row=>row.id); };
const companyRows = (name, user) => { const tenantIds=companyTenantIds(user); return db[name].filter(row=>tenantIds.includes(row.tenantId)); };
const id = prefix => prefix + crypto.randomUUID().slice(0, 8);

function safeUser(user) { const { password, passwordHash, ...rest } = user; return { ...rest, tenant: db.tenants.find(t => t.id === user.tenantId) }; }
function loginAllowed(ip) { const now = Date.now(), recent = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000); loginAttempts.set(ip, recent); return recent.length < 10; }
function recordLoginFailure(ip) { loginAttempts.set(ip, [...(loginAttempts.get(ip) || []), Date.now()]); }
function outputText(result) { return result.output_text || (result.output || []).flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text || ''; }
function parseModelJson(text) { const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim(); return JSON.parse(cleaned); }

async function validateOcrSheets(images, expectedType, workflowStage, expectedCaptureKind = 'chart', expectedGender = '') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  images = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 2);
  if (!images.length || images.some(image => !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image))) throw Object.assign(new Error('確認する画像を選択してください。'), { status: 400 });
  if (!['chart', 'part'].includes(expectedCaptureKind) || !['new', 'progress'].includes(workflowStage) || (expectedCaptureKind === 'chart' && expectedType && !['フット', 'フェイシャル', 'ボディ'].includes(expectedType))) throw Object.assign(new Error('確認する撮影種別が不正です。'), { status: 400 });
  const expectedStage = workflowStage === 'progress' ? '途中経過' : '新規登録';
  const genderLabel = expectedGender === 'male' ? '男性用' : expectedGender === 'female' ? '女性用' : '';
  const expectedDescription = expectedCaptureKind === 'part' ? `「${expectedStage}」工程で保存する施術部位の写真` : expectedType ? `「${expectedType}」の「${expectedStage}」${genderLabel ? `「${genderLabel}」` : ''}カルテ` : `種類と男性用・女性用を自動判定する「${expectedStage}」カルテ`;
  const validRule = expectedCaptureKind === 'part' ? '人体・顔・手足などの施術部位が中心の写真ならvalid=trueにしてください。部位写真だけでは新規登録と途中経過を区別できないため、detectedStageが不明でもvalid=trueで構いません。紙のカルテ、書類、無関係な物ならfalseです。' : expectedType ? `紙のカルテで、種類が「${expectedType}」、工程が「${expectedStage}」${genderLabel ? `、性別版が「${genderLabel}」` : ''}と一致する場合だけvalid=trueにしてください。` : `紙のカルテで、工程が「${expectedStage}」と一致し、種類をフット・フェイシャル・ボディのいずれかに判定できる場合だけvalid=trueにしてください。フェイシャルとボディは男性用・女性用も判定し、フットは男女共通としてください。`;
  const prompt = `カメラ映像が期待する撮影対象か判定してください。期待値は${expectedDescription}です。\n撮影対象を「カルテ」または「部位写真」に分類してください。カルテの場合、新規登録シートは通常2ページ構成、途中経過シートは通常1ページ構成です。タイトル、Male、男性、女性、Foot/Facial/Body、人体図・足図・顔図、初診・途中経過のレイアウトを確認してください。${validRule}\n文字のOCR結果は不要です。JSON以外は出力しません。\n出力形式: {"valid":trueまたはfalse,"detectedCaptureKind":"カルテ|部位写真|不明","detectedType":"フット|フェイシャル|ボディ|不明","detectedGender":"男性用|女性用|男女共通|不明","detectedStage":"新規登録|途中経過|不明","pages":["各画像で判定した特徴"],"warnings":["不一致理由。問題なければ空配列"]}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'low' }))] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `シート確認に失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AIから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

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

async function runFootOcr(images) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  images = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 2);
  if (!images.length || images.some(image => !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image))) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を1〜2枚選択してください。'), { status: 400 });
  const prompt = `フットケアのカウンセリングシート画像を正確に読み取ってください。チェック済みの選択肢は項目名を列挙し、自由記載と合わせて読みやすい日本語の文字列にします。推測できない値は空文字にし、JSON以外は出力しません。
出力形式:
{"kana":"フリガナ","customerNo":"No.","name":"氏名","email":"メール","phone":"TEL","address":"住所","birthDate":"生年月日","occupation":"職業","footCondition":"1枚目の足の状態のチェック項目、病名、治療法、痛み、その他","lifestyle":"1枚目の生活習慣のチェック項目と自由記載","footCareHistory":"1枚目のフットケア経験のチェック項目、内容、方法、症状","consentDate":"1枚目の個人情報保護方針同意日","consentName":"1枚目の同意者氏名","treatmentConsentDate":"2枚目の施術同意日","treatmentConsentName":"2枚目の同意者氏名","skinTone":"2枚目の肌の色調","keratinCondition":"2枚目の角質の状態と図示内容","dailyCare":"2枚目のデイリーケア方法等","otherNotes":"2枚目のその他の記載"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'original' }))] }] }) });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function runFacialOcr(images, chartGender = '') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  images = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 2);
  if (!images.length || images.some(image => !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image))) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を1〜2枚選択してください。'), { status: 400 });
  const prompt = `${chartGender === 'male' ? '男性用' : chartGender === 'female' ? '女性用' : ''}フェイシャルワックスのカウンセリングシート画像を正確に読み取ってください。チェック済みの選択肢は項目名を列挙し、自由記載と合わせて読みやすい日本語の文字列にします。図の赤い斜線部分は施術部位として読み取ります。推測できない値は空文字にし、JSON以外は出力しません。
出力形式:
{"kana":"フリガナ","customerNo":"No.","name":"氏名","email":"メール","phone":"TEL","address":"住所","birthDate":"生年月日","occupation":"職業","skinCondition":"1枚目のお肌の状態、お手入れ方法、赤み、化粧品トラブル、その他","lifestyle":"1枚目の生活習慣、病気、薬、ピーリング等","hairRemovalHistory":"1枚目の脱毛経験、方法、部位、自己処理、肌トラブル","consentDate":"1枚目の個人情報保護方針同意日","consentName":"1枚目の同意者氏名","treatmentConsentDate":"2枚目の施術同意日","treatmentConsentName":"2枚目の同意者氏名","waxAreas":"2枚目の図示されたワックス脱毛施術部位","cosmetics":"2枚目の使用化粧品","dailyCare":"2枚目の朝夜のデイリーケア方法等"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'original' }))] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function runBodyOcr(images, chartGender = '') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  images = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 2);
  if (!images.length || images.some(image => !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image))) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を1〜2枚選択してください。'), { status: 400 });
  const prompt = `${chartGender === 'male' ? '男性用' : chartGender === 'female' ? '女性用' : ''}ボディワックスのカウンセリングシート画像を正確に読み取ってください。チェック済みの選択肢は項目名を列挙し、自由記載と合わせて読みやすい日本語の文字列にします。男性用・女性用それぞれの人体図の色付き部分は施術部位として読み取り、VIOデザインも判別します。推測できない値は空文字にし、JSON以外は出力しません。
出力形式:
{"kana":"フリガナ","customerNo":"No.","name":"氏名","email":"メール","phone":"TEL","address":"住所","birthDate":"生年月日","occupation":"職業","skinCondition":"1枚目のお肌の状態、お手入れ方法、赤み、汗やムレ、その他","lifestyle":"1枚目の生活習慣、病気、薬等","hairRemovalHistory":"1枚目の脱毛経験、方法、部位、自己処理、肌トラブル","consentDate":"1枚目の個人情報保護方針同意日","consentName":"1枚目の同意者氏名","treatmentConsentDate":"2枚目の施術同意日","treatmentConsentName":"2枚目の同意者氏名","bodyAreas":"2枚目の人体図と記載から読み取った施術部位","vioDesign":"2枚目のVIOデザイン","cosmetics":"2枚目の使用化粧品","dailyCare":"2枚目の施術後注意とデイリーケア方法等"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(image => ({ type: 'input_image', image_url: image, detail: 'original' }))] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function runProgressFacialOcr(image) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image || '')) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を選択してください。'), { status: 400 });
  const prompt = `フェイシャルワックス施術の途中経過カルテ画像を正確に読み取ってください。図の赤い斜線部分も施術部位として読み取り、推測できない値は空文字にします。JSON以外は出力しません。
出力形式:
{"recordNo":"No.","name":"お客様名","serviceDateTime":"施術日と時刻","staff":"担当","treatmentAreas":"施術部位と図示部位","waxUsed":"使用ワックス","skinCondition":"お肌の状態","concerns":"気になること","customerRequest":"お客様のご希望","cautions":"注意事項・同意内容","comment":"施術コメント","pos":"POS欄","store":"店舗","assignedStaff":"下段の担当者"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image, detail: 'original' }] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function runProgressFootOcr(image) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image || '')) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を選択してください。'), { status: 400 });
  const prompt = `フットケア施術の途中経過カルテ画像を正確に読み取ってください。推測できない値は空文字にし、JSON以外は出力しません。
出力形式:
{"recordNo":"No.","name":"お客様名","serviceDateTime":"施術日と時刻","staff":"担当","treatmentDetails":"施術内容","productsUsed":"使用商品","comment":"足の状態と施術コメント、ホームケア案内","retail":"物販","discount":"割引","amount":"金額","discountedAmount":"割引後金額"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image, detail: 'original' }] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function runProgressBodyOcr(image) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY が設定されていません。'), { status: 503 });
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image || '')) throw Object.assign(new Error('PNG・JPEG・WEBP・GIF画像を選択してください。'), { status: 400 });
  const prompt = `ボディワックス施術の途中経過カルテ画像を正確に読み取ってください。人体図の赤い斜線部分は施術部位として読み取り、除外部位も明記します。推測できない値は空文字にし、JSON以外は出力しません。
出力形式:
{"recordNo":"No.","name":"お客様名","serviceDateTime":"施術日と時刻","staff":"担当","treatmentDetails":"施術内容、施術部位、除外部位と図示部位","productsUsed":"使用商品","comment":"肌状態、自己処理、施術コメント、施術後案内","retail":"物販","discount":"割引","amount":"金額","discountedAmount":"割引後金額"}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6', store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image, detail: 'original' }] }] }) });
  const raw = await response.text();let result;try { result = JSON.parse(raw); } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || `AI OCRに失敗しました（HTTP ${response.status}）`), { status: response.status });
  if (!result) throw Object.assign(new Error('AI OCRから不正な応答を受信しました'), { status: 502 });
  return parseModelJson(outputText(result));
}

async function api(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!loginAllowed(ip)) return json(res, 429, { error: 'ログイン試行回数が多すぎます。15分後にお試しください' });
    const b = await body(req); const userId = String(b.userId || '').toLowerCase();
    let verified;
    if (systemAdminPassword && userId === systemAdminId && b.password === systemAdminPassword) {
      verified = [db.users.find(user => user.role === 'system_admin')].filter(Boolean);
    } else {
      const candidates = db.users.filter(x => x.email.toLowerCase() === userId && (!b.tenantId || x.tenantId === b.tenantId));
      verified = (await Promise.all(candidates.map(async user => ({ user, valid: await storage.verifyPassword(user, b.password) })))).filter(x => x.valid).map(x => x.user);
    }
    if (!verified.length) { recordLoginFailure(ip); return json(res, 401, { error: 'ユーザーIDまたはパスワードが違います' }); }
    if (!b.tenantId && verified.length > 1) return json(res, 409, { error: 'ログインする店舗を選択してください', code: 'TENANT_SELECTION_REQUIRED', tenants: verified.map(user => ({ id: user.tenantId, name: db.tenants.find(t => t.id === user.tenantId)?.name || user.tenantId })) });
    const user = verified[0];
    const loginTenant = db.tenants.find(row => row.id === user.tenantId);
    if (user.role !== 'system_admin' && loginTenant?.serviceStatus === 'suspended') return json(res, 423, { error: '未払いのため、この店舗のサービスは一時停止されています。管理者へお問い合わせください' });
    loginAttempts.delete(ip); const token = await storage.createSession(user.id); return json(res, 200, { token, user: safeUser(user) });
  }
  if (req.method === 'POST' && pathname === '/api/logout') { await storage.deleteSession(tokenOf(req)); return json(res, 204, {}); }
  const user = await auth(req); if (!user) return json(res, 401, { error: 'ログインが必要です' });
  const userTenant = db.tenants.find(row => row.id === user.tenantId);
  if (user.role !== 'system_admin' && userTenant?.serviceStatus === 'suspended') return json(res, 423, { error: '未払いのため、この店舗のサービスは一時停止されています。管理者へお問い合わせください' });
  if (pathname === '/api/me') return json(res, 200, safeUser(user));
  if (pathname === '/api/admin/operations' && req.method === 'GET') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const storageHealth = await storage.health();
    const tenantUsage = db.tenants.map(tenant => ({
      id: tenant.id, name: tenant.name, companyName: tenant.companyName || '', serviceStatus: tenant.serviceStatus || 'active',
      users: db.users.filter(row => row.tenantId === tenant.id && row.role !== 'system_admin').length,
      customers: db.customers.filter(row => row.tenantId === tenant.id).length,
      records: db.records.filter(row => row.tenantId === tenant.id).length,
      templates: db.templates.filter(row => row.tenantId === tenant.id).length,
      accounts: db.users.filter(row => row.tenantId === tenant.id && row.role !== 'system_admin').map(row => row.email),
      accountDetails: db.users.filter(row => row.tenantId === tenant.id && row.role !== 'system_admin').map(row => ({ id: row.id, accountId: row.email, name: row.name, role: row.role }))
    }));
    return json(res, 200, {
      status: 'operational', checkedAt: new Date().toISOString(),
      serverStartedAt: serverStartedAt.toISOString(), uptimeSeconds: Math.floor(process.uptime()),
      environment: IS_PRODUCTION ? 'production' : 'local', nodeVersion: process.version,
      storage: storageHealth.storage, ocrConfigured: Boolean(process.env.OPENAI_API_KEY),
      counts: {
        tenants: db.tenants.length,
        users: db.users.filter(row => row.role !== 'system_admin').length,
        customers: db.customers.length, records: db.records.length, templates: db.templates.length
      },
      tenantUsage
    });
  }
  if (pathname === '/api/admin/tenants' && req.method === 'POST') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const b = await body(req);
    const companyName = String(b.companyName || '').trim();
    const name = String(b.name || '').trim();
    const accountId = String(b.accountId || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!companyName || !name || !accountId || !password) return json(res, 400, { error: '契約会社名、店舗名、アカウント、パスワードを入力してください' });
    if (!/^[a-z0-9._-]{3,40}$/i.test(accountId)) return json(res, 400, { error: 'アカウントは3〜40文字の英数字・記号（._-）で入力してください' });
    if (password.length < 8) return json(res, 400, { error: 'パスワードは8文字以上で入力してください' });
    if (db.users.some(row => row.email.toLowerCase() === accountId)) return json(res, 409, { error: 'このアカウントは既に使用されています' });
    const suffix = crypto.randomUUID().slice(0, 8);
    const tenant = { id: `tenant-${suffix}`, companyName, name, plan: '契約中', serviceStatus: 'active' };
    const account = {
      id: `owner-${suffix}`, tenantId: tenant.id, name: String(b.managerName || '').trim() || '店舗管理者',
      email: accountId, passwordHash: await storage.hashPassword(password), role: 'owner', createdBy: 'system_admin', protected: true
    };
    const baseTemplate = db.templates[0] || seed.templates[0];
    db.tenants.push(tenant);
    db.users.push(account);
    db.templates.push({ ...structuredClone(baseTemplate), id: `template-${suffix}`, tenantId: tenant.id, name: '標準カルテ', updatedAt: new Date().toISOString().slice(0, 10) });
    await save();
    return json(res, 201, { tenant, account: { id: account.id, accountId: account.email, name: account.name } });
  }
  if (pathname === '/api/admin/import-local-data' && req.method === 'POST') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const b = await body(req);
    const imported = b.data;
    const required = ['tenants', 'users', 'customers', 'templates', 'records'];
    if (!imported || required.some(key => !Array.isArray(imported[key]))) return json(res, 400, { error: '移行データの形式が不正です' });
    const systemAdmin = db.users.find(row => row.role === 'system_admin');
    const next = {
      tenants: structuredClone(imported.tenants),
      users: structuredClone(imported.users).filter(row => row.role !== 'system_admin'),
      customers: structuredClone(imported.customers),
      templates: structuredClone(imported.templates),
      records: structuredClone(imported.records)
    };
    if (systemAdmin) next.users.unshift(systemAdmin);
    db = next;
    await save();
    return json(res, 200, { imported: Object.fromEntries(required.map(key => [key, db[key].length])) });
  }
  if (pathname === '/api/admin/companies' && req.method === 'PUT') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const b = await body(req);
    const currentName = String(b.currentName || '').trim();
    const newName = String(b.newName || '').trim();
    if (!currentName || !newName) return json(res, 400, { error: '現在の会社名と新しい会社名を入力してください' });
    const stores = db.tenants.filter(row => (row.companyName || '会社名未登録') === currentName);
    if (!stores.length) return json(res, 404, { error: '契約会社が見つかりません' });
    if (newName !== currentName && db.tenants.some(row => row.companyName === newName)) return json(res, 409, { error: '同じ会社名が既に登録されています' });
    stores.forEach(row => { row.companyName = newName; });
    await save();
    return json(res, 200, { companyName: newName, storesUpdated: stores.length });
  }
  if (pathname === '/api/admin/companies/status' && req.method === 'PUT') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const b = await body(req);
    const companyName = String(b.companyName || '').trim();
    if (!companyName || !['active', 'suspended'].includes(b.status)) return json(res, 400, { error: '会社名またはサービス状態が不正です' });
    const stores = db.tenants.filter(row => row.companyName === companyName);
    if (!stores.length) return json(res, 404, { error: '契約会社が見つかりません' });
    const changedAt = new Date().toISOString();
    stores.forEach(tenant => {
      tenant.serviceStatus = b.status;
      tenant.suspendedAt = b.status === 'suspended' ? changedAt : null;
      tenant.suspensionReason = b.status === 'suspended' ? 'payment_overdue' : null;
    });
    await save();
    return json(res, 200, { companyName, serviceStatus: b.status, storesUpdated: stores.length, changedAt });
  }
  const adminTenantMatch = pathname.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  const adminTenantCustomerMatch = pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/customers$/);
  const adminTenantGenderBackfillMatch = pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/backfill-gender$/);
  if (adminTenantGenderBackfillMatch && req.method === 'POST') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const tenantId = decodeURIComponent(adminTenantGenderBackfillMatch[1]);
    if (!db.tenants.some(row => row.id === tenantId)) return json(res, 404, { error: '店舗が見つかりません' });
    const b = await body(req), gender = String(b.gender || '');
    if (!['male', 'female'].includes(gender)) return json(res, 400, { error: '性別区分が不正です' });
    const customers = db.customers.filter(row => row.tenantId === tenantId && !['male', 'female'].includes(row.gender));
    customers.forEach(row => { row.gender = gender; });
    const customerIds = new Set(db.customers.filter(row => row.tenantId === tenantId && row.gender === gender).map(row => row.id));
    const records = db.records.filter(row => row.tenantId === tenantId && customerIds.has(row.customerId) && !['male', 'female', 'common'].includes(row.chartGender));
    records.forEach(row => { row.chartGender = gender; });
    await save(); return json(res, 200, { gender, customersUpdated: customers.length, recordsUpdated: records.length });
  }
  if (adminTenantCustomerMatch && req.method === 'POST') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const tenantId = decodeURIComponent(adminTenantCustomerMatch[1]);
    const tenant = db.tenants.find(row => row.id === tenantId);
    if (!tenant) return json(res, 404, { error: '店舗が見つかりません' });
    const b = await body(req);
    const name = String(b.name || '').trim(), kana = String(b.kana || '').trim(), phone = String(b.phone || '').trim();
    if (!name) return json(res, 400, { error: 'お客様名を入力してください' });
    const existingSample = b.sample === true ? db.customers.find(row => row.tenantId === tenantId && row.sample === true && String(row.phone || '') === phone) : null;
    if (existingSample) {
      Object.assign(existingSample, { name, kana, phone, gender: ['male', 'female'].includes(b.gender) ? b.gender : existingSample.gender || '', alerts: Array.isArray(b.alerts) ? b.alerts : existingSample.alerts || [], preferences: Array.isArray(b.preferences) ? b.preferences : existingSample.preferences || [], sample: true });
      await save(); return json(res, 200, existingSample);
    }
    if (db.customers.some(row => row.tenantId === tenantId && row.name === name && String(row.phone || '') === phone)) return json(res, 409, { error: '同じお客様が登録済みです' });
    const companyIds = db.tenants.filter(row => tenant.companyName ? row.companyName === tenant.companyName : row.id === tenantId).map(row => row.id);
    const currentCompanyCustomers = db.customers.filter(row => companyIds.includes(row.tenantId)).length;
    const row = { id: id('c'), tenantId, name, kana, phone, gender: ['male', 'female'].includes(b.gender) ? b.gender : '', lastVisit: '', alerts: Array.isArray(b.alerts) ? b.alerts : [], preferences: Array.isArray(b.preferences) ? b.preferences : [], billingTier: currentCompanyCustomers >= FREE_CUSTOMERS_PER_COMPANY ? 'paid' : 'free', sample: b.sample === true };
    db.customers.push(row); await save(); return json(res, 201, row);
  }
  if (adminTenantMatch && req.method === 'PUT') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const tenantId = decodeURIComponent(adminTenantMatch[1]);
    const tenant = db.tenants.find(row => row.id === tenantId);
    const account = db.users.find(row => row.tenantId === tenantId && row.role === 'owner');
    if (!tenant || !account) return json(res, 404, { error: '登録情報が見つかりません' });
    const b = await body(req);
    const companyName = String(b.companyName || '').trim();
    const storeName = String(b.storeName || '').trim();
    const managerName = String(b.managerName || '').trim();
    const accountId = String(b.accountId || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!companyName || !storeName || !managerName || !accountId) return json(res, 400, { error: '会社名、店舗名、管理者名、アカウントを入力してください' });
    if (!/^[a-z0-9._-]{3,40}$/i.test(accountId)) return json(res, 400, { error: 'アカウントは3〜40文字の英数字・記号（._-）で入力してください' });
    if (db.users.some(row => row.id !== account.id && row.email.toLowerCase() === accountId)) return json(res, 409, { error: 'このアカウントは既に使用されています' });
    if (password && password.length < 8) return json(res, 400, { error: '新しいパスワードは8文字以上で入力してください' });
    tenant.companyName = companyName;
    tenant.name = storeName;
    account.name = managerName;
    account.email = accountId;
    if (password) account.passwordHash = await storage.hashPassword(password);
    await save();
    return json(res, 200, { tenant, account: { id: account.id, name: account.name, accountId: account.email }, passwordChanged: Boolean(password) });
  }
  if (adminTenantMatch && req.method === 'DELETE') {
    if (user.role !== 'system_admin') return json(res, 403, { error: 'システム管理者権限が必要です' });
    const tenantId = decodeURIComponent(adminTenantMatch[1]);
    const tenant = db.tenants.find(row => row.id === tenantId);
    if (!tenant) return json(res, 404, { error: '契約店舗が見つかりません' });
    const removed = {
      users: db.users.filter(row => row.tenantId === tenantId && row.role !== 'system_admin').length,
      customers: db.customers.filter(row => row.tenantId === tenantId).length,
      records: db.records.filter(row => row.tenantId === tenantId).length,
      templates: db.templates.filter(row => row.tenantId === tenantId).length
    };
    db.tenants = db.tenants.filter(row => row.id !== tenantId);
    db.users = db.users.filter(row => row.tenantId !== tenantId || row.role === 'system_admin');
    db.customers = db.customers.filter(row => row.tenantId !== tenantId);
    db.records = db.records.filter(row => row.tenantId !== tenantId);
    db.templates = db.templates.filter(row => row.tenantId !== tenantId);
    await save();
    return json(res, 200, { deleted: { id: tenant.id, name: tenant.name, ...removed } });
  }
  if (pathname === '/api/dashboard') {
    const customers = companyRows('customers', user), records = companyRows('records', user);
    return json(res, 200, { customers: customers.length, recordsThisMonth: records.filter(r => r.visitDate.startsWith(new Date().toISOString().slice(0, 7))).length, alerts: customers.filter(c => c.alerts.length).length, recent: [...records].sort((a,b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5).map(r => ({ ...r, customer: customers.find(c => c.id === r.customerId) })) });
  }
  if (pathname === '/api/accounts' && req.method === 'GET') {
    if (user.role !== 'owner') return json(res, 403, { error: '店舗管理者権限が必要です' });
    return json(res, 200, db.users.filter(row => row.tenantId === user.tenantId && row.role !== 'system_admin').map(row => ({
      id: row.id, name: row.name, accountId: row.email, role: row.role,
      protected: row.protected === true || row.createdBy === 'system_admin' || row.role === 'owner'
    })));
  }
  if (pathname === '/api/accounts' && req.method === 'POST') {
    if (user.role !== 'owner') return json(res, 403, { error: '店舗管理者権限が必要です' });
    const b = await body(req);
    const name = String(b.name || '').trim();
    const accountId = String(b.accountId || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!name || !accountId || !password) return json(res, 400, { error: '施術者名、アカウント名、初期パスワードを入力してください' });
    if (!/^[a-z0-9._-]{3,40}$/i.test(accountId)) return json(res, 400, { error: 'アカウントは3〜40文字の英数字・記号（._-）で入力してください' });
    if (password.length < 8) return json(res, 400, { error: '初期パスワードは8文字以上で入力してください' });
    if (db.users.some(row => row.email.toLowerCase() === accountId)) return json(res, 409, { error: 'このアカウントは既に使用されています' });
    const account = { id: id('staff-'), tenantId: user.tenantId, name, email: accountId, passwordHash: await storage.hashPassword(password), role: 'staff', createdBy: user.id, protected: false };
    db.users.push(account);
    await save();
    return json(res, 201, { id: account.id, name: account.name, accountId: account.email, role: account.role, protected: false });
  }
  const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && req.method === 'DELETE') {
    if (user.role !== 'owner') return json(res, 403, { error: '店舗管理者権限が必要です' });
    const target = db.users.find(row => row.id === accountMatch[1] && row.tenantId === user.tenantId);
    if (!target) return json(res, 404, { error: 'アカウントが見つかりません' });
    if (target.protected === true || target.createdBy === 'system_admin' || target.role === 'owner') return json(res, 403, { error: 'システム管理者が作成した管理アカウントは削除できません' });
    db.users = db.users.filter(row => row.id !== target.id);
    await save();
    return json(res, 200, { deleted: { id: target.id, name: target.name, accountId: target.email } });
  }
  if (pathname === '/api/customers' && req.method === 'GET') return json(res, 200, companyRows('customers', user).map(customer=>({...customer,storeName:db.tenants.find(tenant=>tenant.id===customer.tenantId)?.name||''})));
  if (pathname === '/api/customers' && req.method === 'POST') {
    const b = await body(req);
    const tenant = db.tenants.find(row => row.id === user.tenantId);
    const companyTenantIds = db.tenants.filter(row => tenant?.companyName ? row.companyName === tenant.companyName : row.id === user.tenantId).map(row => row.id);
    const currentCompanyCustomers = db.customers.filter(row => companyTenantIds.includes(row.tenantId)).length;
    const billingTier = currentCompanyCustomers >= FREE_CUSTOMERS_PER_COMPANY ? 'paid' : 'free';
    const gender = ['male', 'female'].includes(b.gender) ? b.gender : '';
    const row = { id: id('c'), tenantId: user.tenantId, name: b.name, kana: b.kana || '', phone: b.phone || '', gender, lastVisit: '', alerts: b.alerts || [], preferences: b.preferences || [], billingTier };
    db.customers.push(row);
    await save();
    return json(res, 201, { ...row, billing: { tier: billingTier, companyCustomers: currentCompanyCustomers + 1, freeLimit: FREE_CUSTOMERS_PER_COMPANY, paidCustomers: Math.max(0, currentCompanyCustomers + 1 - FREE_CUSTOMERS_PER_COMPANY) } });
  }
  const cm = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (cm && req.method === 'GET') { const customer = companyRows('customers', user).find(x => x.id === cm[1]); if (!customer) return json(res, 404, { error: 'お客様が見つかりません' }); const sourceStore=db.tenants.find(tenant=>tenant.id===customer.tenantId)?.name||''; return json(res, 200, { customer:{...customer,storeName:sourceStore}, records:companyRows('records', user).filter(r => r.customerId === customer.id).sort((a,b) => b.visitDate.localeCompare(a.visitDate)), canEdit:customer.tenantId===user.tenantId, sourceStore }); }
  if (cm && req.method === 'PUT') {
    const customer = tenantRows('customers', user).find(x => x.id === cm[1]);
    if (!customer) return json(res, 404, { error: 'お客様が見つかりません' });
    const b = await body(req);
    if (!Array.isArray(b.alerts) && !Array.isArray(b.preferences) && b.gender === undefined) return json(res, 400, { error: '更新内容を正しく入力してください' });
    if (Array.isArray(b.alerts)) customer.alerts = [...new Set(b.alerts.map(value => String(value).trim()).filter(Boolean))].slice(0, 50);
    if (Array.isArray(b.preferences)) customer.preferences = [...new Set(b.preferences.map(value => String(value).trim()).filter(Boolean))].slice(0, 50);
    if (b.gender !== undefined) { if (!['male', 'female', ''].includes(b.gender)) return json(res, 400, { error: '性別区分が不正です' }); customer.gender = b.gender; }
    await save();
    return json(res, 200, customer);
  }
  if (pathname === '/api/templates' && req.method === 'GET') return json(res, 200, tenantRows('templates', user));
  if (pathname === '/api/templates' && req.method === 'POST') { if (user.role !== 'owner') return json(res, 403, { error: 'オーナー権限が必要です' }); const b = await body(req); const row = { id: id('tpl'), tenantId: user.tenantId, name: b.name || '新しいカルテ', active: true, updatedAt: new Date().toISOString().slice(0,10), fields: b.fields || [] }; db.templates.push(row); await save(); return json(res, 201, row); }
  const tm = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (tm && req.method === 'PUT') { if (user.role !== 'owner') return json(res, 403, { error: 'オーナー権限が必要です' }); const row = tenantRows('templates', user).find(x => x.id === tm[1]); if (!row) return json(res, 404, { error: 'テンプレートが見つかりません' }); Object.assign(row, await body(req), { id: row.id, tenantId: row.tenantId, updatedAt: new Date().toISOString().slice(0,10) }); await save(); return json(res, 200, row); }
  if (pathname === '/api/ocr/foot' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runFootOcr(b.images || b.image)); }
  if (pathname === '/api/ocr/facial' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runFacialOcr(b.images || b.image, b.chartGender)); }
  if (pathname === '/api/ocr/body' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runBodyOcr(b.images || b.image, b.chartGender)); }
  if (pathname === '/api/ocr/facial-progress' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runProgressFacialOcr(b.image)); }
  if (pathname === '/api/ocr/foot-progress' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runProgressFootOcr(b.image)); }
  if (pathname === '/api/ocr/body-progress' && req.method === 'POST') { const b = await body(req); return json(res, 200, await runProgressBodyOcr(b.image)); }
  if (pathname === '/api/ocr/validate-sheet' && req.method === 'POST') { const b = await body(req); return json(res, 200, await validateOcrSheets(b.images, b.expectedType, b.workflowStage, b.captureKind || 'chart', b.expectedGender)); }
  if (pathname === '/api/ocr' && req.method === 'POST') { const b = await body(req); const template = tenantRows('templates', user).find(x => x.id === b.templateId); if (!template) return json(res, 404, { error: 'テンプレートが見つかりません' }); return json(res, 200, await runOcr(b.image, template)); }
  if (pathname === '/api/ocr/demo' && req.method === 'POST') return json(res, 200, { customerName: '山田 花子', visitDate: new Date().toISOString().slice(0,10), values: { name: '山田 花子', visitDate: new Date().toISOString().slice(0,10), concern: '頬の乾燥、夕方のくすみが気になる', allergy: 'ラテックスアレルギーあり', redness: 'アルコール配合化粧水で赤みが出やすい', treatment: '保湿フェイシャル 60分', preference: '香りのない製品、マッサージは弱め希望' }, confidence: { name: .98, visitDate: .96, concern: .87, allergy: .93, redness: .84, treatment: .91, preference: .86 }, alerts: ['ラテックスアレルギー', 'アルコール成分で赤みが出やすい'] });
  if (pathname === '/api/records' && req.method === 'GET') {
    const customers = companyRows('customers', user);
    const records = companyRows('records', user)
      .map(record => ({
        ...record,
        customer: customers.find(customer => customer.id === record.customerId) || null,
        storeName: db.tenants.find(tenant => tenant.id === record.tenantId)?.name || ''
      }))
      .sort((a, b) => String(b.visitDate || '').localeCompare(String(a.visitDate || '')));
    return json(res, 200, records);
  }
  if (pathname === '/api/records' && req.method === 'POST') { const b = await body(req); const customer = tenantRows('customers', user).find(c => c.id === b.customerId); if (!customer) return json(res, 400, { error: '顧客を選択してください' }); const images = (Array.isArray(b.images) ? b.images : [b.image]).filter(image => /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(String(image || ''))).slice(0, 3); if (images.some(image => image.length > 4_000_000)) return json(res, 413, { error: '1枚あたりの画像容量が大きすぎます。撮影または選択し直してください' }); const chartGender = ['male', 'female', 'common'].includes(b.chartGender) ? b.chartGender : ''; const row = { id: id('r'), tenantId: user.tenantId, customerId: customer.id, visitDate: b.visitDate || new Date().toISOString().slice(0,10), staff: user.name, templateId: b.templateId, chartGender, values: b.values || {}, alerts: b.alerts || [], note: b.note || '', images, createdAt: new Date().toISOString() }; db.records.push(row); customer.lastVisit = row.visitDate; if (['male', 'female'].includes(chartGender) && !customer.gender) customer.gender = chartGender; customer.alerts = [...new Set([...(customer.alerts || []), ...row.alerts])]; await save(); return json(res, 201, row); }
  return json(res, 404, { error: 'APIが見つかりません' });
}

function staticFile(res, pathname) {
  const wanted = pathname === '/' ? 'index.html' : pathname.slice(1); const file = path.normalize(path.join(ROOT, 'public', wanted));
  if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml' }; const headers = { 'Content-Type': types[ext] || 'application/octet-stream' }; if (['.html','.css','.js'].includes(ext)) headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'; res.writeHead(200, headers); res.end(data); });
}
const server = http.createServer(async (req, res) => { try {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/healthz') return json(res, 200, { status: 'ok', ...(await storage.health()), tenantCount: db?.tenants?.length || 0 });
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
  if (systemAdminPassword && !db.users.some(user => user.role === 'system_admin')) {
    db.users.push({ id: 'system-admin', tenantId: null, name: 'システム管理者', email: systemAdminId, role: 'system_admin', protected: true });
    await save();
  }
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
      { name: 'Lycon代官山店', adminName: 'Aska2', email: process.env.ADMIN_EMAIL },
      { name: 'beaute', adminName: 'Ashaka', email: process.env.ADMIN_EMAIL }
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
      if (!sourceUser) { console.warn(`Skipped legacy store provisioning: ${spec.email} の既存管理者が見つかりません`); continue; }
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
