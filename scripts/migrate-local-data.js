const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8')
  .split(/\r?\n/)
  .map(line => line.match(/^([^#=]+)=(.*)$/))
  .filter(Boolean)
  .map(match => [match[1].trim(), match[2].trim().replace(/^['"]|['"]$/g, '')]));

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`${response.status}: ${data.error || 'request failed'}`);
  return data;
}

async function main() {
  const base = 'https://salonrecord.onrender.com';
  const login = await request(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'admin', password: env.SYSTEM_ADMIN_PASSWORD })
  });
  const local = JSON.parse(fs.readFileSync(path.join(root, 'data', 'store.json'), 'utf8'));
  const keys = ['tenants', 'users', 'customers', 'templates', 'records'];
  const data = Object.fromEntries(keys.map(key => [key, local[key] || []]));
  const result = await request(`${base}/api/admin/import-local-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ data })
  });
  const operations = await request(`${base}/api/admin/operations`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  console.log(JSON.stringify({ ...result, verified: operations.counts, storage: operations.storage }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
