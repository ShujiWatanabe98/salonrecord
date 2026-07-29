const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const state = { token: sessionStorage.getItem('salonToken'), user: null, customers: [], templates: [], scan: null, image: '', selectedTemplate: null };
const pages = { admin:['ホーム','SalonRecord全体の稼働状態と利用状況'],adminCustomers:['顧客編集','契約店舗とログインアカウントを管理'],dashboard:['ホーム','今日も心地よいサロンワークを。'],customers:['お客様','カルテと施術履歴を一元管理'],scan:['カルテ読取','手書きカルテをAIでデータ化'],templates:['フォーム設定','店舗のカルテに合わせて読取範囲を設定'],accounts:['アカウント管理','店舗ごとの施術者アカウントを管理'] };
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(url, options={}, attempt=0) {
  const method=(options.method||'GET').toUpperCase();
  let response;
  try {
    response=await fetch(url,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${state.token||''}`,...options.headers}});
  } catch (cause) {
    if(method==='GET'&&attempt<2){await wait(700*(attempt+1));return api(url,options,attempt+1)}
    const error=new Error('サーバーに接続できません。通信環境を確認して再度お試しください');error.cause=cause;throw error;
  }
  const raw=await response.text();
  let data=null;
  if(raw){try{data=JSON.parse(raw)}catch{data=null}}
  const transient=[404,408,429,502,503,504].includes(response.status)||(/^not found\s*$/i.test(raw.trim()));
  if(!response.ok&&method==='GET'&&transient&&attempt<2){await wait(700*(attempt+1));return api(url,options,attempt+1)}
  if(!response.ok){
    const message=data?.error||(transient?'サーバーが一時的に応答できません。少し待って再度お試しください':`処理に失敗しました（HTTP ${response.status}）`);
    const error=new Error(message);error.status=response.status;error.responseText=raw.slice(0,120);error.data=data;throw error;
  }
  if(response.status===204||!raw)return null;
  if(data===null){const error=new Error('サーバーから不正な応答を受信しました。再度お試しください');error.status=response.status;throw error}
  return data;
}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500)}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(d){if(!d)return '—';const x=new Date(d+'T00:00:00');return `${x.getFullYear()}年${x.getMonth()+1}月${x.getDate()}日`}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{const b=Object.fromEntries(new FormData(e.target));const r=await api('/api/login',{method:'POST',body:JSON.stringify(b)});state.token=r.token;sessionStorage.setItem('salonToken',r.token);await boot(r.user)}catch(x){if(x.data?.code==='TENANT_SELECTION_REQUIRED'){const select=$('#tenantSelect');select.innerHTML=x.data.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');select.required=true;$('#tenantField').classList.remove('hidden');$('#loginError').textContent='ログインする店舗を選択してください'}else $('#loginError').textContent=x.message}});
$('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}sessionStorage.removeItem('salonToken');location.reload()};
async function boot(user){try{state.user=user||await api('/api/me');$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#salonName').textContent=state.user.role==='system_admin'?'システム全体':[state.user.tenant.companyName,state.user.tenant.name].filter(Boolean).join(' ／ ');$('#userName').textContent=state.user.name;$('#userInitial').textContent=state.user.name[0];$('#userRole').textContent=state.user.role==='system_admin'?'システム管理者':state.user.role==='owner'?'オーナー':'スタッフ';if(state.user.role==='system_admin'){$('#adminNav').classList.remove('hidden');$('#adminCustomersNav').classList.remove('hidden');$$('.tenant-nav').forEach(el=>el.classList.add('hidden'))}else if(state.user.role==='owner')$('#accountNav').classList.remove('hidden');$$('nav button').forEach(b=>b.onclick=()=>show(b.dataset.view));await show(state.user.role==='system_admin'?'admin':'dashboard')}catch(e){if(e.status===401){sessionStorage.removeItem('salonToken');state.token=null}else{$('#loginError').textContent=e.message}}}
async function show(name){$$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('#pageTitle').textContent=pages[name][0];$('#pageSub').textContent=pages[name][1];$('#content').innerHTML='<div class="empty">読み込み中…</div>';try{await ({admin:renderAdmin,adminCustomers:renderAdminCustomers,dashboard:renderDashboard,customers:renderCustomers,scan:renderScan,templates:renderTemplates,accounts:renderAccounts}[name])()}catch(e){if(e.status===401){sessionStorage.removeItem('salonToken');location.reload();return}$('#content').innerHTML=`<div class="card error">${esc(e.message)}<div style="margin-top:14px"><button class="ghost" onclick="show('${name}')">再読み込み</button></div></div>`}}
function duration(seconds){const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return [days&&`${days}日`,hours&&`${hours}時間`,`${minutes}分`].filter(Boolean).join(' ')}
async function renderAdmin(){const d=await api('/api/admin/operations');$('#content').innerHTML=`<section class="hero"><div><div class="eyebrow">SYSTEM STATUS</div><h2><span class="status-dot"></span>正常稼働中</h2><p>最終更新：${new Date(d.checkedAt).toLocaleString('ja-JP')}</p></div><button class="primary" onclick="show('admin')">↻ 運用状況を更新</button></section><div class="stats admin-stats"><div class="card stat"><div><small>サーバー稼働時間</small><b class="stat-text">${duration(d.uptimeSeconds)}</b></div><i>◷</i></div><div class="card stat"><div><small>データ保存</small><b class="stat-text">${esc(d.storage==='postgres'?'PostgreSQL':'ローカルJSON')}</b></div><i>▰</i></div><div class="card stat"><div><small>AI OCR</small><b class="stat-text">${d.ocrConfigured?'利用可能':'未設定'}</b></div><i>${d.ocrConfigured?'✓':'!'}</i></div></div><div class="admin-counts">${[['店舗',d.counts.tenants],['ユーザー',d.counts.users],['お客様',d.counts.customers],['カルテ',d.counts.records],['フォーム',d.counts.templates]].map(([label,value])=>`<div class="card admin-count"><small>${label}</small><b>${value}</b></div>`).join('')}</div><div class="section-head"><h2>店舗別の利用状況</h2><span class="badge">${esc(d.environment)} / ${esc(d.nodeVersion)}</span></div><div class="card admin-table"><div class="admin-row admin-row-head"><b>店舗</b><span>ユーザー</span><span>お客様</span><span>カルテ</span><span>フォーム</span></div>${d.tenantUsage.map(t=>`<div class="admin-row"><b>${esc(t.name)}</b><span>${t.users}</span><span>${t.customers}</span><span>${t.records}</span><span>${t.templates}</span></div>`).join('')}</div>`}
async function renderAdminCustomers(){
  const d=await api('/api/admin/operations');
  const companies=new Map();
  d.tenantUsage.forEach(store=>{
    const companyName=store.companyName||'会社名未登録';
    if(!companies.has(companyName))companies.set(companyName,[]);
    companies.get(companyName).push(store);
  });
  const companyCards=[...companies.entries()].map(([companyName,stores])=>{
    const totals=stores.reduce((sum,store)=>({users:sum.users+store.users,customers:sum.customers+store.customers,records:sum.records+store.records}),{users:0,customers:0,records:0});
    const freeCustomers=Math.min(30,totals.customers),paidCustomers=Math.max(0,totals.customers-30),companySuspended=stores.some(store=>store.serviceStatus==='suspended');
    return `<section class="card company-card ${companySuspended?'is-suspended':''}"><div class="company-head"><div><div class="eyebrow">CONTRACT COMPANY</div><h2>${esc(companyName)}</h2><div class="company-controls"><button class="primary company-add-store" data-company="${esc(companyName)}">＋ 店舗・アカウントを追加</button><button class="${companySuspended?'primary':'danger-btn'} company-toggle" data-company="${esc(companyName)}" data-status="${companySuspended?'suspended':'active'}">${companySuspended?'会社サービスを再開':'サービス停止'}</button></div></div><div><div class="company-service"><b class="service-badge ${companySuspended?'suspended':'active'}">${companySuspended?'会社全体を一時停止中':'会社全体で利用中'}</b></div><div class="company-totals"><span>${stores.length} 店舗</span><span>${totals.users} ユーザー</span><span>${totals.customers} お客様</span><span>${totals.records} カルテ</span></div><div class="customer-plan ${paidCustomers?'has-paid':''}"><b>無料枠 ${freeCustomers}/30名</b><span>${paidCustomers?`有料対象 ${paidCustomers}名`:'有料対象なし'}</span></div></div></div><div class="company-store-head"><b>店舗名</b><span>アカウント</span><span>ユーザー</span><span>お客様</span><span>カルテ</span><span>操作</span></div>${stores.map(store=>`<div class="company-store-row"><b>${esc(store.name)}</b><span class="account-id">${esc(store.accounts.join(', ')||'—')}</span><span>${store.users}</span><span>${store.customers}</span><span>${store.records}</span><span class="store-actions"><button class="ghost store-edit" data-tenant="${esc(store.id)}">登録情報を編集</button></span></div>`).join('')}</section>`;
  }).join('');
  $('#content').innerHTML=`<section class="card"><div class="section-head"><h2>新しい契約会社を追加</h2><span class="badge">最初の店舗・アカウントを発行</span></div><form id="contractForm" class="contract-form"><label>契約会社名<input name="companyName" required placeholder="例：株式会社サロンビューティー"></label><label>店舗名<input name="name" required placeholder="例：Salon Ginza"></label><label>管理者名<input name="managerName" required placeholder="例：山田 花子"></label><label>アカウント<input name="accountId" required minlength="3" pattern="[A-Za-z0-9._-]+" placeholder="例：ginza01"></label><label>初期パスワード<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><button class="primary">追加する</button></form><p id="contractError" class="error"></p></section><div class="section-head"><h2>契約会社</h2><span class="badge">${companies.size} 社 / ${d.tenantUsage.length} 店舗</span></div><div class="company-list">${companyCards}</div><dialog id="storeAddDialog"><form id="storeAddForm" class="edit-form"><div class="section-head"><h2>店舗・アカウントを追加</h2><button type="button" class="ghost" id="closeStoreAdd">閉じる</button></div><input type="hidden" name="companyName"><p class="company-target">追加先：<b id="storeAddCompany"></b></p><label>店舗名<input name="name" required></label><label>管理者名<input name="managerName" required></label><label>アカウント名<input name="accountId" required minlength="3" pattern="[A-Za-z0-9._-]+"></label><label>初期パスワード<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><p id="storeAddError" class="error"></p><button class="primary wide">店舗・アカウントを追加</button></form></dialog><dialog id="storeEditDialog"><form id="storeEditForm" class="edit-form"><div class="section-head"><h2>登録情報を編集</h2><button type="button" class="ghost" id="closeStoreEdit">閉じる</button></div><input type="hidden" name="tenantId"><label>契約会社名<input name="companyName" required></label><label>店舗名<input name="storeName" required></label><label>管理者名<input name="managerName" required></label><label>アカウント名<input name="accountId" required minlength="3" pattern="[A-Za-z0-9._-]+"></label><label>新しいパスワード<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="変更しない場合は空欄"></label><p class="muted">パスワードは入力した場合のみ変更されます。</p><p id="storeEditError" class="error"></p><button class="primary wide">変更を保存</button></form></dialog>`;
  $('#contractForm').onsubmit=async e=>{
    e.preventDefault();$('#contractError').textContent='';
    const button=e.submitter;button.disabled=true;
    try{
      const body=Object.fromEntries(new FormData(e.target));
      await api('/api/admin/tenants',{method:'POST',body:JSON.stringify(body)});
      toast('契約会社・店舗・アカウントを作成しました');
      renderAdminCustomers();
    }catch(error){$('#contractError').textContent=error.message;button.disabled=false}
  };
  const dialog=$('#storeEditDialog'),editForm=$('#storeEditForm');
  const addDialog=$('#storeAddDialog'),addForm=$('#storeAddForm');
  $$('.company-add-store').forEach(button=>button.onclick=()=>{
    addForm.reset();
    addForm.elements.companyName.value=button.dataset.company;
    $('#storeAddCompany').textContent=button.dataset.company;
    $('#storeAddError').textContent='';
    addDialog.showModal();
  });
  $('#closeStoreAdd').onclick=()=>addDialog.close();
  addForm.onsubmit=async e=>{
    e.preventDefault();$('#storeAddError').textContent='';
    const button=e.submitter;button.disabled=true;
    try{
      const values=Object.fromEntries(new FormData(addForm));
      await api('/api/admin/tenants',{method:'POST',body:JSON.stringify(values)});
      addDialog.close();toast('店舗・アカウントを追加しました');renderAdminCustomers();
    }catch(error){$('#storeAddError').textContent=error.message;button.disabled=false}
  };
  $$('.store-edit').forEach(button=>button.onclick=()=>{
    const store=d.tenantUsage.find(row=>row.id===button.dataset.tenant);
    const account=store.accountDetails[0]||{};
    editForm.elements.tenantId.value=store.id;
    editForm.elements.companyName.value=store.companyName||'';
    editForm.elements.storeName.value=store.name;
    editForm.elements.managerName.value=account.name||'';
    editForm.elements.accountId.value=account.accountId||'';
    editForm.elements.password.value='';
    $('#storeEditError').textContent='';
    dialog.showModal();
  });
  $$('.company-toggle').forEach(button=>button.onclick=async()=>{
    const suspending=button.dataset.status!=='suspended';
    const message=suspending
      ? `${button.dataset.company} を会社単位で一時停止します。\n\nこの会社に属する全店舗・全アカウントはログインできなくなり、現在利用中の画面からもデータ操作ができなくなります。停止しますか？`
      : `${button.dataset.company} のサービスを会社単位で再開します。全店舗・全アカウントが再び利用できるようになります。再開しますか？`;
    if(!confirm(message))return;
    button.disabled=true;
    try{
      await api('/api/admin/companies/status',{method:'PUT',body:JSON.stringify({companyName:button.dataset.company,status:suspending?'suspended':'active'})});
      toast(suspending?'未払い会社の全店舗を一時停止しました':'会社の全店舗を再開しました');
      renderAdminCustomers();
    }catch(error){toast(error.message);button.disabled=false}
  });
  $('#closeStoreEdit').onclick=()=>dialog.close();
  editForm.onsubmit=async e=>{
    e.preventDefault();$('#storeEditError').textContent='';
    const button=e.submitter;button.disabled=true;
    const values=Object.fromEntries(new FormData(editForm));
    const tenantId=values.tenantId;delete values.tenantId;
    try{
      await api(`/api/admin/tenants/${encodeURIComponent(tenantId)}`,{method:'PUT',body:JSON.stringify(values)});
      dialog.close();toast('登録情報を更新しました');renderAdminCustomers();
    }catch(error){$('#storeEditError').textContent=error.message;button.disabled=false}
  };
}
async function renderDashboard(){const d=await api('/api/dashboard');$('#content').innerHTML=`<section class="home-identity"><div><small>契約会社名</small><b>${esc(state.user.tenant.companyName||'未登録')}</b></div><div><small>店舗名</small><b>${esc(state.user.tenant.name)}</b></div></section><section class="hero"><div><h2>${new Date().getHours()<12?'おはようございます':'お疲れさまです'}、${esc(state.user.name.split(' ')[0])}さん</h2><p>お客様の大切な情報を、今日の施術に活かしましょう。</p></div><button class="primary" onclick="show('scan')">＋ カルテを読み取る</button></section><div class="stats"><div class="card stat"><div><small>登録お客様</small><b>${d.customers}</b> 人</div><i>♙</i></div><div class="card stat"><div><small>今月のカルテ</small><b>${d.recordsThisMonth}</b> 件</div><i>▤</i></div><div class="card stat"><div><small>注意事項あり</small><b>${d.alerts}</b> 人</div><i>!</i></div></div><div class="section-head"><h2>最近の施術記録</h2><button class="link-btn" onclick="show('customers')">すべて見る →</button></div><div class="card">${d.recent.length?d.recent.map(r=>`<div class="record-row"><div class="date-box"><b>${r.visitDate.slice(8)}</b>${Number(r.visitDate.slice(5,7))}月</div><div><b>${esc(r.customer?.name)}</b><small class="muted">${esc(r.staff)} 担当</small></div><div>${esc(r.values.treatment||'施術記録')}</div><div>${r.alerts?.length?'<span class="badge alert">! 注意事項あり</span>':'<span class="badge">確認済み</span>'}</div><button class="ghost" onclick="openCustomer('${r.customerId}')">詳細</button></div>`).join(''):'<div class="empty">まだ記録がありません</div>'}</div>`}
async function renderCustomers(){state.customers=await api('/api/customers');$('#content').innerHTML=`<div class="searchbar"><input id="customerSearch" placeholder="お名前・電話番号で検索"><button class="primary" id="addCustomer">＋ お客様を登録</button></div><div class="card" id="customerList"></div>`;const draw=()=>{const q=$('#customerSearch').value.toLowerCase();const rows=state.customers.filter(c=>(c.name+c.kana+c.phone).toLowerCase().includes(q));$('#customerList').innerHTML=rows.map(c=>`<div class="customer-row"><div class="avatar">${esc(c.name[0])}</div><div><b>${esc(c.name)}</b><small class="muted">${esc(c.kana)}</small></div><div>${esc(c.phone)}</div><div>${c.alerts.length?`<span class="badge alert">! ${esc(c.alerts[0])}</span>`:'<span class="badge">注意事項なし</span>'}</div><button class="ghost" onclick="openCustomer('${c.id}')">履歴を見る</button></div>`).join('')||'<div class="empty">該当するお客様はいません</div>'};draw();$('#customerSearch').oninput=draw;$('#addCustomer').onclick=addCustomer}
async function addCustomer(){const name=prompt('お客様のお名前を入力してください');if(!name)return;const phone=prompt('電話番号（任意）')||'';const customer=await api('/api/customers',{method:'POST',body:JSON.stringify({name,phone})});toast(customer.billing?.tier==='paid'?`お客様を登録しました（有料対象 ${customer.billing.paidCustomers}名）`:`お客様を登録しました（無料枠 ${customer.billing?.companyCustomers||0}/30名）`);renderCustomers()}
async function openCustomer(id){const d=await api(`/api/customers/${id}`),c=d.customer;$('#pageTitle').textContent='お客様カルテ';$('#pageSub').textContent='施術前に注意事項を確認してください';$('#content').innerHTML=`<button class="ghost" onclick="show('customers')">← 一覧に戻る</button><div class="detail-grid" style="margin-top:18px"><section class="card profile"><div class="avatar">${esc(c.name[0])}</div><h2>${esc(c.name)}</h2><p class="muted">${esc(c.kana)}<br>${esc(c.phone)}</p><div class="alert-box"><b>⚠ 施術前の注意事項</b>${c.alerts.length?`<ul>${c.alerts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>登録なし</p>'}</div><h3>お好み・ご希望</h3><ul>${c.preferences.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>登録なし</li>'}</ul><p class="muted">最終来店：${fmt(c.lastVisit)}</p></section><section><div class="section-head"><h2>施術タイムライン</h2><button class="primary" onclick="show('scan')">＋ 新しいカルテ</button></div><div class="timeline">${d.records.map(r=>`<article class="card"><div class="field-head"><b>${fmt(r.visitDate)}</b><span class="badge">${esc(r.staff)}</span></div>${r.alerts.length?`<div class="alert-box"><b>注意</b> ${r.alerts.map(esc).join(' ／ ')}</div>`:''}<h3>${esc(r.values.treatment||'施術記録')}</h3><p>${esc(r.note||r.values.concern||'')}</p><small class="muted">${Object.entries(r.values).filter(([k])=>!['treatment','concern'].includes(k)).map(([,v])=>v).filter(Boolean).map(esc).join(' ・ ')}</small></article>`).join('')||'<div class="empty">施術履歴はありません</div>'}</div></section></div>`}
async function ensureScanData(){if(!state.customers.length)state.customers=await api('/api/customers');if(!state.templates.length)state.templates=await api('/api/templates');state.selectedTemplate=state.selectedTemplate||state.templates[0]}
async function renderScan(){await ensureScanData();const t=state.selectedTemplate;$('#content').innerHTML=`<div class="scan-layout"><section class="card upload"><div class="toolbar"><label>カルテフォーム<select id="scanTemplate">${state.templates.map(x=>`<option value="${x.id}" ${x.id===t.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>画像を選択<input id="scanFile" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div class="dropzone" id="dropzone">${state.image?`<img src="${state.image}" alt="カルテ画像">`:'<div><div class="empty-icon">▧</div><b>カルテ画像を選択してください</b><p class="muted">PNG / JPEG / WEBP</p></div>'}</div><div class="progress"><i id="ocrProgress"></i></div><div class="actions"><button class="ghost" id="demoOcr">サンプルで試す</button><button class="primary" id="runOcr" ${state.image?'':'disabled'}>✦ AI OCRを実行</button></div></section><section class="card"><div class="section-head"><h2>読取結果の確認</h2><span class="badge">保存前に修正できます</span></div><div id="ocrForm">${state.scan?scanForm(t,state.scan):'<div class="empty">左側で画像を選び<br>AI OCRを実行してください</div>'}</div></section></div>`;$('#scanTemplate').onchange=e=>{state.selectedTemplate=state.templates.find(x=>x.id===e.target.value);state.scan=null;renderScan()};$('#scanFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{state.image=r.result;renderScan()};r.readAsDataURL(f)};$('#demoOcr').onclick=()=>doOcr(true);$('#runOcr').onclick=()=>doOcr(false);bindScanSave()}
function scanForm(t,result){return `<div class="toolbar"><label>紐づけるお客様<select id="recordCustomer"><option value="">選択してください</option>${state.customers.map(c=>`<option value="${c.id}" ${result.customerName===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>来店日<input id="recordDate" type="date" value="${esc(result.visitDate||new Date().toISOString().slice(0,10))}"></label></div>${result.alerts?.length?`<div class="alert-box"><b>⚠ AIが注意事項を検出しました</b><div id="alertChips">${result.alerts.map((x,i)=>`<label style="display:flex;margin:9px 0"><input type="checkbox" checked value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div></div>`:''}<div class="form-fields">${t.fields.map(f=>{const v=result.values?.[f.id]||'',cf=result.confidence?.[f.id];return `<label class="${f.alert?'alert-field':''}"><span class="field-head"><span>${esc(f.label)}${f.required?' *':''}</span>${cf?`<span class="confidence ${cf<.85?'low':''}">読取確度 ${Math.round(cf*100)}%</span>`:''}</span>${f.type==='textarea'?`<textarea data-field="${f.id}" rows="2">${esc(v)}</textarea>`:`<input data-field="${f.id}" type="${f.type==='date'?'date':'text'}" value="${esc(v)}">`}</label>`}).join('')}<label>スタッフメモ<textarea id="recordNote" rows="3" placeholder="施術後の状態、次回への申し送りなど"></textarea></label></div><div class="actions"><button class="primary" id="saveRecord">この内容でカルテを保存</button></div>`}
async function doOcr(demo){try{$('#ocrProgress').style.width='35%';$('#runOcr').disabled=true;const result=await api(demo?'/api/ocr/demo':'/api/ocr',{method:'POST',body:JSON.stringify({templateId:state.selectedTemplate.id,image:state.image})});$('#ocrProgress').style.width='100%';state.scan=result;renderScan();toast('読取が完了しました。内容を確認してください')}catch(e){toast(e.message);$('#ocrProgress').style.width='0';$('#runOcr').disabled=false}}
function bindScanSave(){const b=$('#saveRecord');if(!b)return;b.onclick=async()=>{try{const values=Object.fromEntries($$('[data-field]').map(el=>[el.dataset.field,el.value]));const alerts=$$('#alertChips input:checked').map(x=>x.value);await api('/api/records',{method:'POST',body:JSON.stringify({customerId:$('#recordCustomer').value,visitDate:$('#recordDate').value,templateId:state.selectedTemplate.id,values,alerts,note:$('#recordNote').value})});state.scan=null;state.image='';toast('カルテを保存しました');show('dashboard')}catch(e){toast(e.message)}}}
async function renderAccounts(){
  const accounts=await api('/api/accounts');
  $('#content').innerHTML=`<section class="card"><div class="section-head"><h2>施術者アカウントを作成</h2><span class="badge">${esc(state.user.tenant.name)}</span></div><form id="accountForm" class="account-form"><label>施術者名<input name="name" required placeholder="例：山田 花子"></label><label>アカウント名<input name="accountId" required minlength="3" pattern="[A-Za-z0-9._-]+" placeholder="例：yamada01"></label><label>初期パスワード<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><button class="primary">アカウントを作成</button></form><p id="accountError" class="error"></p></section><div class="section-head"><h2>店舗アカウント</h2><span class="badge">${accounts.length}件</span></div><div class="account-grid">${accounts.map(account=>`<article class="card account-card"><div class="avatar">${esc(account.name[0]||'施')}</div><div><b>${esc(account.name)}</b><span class="account-id">${esc(account.accountId)}</span><small>${account.role==='owner'?'店舗管理者':'施術者'}</small></div>${account.protected?'<span class="protected-badge">管理者作成・削除不可</span>':`<button class="danger-btn account-delete" data-id="${esc(account.id)}" data-name="${esc(account.name)}">削除</button>`}</article>`).join('')||'<div class="card empty">アカウントがありません</div>'}</div>`;
  $('#accountForm').onsubmit=async e=>{
    e.preventDefault();$('#accountError').textContent='';
    const button=e.submitter;button.disabled=true;
    try{
      await api('/api/accounts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
      toast('施術者アカウントを作成しました');renderAccounts();
    }catch(error){$('#accountError').textContent=error.message;button.disabled=false}
  };
  $$('.account-delete').forEach(button=>button.onclick=async()=>{
    if(!confirm(`${button.dataset.name} の施術者アカウントを削除します。\n\nこのアカウントはログインできなくなります。顧客・カルテデータは削除されません。削除しますか？`))return;
    button.disabled=true;
    try{await api(`/api/accounts/${encodeURIComponent(button.dataset.id)}`,{method:'DELETE'});toast('施術者アカウントを削除しました');renderAccounts()}catch(error){toast(error.message);button.disabled=false}
  });
}
async function renderTemplates(){state.templates=await api('/api/templates');state.selectedTemplate=state.templates.find(x=>x.id===(state.selectedTemplate?.id))||state.templates[0];if(!state.selectedTemplate){$('#content').innerHTML='<div class="empty">テンプレートがありません</div>';return}const t=state.selectedTemplate;$('#content').innerHTML=`<div class="template-layout"><section class="card"><div class="section-head"><h2>読取範囲プレビュー</h2><span class="badge">枠をクリックして編集</span></div><p class="muted">実際のカルテ画像に合わせ、右欄の位置と大きさを％で調整します。</p><div class="template-paper">${t.fields.map((f,i)=>`<div class="zone ${i===0?'selected':''}" data-zone="${i}" style="left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%">${esc(f.label)}</div>`).join('')}</div></section><section class="card"><div class="toolbar"><label>テンプレート名<input id="tplName" value="${esc(t.name)}"></label><label>切替<select id="tplSelect">${state.templates.map(x=>`<option value="${x.id}" ${x.id===t.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div><div class="field-list" id="fieldList">${t.fields.map((f,i)=>fieldEditor(f,i)).join('')}</div><div class="actions"><button class="ghost" id="addField">＋ 項目を追加</button><button class="primary" id="saveTemplate">設定を保存</button></div></section></div>`;let selected=0;const select=i=>{selected=i;$$('.zone,.field-item').forEach(x=>x.classList.toggle('selected',Number(x.dataset.zone??x.dataset.item)===i));$('.field-item.selected')?.scrollIntoView({block:'nearest'})};$$('.zone').forEach(z=>z.onclick=()=>select(Number(z.dataset.zone)));$$('.field-item').forEach(z=>z.onclick=e=>{if(e.target.tagName!=='INPUT'&&e.target.tagName!=='SELECT')select(Number(z.dataset.item))});$$('[data-prop]').forEach(el=>el.oninput=()=>{const i=Number(el.closest('.field-item').dataset.item),p=el.dataset.prop;t.fields[i][p]=['x','y','w','h'].includes(p)?Number(el.value):el.type==='checkbox'?el.checked:el.value;const z=$(`[data-zone="${i}"]`);if(p==='label')z.textContent=el.value;else if(['x','y','w','h'].includes(p))z.style[{x:'left',y:'top',w:'width',h:'height'}[p]]=el.value+'%'});$('#tplSelect').onchange=e=>{state.selectedTemplate=state.templates.find(x=>x.id===e.target.value);renderTemplates()};$('#addField').onclick=()=>{t.fields.push({id:'field_'+Date.now(),label:'新しい項目',type:'text',x:10,y:10,w:35,h:8,required:false,alert:false});renderTemplates()};$('#saveTemplate').onclick=async()=>{t.name=$('#tplName').value;t.fields.forEach((f,i)=>{f.label=$(`[data-item="${i}"] [data-prop="label"]`).value;f.type=$(`[data-item="${i}"] [data-prop="type"]`).value;f.alert=$(`[data-item="${i}"] [data-prop="alert"]`).checked});state.selectedTemplate=await api(`/api/templates/${t.id}`,{method:'PUT',body:JSON.stringify({name:t.name,fields:t.fields,active:t.active})});toast('フォーム設定を保存しました');renderTemplates()}}
function fieldEditor(f,i){return `<div class="field-item ${i===0?'selected':''}" data-item="${i}"><div class="row"><input data-prop="label" value="${esc(f.label)}"><select data-prop="type"><option value="text" ${f.type==='text'?'selected':''}>1行</option><option value="textarea" ${f.type==='textarea'?'selected':''}>複数行</option><option value="date" ${f.type==='date'?'selected':''}>日付</option></select><label style="display:flex;margin:0;align-items:center;font-size:11px"><input data-prop="alert" type="checkbox" ${f.alert?'checked':''}>注意</label></div><div class="coords">${['x','y','w','h'].map(p=>`<label>${{x:'左',y:'上',w:'幅',h:'高さ'}[p]}%<input data-prop="${p}" type="number" min="0" max="100" value="${f[p]}"></label>`).join('')}</div></div>`}
window.show=show;window.openCustomer=openCustomer;if(state.token)boot();
