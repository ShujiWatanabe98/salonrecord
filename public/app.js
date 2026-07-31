const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const state = { token: sessionStorage.getItem('salonToken'), user: null, customers: [], templates: [], scan: null, image: '', images: [], partImages: { new: '', progress: '' }, treatmentType: 'フット', chartGender: 'common', workflowStage: 'new', selectedTemplate: null, sheetValidationToken: 0 };
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setAiWorking(working){
  const icon=$('#aiStatus');if(!icon)return;
  icon.classList.toggle('is-working',working);
  icon.title=working?'AI作動中':'AI待機中';
  icon.setAttribute('aria-label',icon.title);
}
async function api(url, options={}, attempt=0) {
  const method=(options.method||'GET').toUpperCase();
  const tracksAi=method==='POST'&&url.startsWith('/api/ocr');
  let response;
  if(tracksAi)setAiWorking(true);
  try {
    response=await fetch(url,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${state.token||''}`,...options.headers}});
  } catch (cause) {
    if(method==='GET'&&attempt<2){await wait(700*(attempt+1));return api(url,options,attempt+1)}
    const error=new Error('サーバーに接続できません。通信環境を確認して再度お試しください');error.cause=cause;throw error;
  } finally {if(tracksAi)setAiWorking(false)}
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
function normalizeChartGender(value){return value==='男性用'?'male':value==='女性用'?'female':value==='男女共通'?'common':['male','female','common'].includes(value)?value:''}
function genderLabel(value){return value==='male'?'男性用':value==='female'?'女性用':value==='common'?'男女共通':'未設定'}
function todayDateValue(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function optimizeImageSource(source,{maxDimension=2000,quality=.82}={}){
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const scale=Math.min(1,maxDimension/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d',{alpha:false}).drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',quality))};image.onerror=()=>reject(new Error('画像を最適化できませんでした'));image.src=source});
}
function optimizeImageFile(file,options){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>optimizeImageSource(reader.result,options).then(resolve,reject);reader.onerror=()=>reject(new Error('画像を読み込めませんでした'));reader.readAsDataURL(file)})}
function openRecordImage(source,alt='保存したカルテ画像'){
  document.querySelector('.record-image-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.className='record-image-dialog';dialog.setAttribute('aria-label','カルテ画像の拡大表示');
  const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='record-image-close';closeButton.textContent='×';closeButton.setAttribute('aria-label','閉じる');
  const image=document.createElement('img');image.src=source;image.alt=alt;
  dialog.append(closeButton,image);document.body.append(dialog);
  closeButton.onclick=()=>dialog.close();dialog.onclick=event=>{if(event.target===dialog)dialog.close()};dialog.onclose=()=>dialog.remove();
  dialog.showModal();
}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{const b=Object.fromEntries(new FormData(e.target));const r=await api('/api/login',{method:'POST',body:JSON.stringify(b)});state.token=r.token;sessionStorage.setItem('salonToken',r.token);await boot(r.user)}catch(x){if(x.data?.code==='TENANT_SELECTION_REQUIRED'){const select=$('#tenantSelect');select.innerHTML=x.data.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');select.required=true;$('#tenantField').classList.remove('hidden');$('#loginError').textContent='ログインする店舗を選択してください'}else $('#loginError').textContent=x.message}});
$('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}sessionStorage.removeItem('salonToken');location.reload()};
async function boot(user){try{state.user=user||await api('/api/me');$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#salonName').textContent=state.user.role==='system_admin'?'システム全体':[state.user.tenant.companyName,state.user.tenant.name].filter(Boolean).join(' ／ ');$('#userName').textContent=state.user.name;$('#userInitial').textContent=state.user.name[0];$('#userRole').textContent=state.user.role==='system_admin'?'システム管理者':state.user.role==='owner'?'オーナー':'スタッフ';if(state.user.role==='system_admin'){$$('.tenant-action').forEach(el=>el.classList.add('hidden'));$$('.admin-action').forEach(el=>el.classList.remove('hidden'))}else if(state.user.role==='owner')$('#accountAction').classList.remove('hidden');$$('#workspaceActions button').forEach(button=>button.onclick=()=>show(button.dataset.view));$('#homeButton').onclick=()=>show(state.user.role==='system_admin'?'admin':'dashboard');await show(state.user.role==='system_admin'?'admin':'dashboard')}catch(e){if(e.status===401){sessionStorage.removeItem('salonToken');state.token=null}else{$('#loginError').textContent=e.message}}}
async function show(name){$('#content').innerHTML='<div class="empty">読み込み中…</div>';try{await ({admin:renderAdmin,adminCustomers:renderAdminCustomers,dashboard:renderDashboard,customers:renderCustomers,scan:renderScan,templates:renderTemplates,accounts:renderAccounts}[name])();enhanceCurrentView(name)}catch(e){if(e.status===401){sessionStorage.removeItem('salonToken');location.reload();return}$('#content').innerHTML=`<div class="card error">${esc(e.message)}<div style="margin-top:14px"><button class="ghost" onclick="show('${name}')">再読み込み</button></div></div>`}}
function createTreatmentActions(stage='new'){
  const actions=document.createElement('div');
  actions.className='hero-actions';
  ['フット','フェイシャル','ボディ'].forEach(label=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='ghost treatment-chart-button';
    button.textContent=label;
    button.onclick=()=>openTreatmentScan(label,stage);
    actions.append(button);
  });
  return actions;
}
function createCameraActions(stage='new'){
  const actions=document.createElement('div');actions.className='camera-actions';
  const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.className='ghost camera-chart-button';cameraButton.textContent='カメラ';cameraButton.onclick=()=>captureChartPhoto(stage);
  const fileButton=document.createElement('button');fileButton.type='button';fileButton.className='ghost camera-file-button';fileButton.textContent='ファイルを開く';fileButton.onclick=()=>openChartFiles(stage);
  actions.append(cameraButton,fileButton);return actions;
}
function openChartFiles(stage){
  const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.multiple=stage==='new';picker.className='hidden';document.body.append(picker);
  picker.onchange=async()=>{const files=[...picker.files].slice(0,stage==='new'?2:1);if(!files.length){picker.remove();return}try{const images=await Promise.all(files.map(optimizeImageFile));const result=await api('/api/ocr/validate-sheet',{method:'POST',body:JSON.stringify({images:[images[0]],expectedType:'',workflowStage:stage,captureKind:'chart'})});const chartGender=result.detectedType==='フット'?'common':normalizeChartGender(result.detectedGender);if(!result.valid||!['フット','フェイシャル','ボディ'].includes(result.detectedType)||!chartGender)throw new Error('カルテ種類または男性用・女性用を判定できませんでした');state.treatmentType=result.detectedType;state.chartGender=chartGender;state.workflowStage=stage;state.images=images;state.image=images[0];state.scan=null;showOcrFormForSelectedButton()}catch(error){toast(error.message)}finally{picker.remove()}};picker.click();
}
function cameraFilePicker(onImage){
  const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.setAttribute('capture','environment');picker.className='hidden';document.body.append(picker);
  picker.onchange=async()=>{const file=picker.files[0];if(!file){picker.remove();return}try{await onImage(await optimizeImageFile(file))}catch(error){toast(error.message)}finally{picker.remove()}};picker.click();
}
async function captureChartPhoto(stage){
  document.querySelector('.chart-camera-dialog')?.remove();
  const requiredPages=stage==='new'?2:1,captured=[];let detectedType='',detectedGender='';
  const dialog=document.createElement('dialog');dialog.className='chart-camera-dialog';
  const title=document.createElement('h3');title.textContent='カルテ撮影';
  const guide=document.createElement('p');guide.className='chart-camera-guide';
  const progress=document.createElement('div');progress.className='chart-camera-progress';
  const liveStatus=document.createElement('div');liveStatus.className='camera-live-status is-checking';liveStatus.textContent='カメラ準備後、AIがカルテ種類をライブ判定します';
  const videoWrap=document.createElement('div');videoWrap.className='chart-camera-video-wrap';
  const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
  const a4Frame=document.createElement('div');a4Frame.className='a4-camera-frame';a4Frame.innerHTML='<span>A4用紙を枠内に合わせてください</span>';
  videoWrap.append(video,a4Frame);
  const actions=document.createElement('div');actions.className='chart-camera-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost';cancel.textContent='キャンセル';
  const switchCamera=document.createElement('button');switchCamera.type='button';switchCamera.className='ghost camera-switch';switchCamera.textContent='カメラ切替';
  const shutter=document.createElement('button');shutter.type='button';shutter.className='primary camera-shutter';shutter.textContent='種類を判定中';shutter.disabled=true;
  actions.append(cancel,switchCamera,shutter);dialog.append(title,guide,progress,liveStatus,videoWrap,actions);document.body.append(dialog);
  const updateGuide=()=>{guide.textContent=requiredPages===2?`${captured.length+1}枚目／2枚：${captured.length===0?'カウンセリングシート1ページ目':'同意・図示の2ページ目'}を撮影してください`:'途中経過シートをA4枠内に合わせて撮影してください';progress.innerHTML=Array.from({length:requiredPages},(_,index)=>`<span class="${index<captured.length?'done':index===captured.length?'current':''}">${index+1}枚目</span>`).join('')};
  let stream=null,facingMode='environment',liveTimer=null,liveChecking=false,liveRun=0;
  const stopLiveDetection=()=>{liveRun+=1;if(liveTimer)clearTimeout(liveTimer);liveTimer=null;liveChecking=false};
  const liveFrame=()=>{if(!video.videoWidth||!video.videoHeight)return '';const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.62)};
  const scheduleLiveDetection=(run,delay=2800)=>{if(run!==liveRun||!dialog.open)return;liveTimer=setTimeout(()=>detectLiveSheet(run),delay)};
  const detectLiveSheet=async run=>{if(run!==liveRun||liveChecking||!dialog.open)return;const image=liveFrame();if(!image){scheduleLiveDetection(run,700);return}liveChecking=true;liveStatus.className='camera-live-status is-checking';liveStatus.textContent='AIがカルテ種類・男性用／女性用を判定中…';try{const result=await api('/api/ocr/validate-sheet',{method:'POST',body:JSON.stringify({images:[image],expectedType:detectedType,expectedGender:detectedGender,workflowStage:stage,captureKind:'chart'})});if(run!==liveRun||!dialog.open)return;const chartGender=result.detectedType==='フット'?'common':normalizeChartGender(result.detectedGender);if(result.valid&&['フット','フェイシャル','ボディ'].includes(result.detectedType)&&chartGender){detectedType=result.detectedType;detectedGender=chartGender;title.textContent=`${genderLabel(detectedGender)} ${detectedType} カルテ撮影`;shutter.disabled=false;shutter.textContent=captured.length?'2枚目を撮影':'撮影';liveStatus.className='camera-live-status is-valid';liveStatus.textContent=`✓ ${genderLabel(detectedGender)}・${detectedType}・${stage==='progress'?'途中経過':'新規登録'}を確認しました。撮影できます`;return}const detected=[result.detectedCaptureKind,result.detectedType,result.detectedGender,result.detectedStage].filter(value=>value&&value!=='不明').join('・')||'判定できません';liveStatus.className='camera-live-status is-warning';liveStatus.textContent=`⚠ 検出：${detected}。カルテ全体を枠内に合わせてください`}catch(error){if(run!==liveRun||!dialog.open)return;liveStatus.className='camera-live-status is-warning';liveStatus.textContent='AI判定を再試行します。シートを枠内で静止させてください'}finally{liveChecking=false;if(run===liveRun&&dialog.open&&!liveStatus.classList.contains('is-valid'))scheduleLiveDetection(run)}};
  const startLiveDetection=()=>{stopLiveDetection();shutter.disabled=true;shutter.textContent='種類を判定中';liveStatus.className='camera-live-status is-checking';liveStatus.textContent='シートを枠内に合わせてください。まもなく判定します';const run=liveRun;scheduleLiveDetection(run,700)};
  const stopCamera=()=>{stopLiveDetection();stream?.getTracks().forEach(track=>track.stop());stream=null};
  const startCamera=async()=>{stopCamera();try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:false})}catch{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false})}video.srcObject=stream;await video.play();startLiveDetection()};
  cancel.onclick=()=>dialog.close();dialog.onclose=()=>{stopCamera();dialog.remove()};updateGuide();dialog.showModal();
  switchCamera.onclick=async()=>{facingMode=facingMode==='environment'?'user':'environment';switchCamera.disabled=true;try{await startCamera()}catch{toast('別のカメラへ切り替えられませんでした')}finally{switchCamera.disabled=false}};
  try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('camera unavailable');await startCamera()}
  catch(error){dialog.close();toast('カメラを起動できないため、画像ファイル選択へ切り替えます');openChartFiles(stage);return}
  shutter.onclick=()=>{if(!detectedType||!detectedGender){toast('カルテ種類と男性用・女性用の判定を待ってください');return}if(!video.videoWidth||!video.videoHeight){toast('カメラの準備中です');return}const scale=Math.min(1,2000/Math.max(video.videoWidth,video.videoHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);captured.push(canvas.toDataURL('image/jpeg',.82));if(captured.length<requiredPages){updateGuide();startLiveDetection();return}state.treatmentType=detectedType;state.chartGender=detectedGender;state.workflowStage=stage;state.images=captured;state.image=captured[0];state.scan=null;dialog.close();showOcrFormForSelectedButton()};
}
async function capturePartPhoto(stage){
  document.querySelector('.part-camera-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.className='chart-camera-dialog part-camera-dialog';
  const title=document.createElement('h3');title.textContent='施術部位を撮影';
  const guide=document.createElement('p');guide.className='chart-camera-guide';guide.textContent='記録する施術部位を画面中央に合わせて撮影してください';
  const liveStatus=document.createElement('div');liveStatus.className='camera-live-status is-checking';liveStatus.textContent=`AIが部位写真かライブ判定します（${stage==='progress'?'途中経過':'新規登録'}用）`;
  const videoWrap=document.createElement('div');videoWrap.className='chart-camera-video-wrap part-camera-video-wrap';
  const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;videoWrap.append(video);
  const actions=document.createElement('div');actions.className='chart-camera-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost';cancel.textContent='キャンセル';
  const switchCamera=document.createElement('button');switchCamera.type='button';switchCamera.className='ghost camera-switch';switchCamera.textContent='カメラ切替';
  const shutter=document.createElement('button');shutter.type='button';shutter.className='primary camera-shutter';shutter.textContent='撮影';
  actions.append(cancel,switchCamera,shutter);dialog.append(title,guide,liveStatus,videoWrap,actions);document.body.append(dialog);
  let stream=null,facingMode='environment',liveTimer=null,liveChecking=false,liveRun=0;
  const stopLiveDetection=()=>{liveRun+=1;if(liveTimer)clearTimeout(liveTimer);liveTimer=null;liveChecking=false};
  const liveFrame=()=>{if(!video.videoWidth||!video.videoHeight)return '';const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.62)};
  const scheduleLiveDetection=(run,delay=2800)=>{if(run!==liveRun||!dialog.open)return;liveTimer=setTimeout(()=>detectLivePart(run),delay)};
  const detectLivePart=async run=>{if(run!==liveRun||liveChecking||!dialog.open)return;const image=liveFrame();if(!image){scheduleLiveDetection(run,700);return}liveChecking=true;liveStatus.className='camera-live-status is-checking';liveStatus.textContent='AIがカルテ撮影か部位撮影か判定中…';try{const result=await api('/api/ocr/validate-sheet',{method:'POST',body:JSON.stringify({images:[image],expectedType:state.treatmentType,workflowStage:stage,captureKind:'part'})});if(run!==liveRun||!dialog.open)return;if(result.valid){liveStatus.className='camera-live-status is-valid';liveStatus.textContent=`✓ 部位写真を確認しました（${stage==='progress'?'途中経過':'新規登録'}用）。撮影できます`;return}const detected=[result.detectedCaptureKind,result.detectedType,result.detectedStage].filter(value=>value&&value!=='不明').join('・')||'判定できません';liveStatus.className='camera-live-status is-warning';liveStatus.textContent=`⚠ 検出：${detected}。施術部位を画面中央に合わせてください`}catch(error){if(run!==liveRun||!dialog.open)return;liveStatus.className='camera-live-status is-warning';liveStatus.textContent='AI判定を再試行します。施術部位を画面中央で静止させてください'}finally{liveChecking=false;if(run===liveRun&&dialog.open&&!liveStatus.classList.contains('is-valid'))scheduleLiveDetection(run)}};
  const startLiveDetection=()=>{stopLiveDetection();liveStatus.className='camera-live-status is-checking';liveStatus.textContent=`施術部位を中央に合わせてください（${stage==='progress'?'途中経過':'新規登録'}用）`;const run=liveRun;scheduleLiveDetection(run,700)};
  const stopCamera=()=>{stopLiveDetection();stream?.getTracks().forEach(track=>track.stop());stream=null};
  const startCamera=async()=>{stopCamera();try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:false})}catch{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false})}video.srcObject=stream;await video.play();startLiveDetection()};
  cancel.onclick=()=>dialog.close();dialog.onclose=()=>{stopCamera();dialog.remove()};
  switchCamera.onclick=async()=>{facingMode=facingMode==='environment'?'user':'environment';switchCamera.disabled=true;try{await startCamera()}catch{toast('別のカメラへ切り替えられませんでした')}finally{switchCamera.disabled=false}};
  shutter.onclick=()=>{if(!video.videoWidth||!video.videoHeight){toast('カメラの準備中です');return}const scale=Math.min(1,2000/Math.max(video.videoWidth,video.videoHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/jpeg',.82);state.partImages[stage]=image;dialog.close();showPartPhotoPreview(stage,image)};
  dialog.showModal();
  try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('camera unavailable');await startCamera()}catch{dialog.close();toast('カメラを起動できないため、画像選択へ切り替えます');cameraFilePicker(image=>{state.partImages[stage]=image;showPartPhotoPreview(stage,image)})}
}
function imagesForRecord(stage=state.workflowStage){
  const chartImages=(state.images.length?state.images:[state.image]).filter(Boolean);
  const partImage=state.partImages?.[stage];
  return [...chartImages,...(partImage?[partImage]:[])].slice(0,3);
}
function showPartPhotoPreview(stage,image){
  document.querySelector(`.part-photo-panel[data-stage="${stage}"]`)?.remove();
  const anchor=stage==='progress'?$('.progress-frame'):$('.hero');if(!anchor)return;
  const panel=document.createElement('section');panel.className='card part-photo-panel';panel.dataset.stage=stage;
  const heading=document.createElement('div');heading.className='section-head';heading.innerHTML=`<h2>${stage==='progress'?'途中経過':'新規登録'}・施術部位写真</h2>`;
  const close=document.createElement('button');close.type='button';close.className='ghost';close.textContent='削除';close.onclick=()=>{state.partImages[stage]='';panel.remove()};heading.append(close);
  const photo=document.createElement('img');photo.src=image;photo.alt='カメラで撮影した施術部位';panel.append(heading,photo);anchor.insertAdjacentElement('afterend',panel);
}
function showOcrFormForSelectedButton(){
  const formByButton={
    new:{'フット':showSelectedImagePreview,'フェイシャル':showSelectedFacialImagePreview,'ボディ':showSelectedBodyImagePreview},
    progress:{'フット':showProgressFootImagePreview,'フェイシャル':showProgressFacialImagePreview,'ボディ':showProgressBodyImagePreview}
  };
  const showForm=formByButton[state.workflowStage]?.[state.treatmentType];
  if(showForm)showForm();
  showMissingImagePrompt();
  validateDisplayedSheets();
}
async function validateDisplayedSheets(){
  const frame=$('.image-preview-frame'),images=(state.images.length?state.images:[state.image]).filter(Boolean).slice(0,2);if(!frame||!images.length)return;
  const token=++state.sheetValidationToken;
  frame.querySelector('.sheet-validation-status')?.remove();
  const status=document.createElement('div');status.className='sheet-validation-status is-checking';status.textContent='AIがシート種類を確認しています…';
  const prompt=frame.querySelector('.missing-image-prompt');if(prompt)prompt.insertAdjacentElement('afterend',status);else frame.insertBefore(status,frame.children[1]||null);
  try{
    const result=await api('/api/ocr/validate-sheet',{method:'POST',body:JSON.stringify({images,expectedType:state.treatmentType,expectedGender:state.chartGender,workflowStage:state.workflowStage})});
    if(token!==state.sheetValidationToken||!status.isConnected)return;
    status.classList.remove('is-checking');
    if(result.valid){status.classList.add('is-valid');status.textContent=`✓ ${genderLabel(state.chartGender)}・${state.treatmentType}の${state.workflowStage==='progress'?'途中経過':'新規登録'}シートを確認しました`}
    else{status.classList.add('is-warning');const warnings=(result.warnings||[]).filter(Boolean).join('／');status.textContent=`⚠ シートが違う可能性があります。検出: ${result.detectedType||'不明'}・${result.detectedStage||'不明'}${warnings?`（${warnings}）`:''}`;toast('選択したボタンと画像のシート種類が一致しない可能性があります')}
  }catch(error){if(token!==state.sheetValidationToken||!status.isConnected)return;status.classList.remove('is-checking');status.classList.add('is-warning');status.textContent=`⚠ シート種類を確認できませんでした: ${error.message}`}
}
function showMissingImagePrompt(){
  document.querySelector('.missing-image-prompt')?.remove();
  if(state.workflowStage!=='new'||state.images.length>=2)return;
  const frame=$('.image-preview-frame');if(!frame)return;
  const prompt=document.createElement('div');prompt.className='missing-image-prompt';
  const message=document.createElement('span');message.textContent=`${state.treatmentType}カルテは2枚構成です。2枚目の画像ファイルを追加してください。`;
  const addButton=document.createElement('button');addButton.type='button';addButton.className='primary';addButton.textContent='2枚目を追加';
  prompt.append(message,addButton);frame.insertBefore(prompt,frame.children[1]||null);
  toast('画像が1枚不足しています。2枚目を追加してください');
  addButton.onclick=()=>{
    const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.setAttribute('capture','environment');picker.className='hidden';document.body.append(picker);
    picker.onchange=async()=>{const file=picker.files[0];if(!file){picker.remove();return}try{state.images=[...state.images,await optimizeImageFile(file)].slice(0,2);state.image=state.images[0];showOcrFormForSelectedButton()}catch(error){toast(error.message)}finally{picker.remove()}};
    picker.click();
  };
}
async function openTreatmentScan(label,stage='new'){
  if(!['フット','フェイシャル','ボディ'].includes(label)){await show('scan');return}
  state.treatmentType=label;
  state.workflowStage=stage;
  const picker=$('#footFilePicker');
  picker.value='';
  picker.onchange=async()=>{
    const files=[...picker.files].slice(0,2);
    if(!files.length)return;
    if(picker.files.length>2)toast('画像は先頭の2枚を読み込みました');
    state.images=await Promise.all(files.map(file=>optimizeImageFile(file)));
    state.image=state.images[0];state.scan=null;
    showOcrFormForSelectedButton();
  };
  picker.click();
}
function showProgressBodyImagePreview(){
  const hero=$('.hero'),image=state.images[0]||state.image;if(!hero||!image)return;
  state.images=[image];state.image=image;$('.image-preview-frame')?.remove();
  const frame=document.createElement('section');frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>途中経過・ボディ OCR記入欄</h2><div class="ocr-heading-actions"><span class="badge">ボディ</span><button type="button" class="primary" id="runProgressBodyOcr">OCR</button></div></div><div class="image-ocr-layout"><div class="selected-image-preview"><figure><figcaption>途中経過画像</figcaption><img src="${image}" alt="ボディ途中経過カルテ画像"></figure></div><form class="progress-body-fields" autocomplete="off"><div class="ocr-field-grid"><label>No.<input name="recordNo" placeholder="OCR結果"></label><label>お客様名<input name="name" placeholder="OCR結果"></label><label>施術日時<input name="serviceDateTime" placeholder="年 月 日・時刻"></label><label>担当<input name="staff" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>施術内容・施術部位</h3><textarea name="treatmentDetails" rows="5" placeholder="全身、両腕、両脚、背中、お腹、胸、うなじなど"></textarea></section><section class="ocr-form-section"><h3>使用商品</h3><textarea name="productsUsed" rows="5" placeholder="ワックス、プレ・アフターローション、保湿ジェルなど"></textarea></section><section class="ocr-form-section"><h3>コメント</h3><textarea name="comment" rows="5" placeholder="肌状態、自己処理、施術後の案内など"></textarea></section><section class="ocr-form-section"><h3>物販</h3><textarea name="retail" rows="3" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>割引</h3><textarea name="discount" rows="3" placeholder="OCR結果"></textarea></section><div class="ocr-field-grid"><label>金額<input name="amount" placeholder="OCR結果"></label><label>割引後金額<input name="discountedAmount" placeholder="OCR結果"></label></div></form></div>`;
  hero.insertAdjacentElement('afterend',frame);addOcrCloseButton(frame);$('#runProgressBodyOcr').onclick=runProgressBodyOcr;
}
async function runProgressBodyOcr(){
  const button=$('#runProgressBodyOcr'),frame=$('.image-preview-frame');if(!button||!frame)return;button.disabled=true;button.textContent='OCR中…';
  try{const result=await api('/api/ocr/body-progress',{method:'POST',body:JSON.stringify({image:state.image})});['recordNo','name','serviceDateTime','staff','treatmentDetails','productsUsed','comment','retail','discount','amount','discountedAmount'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast('途中経過のOCR結果を入力欄へ反映しました')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function showProgressFootImagePreview(){
  const hero=$('.hero'),image=state.images[0]||state.image;if(!hero||!image)return;
  state.images=[image];state.image=image;$('.image-preview-frame')?.remove();
  const frame=document.createElement('section');frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>途中経過・フット OCR記入欄</h2><div class="ocr-heading-actions"><span class="badge">フット</span><button type="button" class="primary" id="runProgressFootOcr">OCR</button></div></div><div class="image-ocr-layout"><div class="selected-image-preview"><figure><figcaption>途中経過画像</figcaption><img src="${image}" alt="フット途中経過カルテ画像"></figure></div><form class="progress-foot-fields" autocomplete="off"><div class="ocr-field-grid"><label>No.<input name="recordNo" placeholder="OCR結果"></label><label>お客様名<input name="name" placeholder="OCR結果"></label><label>施術日時<input name="serviceDateTime" placeholder="年 月 日・時刻"></label><label>担当<input name="staff" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>施術内容</h3><textarea name="treatmentDetails" rows="5" placeholder="足浴、角質除去、爪の調整、保湿など"></textarea></section><section class="ocr-form-section"><h3>使用商品</h3><textarea name="productsUsed" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>コメント</h3><textarea name="comment" rows="5" placeholder="足の状態、施術内容、ホームケア案内など"></textarea></section><section class="ocr-form-section"><h3>物販</h3><textarea name="retail" rows="3" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>割引</h3><textarea name="discount" rows="3" placeholder="OCR結果"></textarea></section><div class="ocr-field-grid"><label>金額<input name="amount" placeholder="OCR結果"></label><label>割引後金額<input name="discountedAmount" placeholder="OCR結果"></label></div></form></div>`;
  hero.insertAdjacentElement('afterend',frame);addOcrCloseButton(frame);$('#runProgressFootOcr').onclick=runProgressFootOcr;
}
async function runProgressFootOcr(){
  const button=$('#runProgressFootOcr'),frame=$('.image-preview-frame');if(!button||!frame)return;button.disabled=true;button.textContent='OCR中…';
  try{const result=await api('/api/ocr/foot-progress',{method:'POST',body:JSON.stringify({image:state.image})});['recordNo','name','serviceDateTime','staff','treatmentDetails','productsUsed','comment','retail','discount','amount','discountedAmount'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast('途中経過のOCR結果を入力欄へ反映しました')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function showProgressFacialImagePreview(){
  const hero=$('.hero'),image=state.images[0]||state.image;if(!hero||!image)return;
  state.images=[image];state.image=image;$('.image-preview-frame')?.remove();
  const frame=document.createElement('section');frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>途中経過・フェイシャル OCR記入欄</h2><div class="ocr-heading-actions"><span class="badge">フェイシャル</span><button type="button" class="primary" id="runProgressFacialOcr">OCR</button></div></div><div class="image-ocr-layout"><div class="selected-image-preview"><figure><figcaption>途中経過画像</figcaption><img src="${image}" alt="フェイシャル途中経過カルテ画像"></figure></div><form class="progress-facial-fields" autocomplete="off"><div class="ocr-field-grid"><label>No.<input name="recordNo" placeholder="OCR結果"></label><label>お客様名<input name="name" placeholder="OCR結果"></label><label>施術日時<input name="serviceDateTime" placeholder="年 月 日・時刻"></label><label>担当<input name="staff" placeholder="OCR結果"></label><label class="field-wide">施術部位<textarea name="treatmentAreas" rows="3" placeholder="額、眉間、鼻、口上、ほほ、あごなど"></textarea></label><label class="field-wide">使用ワックス<textarea name="waxUsed" rows="3" placeholder="OCR結果"></textarea></label></div><section class="ocr-form-section"><h3>お肌の状態</h3><textarea name="skinCondition" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>気になること</h3><textarea name="concerns" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>お客様のご希望</h3><textarea name="customerRequest" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>注意事項・同意内容</h3><textarea name="cautions" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>コメント</h3><textarea name="comment" rows="5" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>POS</h3><textarea name="pos" rows="3" placeholder="OCR結果"></textarea></section><div class="ocr-field-grid"><label>店舗<input name="store" placeholder="OCR結果"></label><label>担当者<input name="assignedStaff" placeholder="OCR結果"></label></div></form></div>`;
  hero.insertAdjacentElement('afterend',frame);addOcrCloseButton(frame);$('#runProgressFacialOcr').onclick=runProgressFacialOcr;
}
async function runProgressFacialOcr(){
  const button=$('#runProgressFacialOcr'),frame=$('.image-preview-frame');if(!button||!frame)return;button.disabled=true;button.textContent='OCR中…';
  try{const result=await api('/api/ocr/facial-progress',{method:'POST',body:JSON.stringify({image:state.image})});['recordNo','name','serviceDateTime','staff','treatmentAreas','waxUsed','skinCondition','concerns','customerRequest','cautions','comment','pos','store','assignedStaff'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast('途中経過のOCR結果を入力欄へ反映しました')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function facialFieldsFirst(){return `<form class="facial-ocr-fields" autocomplete="off"><div class="ocr-field-grid"><label>フリガナ<input name="kana" placeholder="OCR結果"></label><label>No.<input name="customerNo" placeholder="OCR結果"></label><label>お名前<input name="name" placeholder="OCR結果"></label><label>メール<input name="email" type="email" placeholder="OCR結果"></label><label>TEL<input name="phone" placeholder="OCR結果"></label><label class="field-wide">ご住所<textarea name="address" rows="2" placeholder="OCR結果"></textarea></label><label>生年月日<input name="birthDate" placeholder="西暦 年 月 日"></label><label>ご職業<input name="occupation" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>お肌の状態・お手入れ方法</h3><textarea name="skinCondition" rows="5" placeholder="乾燥肌、脂性肌、普通肌、ニキビ肌、敏感肌、化粧品トラブル、赤みなど"></textarea></section><section class="ocr-form-section"><h3>生活習慣</h3><textarea name="lifestyle" rows="5" placeholder="紫外線、妊娠、アレルギー、スポーツ、通院、常用薬、ピーリングなど"></textarea></section><section class="ocr-form-section"><h3>脱毛の経験</h3><textarea name="hairRemovalHistory" rows="5" placeholder="サロン脱毛、ワックス脱毛、自己処理、脱毛後の肌トラブル"></textarea></section><div class="ocr-field-grid consent-fields"><label>個人情報同意日<input name="consentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="consentName" placeholder="OCR結果"></label></div></form>`}
function facialFieldsSecond(){return `<form class="facial-ocr-fields second-page-fields" autocomplete="off"><div class="ocr-field-grid consent-fields"><label>施術同意日<input name="treatmentConsentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="treatmentConsentName" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>ワックス脱毛施術部位</h3><textarea name="waxAreas" rows="5" placeholder="額、眉間、口上、ほほ、鼻、あごなど"></textarea></section><section class="ocr-form-section"><h3>使用化粧品</h3><textarea name="cosmetics" rows="7" placeholder="クレンジング、洗顔料、化粧水、美容液、乳液、日焼け止めなど"></textarea></section><section class="ocr-form-section"><h3>デイリーケア方法等</h3><textarea name="dailyCare" rows="7" placeholder="朝・夜のケア手順、保湿パックなど"></textarea></section></form>`}
function showSelectedFacialImagePreview(){
  const hero=$('.hero'),images=state.images.length?state.images:[state.image].filter(Boolean);if(!hero||!images.length)return;
  $('.image-preview-frame')?.remove();
  const frame=document.createElement('section');frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>選択した画像・OCR記入欄</h2><div class="ocr-heading-actions"><span class="badge">${genderLabel(state.chartGender)}・フェイシャル ${images.length}枚</span><button type="button" class="primary" id="runFacialOcr">OCR</button></div></div><div class="image-ocr-layout"><div class="selected-image-preview"><figure><figcaption>1枚目</figcaption><img src="${images[0]}" alt="選択したフェイシャルカルテ画像 1枚目"></figure></div>${facialFieldsFirst()}</div>`;
  if(images[1])frame.insertAdjacentHTML('beforeend',`<div class="image-ocr-layout second-page-layout"><div class="selected-image-preview"><figure><figcaption>2枚目</figcaption><img src="${images[1]}" alt="選択したフェイシャルカルテ画像 2枚目"></figure></div>${facialFieldsSecond()}</div>`);
  hero.insertAdjacentElement('afterend',frame);addOcrCloseButton(frame);$('#runFacialOcr').onclick=runSelectedFacialOcr;
}
async function runSelectedFacialOcr(){
  const button=$('#runFacialOcr'),frame=$('.image-preview-frame');if(!button||!frame)return;button.disabled=true;button.textContent='OCR中…';
  try{const images=state.images.length?state.images:[state.image];const result=await api('/api/ocr/facial',{method:'POST',body:JSON.stringify({images,chartGender:state.chartGender})});['kana','customerNo','name','email','phone','address','birthDate','occupation','skinCondition','lifestyle','hairRemovalHistory','consentDate','consentName','treatmentConsentDate','treatmentConsentName','waxAreas','cosmetics','dailyCare'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast(`${genderLabel(state.chartGender)} ${images.length}枚のOCR結果を反映しました`)}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function bodyFieldsFirst(){return `<form class="body-ocr-fields" autocomplete="off"><div class="ocr-field-grid"><label>フリガナ<input name="kana" placeholder="OCR結果"></label><label>No.<input name="customerNo" placeholder="OCR結果"></label><label>お名前<input name="name" placeholder="OCR結果"></label><label>メール<input name="email" type="email" placeholder="OCR結果"></label><label>TEL<input name="phone" placeholder="OCR結果"></label><label class="field-wide">ご住所<textarea name="address" rows="2" placeholder="OCR結果"></textarea></label><label>生年月日<input name="birthDate" placeholder="西暦 年 月 日"></label><label>ご職業<input name="occupation" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>お肌の状態・お手入れ方法</h3><textarea name="skinCondition" rows="5" placeholder="乾燥肌、脂性肌、普通肌、ニキビ、赤み、汗やムレなど"></textarea></section><section class="ocr-form-section"><h3>生活習慣</h3><textarea name="lifestyle" rows="5" placeholder="紫外線、妊娠、アレルギー、スポーツ、通院、常用薬など"></textarea></section><section class="ocr-form-section"><h3>脱毛の経験</h3><textarea name="hairRemovalHistory" rows="5" placeholder="サロン脱毛、ワックス脱毛、自己処理、脱毛後の肌トラブル"></textarea></section><div class="ocr-field-grid consent-fields"><label>個人情報同意日<input name="consentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="consentName" placeholder="OCR結果"></label></div></form>`}
function bodyFieldsSecond(){return `<form class="body-ocr-fields second-page-fields" autocomplete="off"><div class="ocr-field-grid consent-fields"><label>施術同意日<input name="treatmentConsentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="treatmentConsentName" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>ワックス脱毛施術部位</h3><textarea name="bodyAreas" rows="6" placeholder="VIO、両ワキ、ひじ、背中、うなじ、お腹、ヒップ、脚、腕など"></textarea></section><section class="ocr-form-section"><h3>VIOデザイン</h3><textarea name="vioDesign" rows="3" placeholder="ナチュラル、トライアングル、オーバル、ハイジニーナなど"></textarea></section><section class="ocr-form-section"><h3>使用化粧品</h3><textarea name="cosmetics" rows="6" placeholder="プレワックスローション、ワックス、アフターローション、保湿ジェルなど"></textarea></section><section class="ocr-form-section"><h3>デイリーケア方法等</h3><textarea name="dailyCare" rows="7" placeholder="施術後の注意、保湿、スクラブ、次回施術時期など"></textarea></section></form>`}
function showSelectedBodyImagePreview(){
  const hero=$('.hero'),images=state.images.length?state.images:[state.image].filter(Boolean);if(!hero||!images.length)return;
  $('.image-preview-frame')?.remove();const frame=document.createElement('section');frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>選択した画像・OCR記入欄</h2><div class="ocr-heading-actions"><span class="badge">${genderLabel(state.chartGender)}・ボディ ${images.length}枚</span><button type="button" class="primary" id="runBodyOcr">OCR</button></div></div><div class="image-ocr-layout"><div class="selected-image-preview"><figure><figcaption>1枚目</figcaption><img src="${images[0]}" alt="選択したボディカルテ画像 1枚目"></figure></div>${bodyFieldsFirst()}</div>`;
  if(images[1])frame.insertAdjacentHTML('beforeend',`<div class="image-ocr-layout second-page-layout"><div class="selected-image-preview"><figure><figcaption>2枚目</figcaption><img src="${images[1]}" alt="選択したボディカルテ画像 2枚目"></figure></div>${bodyFieldsSecond()}</div>`);
  hero.insertAdjacentElement('afterend',frame);addOcrCloseButton(frame);$('#runBodyOcr').onclick=runSelectedBodyOcr;
}
async function runSelectedBodyOcr(){
  const button=$('#runBodyOcr'),frame=$('.image-preview-frame');if(!button||!frame)return;button.disabled=true;button.textContent='OCR中…';
  try{const images=state.images.length?state.images:[state.image];const result=await api('/api/ocr/body',{method:'POST',body:JSON.stringify({images,chartGender:state.chartGender})});['kana','customerNo','name','email','phone','address','birthDate','occupation','skinCondition','lifestyle','hairRemovalHistory','consentDate','consentName','treatmentConsentDate','treatmentConsentName','bodyAreas','vioDesign','cosmetics','dailyCare'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast(`${genderLabel(state.chartGender)} ${images.length}枚のOCR結果を反映しました`)}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function showSelectedImagePreview(){
  const hero=$('.hero');
  const images=state.images.length?state.images:[state.image].filter(Boolean);
  if(!hero||!images.length)return;
  $('.image-preview-frame')?.remove();
  const frame=document.createElement('section');
  frame.className='card image-preview-frame';
  frame.innerHTML=`<div class="section-head"><h2>選択した画像・OCR記入欄</h2><span class="badge">フット</span></div><div class="image-ocr-layout"><div class="selected-image-preview"><img src="${state.image}" alt="選択したフットカルテ画像"></div><form class="foot-ocr-fields" autocomplete="off"><div class="ocr-field-grid"><label>フリガナ<input name="kana" placeholder="OCR結果"></label><label>No.<input name="customerNo" placeholder="OCR結果"></label><label>お名前<input name="name" placeholder="OCR結果"></label><label>メール<input name="email" type="email" placeholder="OCR結果"></label><label>TEL<input name="phone" placeholder="OCR結果"></label><label class="field-wide">ご住所<textarea name="address" rows="2" placeholder="OCR結果"></textarea></label><label>生年月日<input name="birthDate" placeholder="西暦 年 月 日"></label><label>ご職業<input name="occupation" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>足の状態</h3><textarea name="footCondition" rows="5" placeholder="タコ、ウオノメ、イボ、巻き爪、水虫、外反母趾、内反小趾、静脈瘤、むくみ、臭い、かかとのひび割れ、乾燥、かゆみ、冷え、痛み、治療中の病気、その他"></textarea></section><section class="ocr-form-section"><h3>生活習慣</h3><textarea name="lifestyle" rows="5" placeholder="立ち仕事・歩行、妊娠、アレルギー、スポーツ、通院・治療中の病気、常用薬、肌トラブル、膝・腰の痛み"></textarea></section><section class="ocr-form-section"><h3>フットケアの経験</h3><textarea name="footCareHistory" rows="5" placeholder="サロンでのフットケア、医療機関でのケア、自宅での自己処理、施術後の肌トラブル"></textarea></section><div class="ocr-field-grid consent-fields"><label>同意日<input name="consentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="consentName" placeholder="OCR結果"></label></div></form></div>`;
  frame.querySelector('.badge').textContent=`フット ${images.length}枚`;
  frame.querySelector('.selected-image-preview').innerHTML=`<figure><figcaption>1枚目</figcaption><img src="${images[0]}" alt="選択したフットカルテ画像 1枚目"></figure>`;
  if(images[1]){
    const secondLayout=document.createElement('div');
    secondLayout.className='image-ocr-layout second-page-layout';
    secondLayout.innerHTML=`<div class="selected-image-preview"><figure><figcaption>2枚目</figcaption><img src="${images[1]}" alt="選択したフットカルテ画像 2枚目"></figure></div><form class="foot-ocr-fields second-page-fields" autocomplete="off"><div class="ocr-field-grid consent-fields"><label>施術同意日<input name="treatmentConsentDate" placeholder="西暦 年 月 日"></label><label>同意者氏名<input name="treatmentConsentName" placeholder="OCR結果"></label></div><section class="ocr-form-section"><h3>肌の色調</h3><textarea name="skinTone" rows="3" placeholder="OCR結果"></textarea></section><section class="ocr-form-section"><h3>角質の状態</h3><textarea name="keratinCondition" rows="4" placeholder="乾燥、ひび割れ、足裏の角質、タコなど"></textarea></section><section class="ocr-form-section"><h3>デイリーケア方法等</h3><textarea name="dailyCare" rows="5" placeholder="保湿、やすり、爪のケアなど"></textarea></section><section class="ocr-form-section"><h3>その他</h3><textarea name="otherNotes" rows="5" placeholder="冷え、むくみ、ご希望、施術制限など"></textarea></section></form>`;
    frame.querySelector('.image-ocr-layout').insertAdjacentElement('afterend',secondLayout);
  }
  hero.insertAdjacentElement('afterend',frame);
  const headingActions=document.createElement('div');
  headingActions.className='ocr-heading-actions';
  const badge=frame.querySelector('.section-head .badge');
  badge.replaceWith(headingActions);
  headingActions.append(badge);
  const ocrButton=document.createElement('button');
  ocrButton.type='button';ocrButton.id='runFootOcr';ocrButton.className='primary';ocrButton.textContent='OCR';
  ocrButton.onclick=runSelectedFootOcr;
  headingActions.append(ocrButton);
  addOcrCloseButton(frame);
}
function addOcrCloseButton(frame){
  const actions=frame.querySelector('.ocr-heading-actions');
  if(!actions)return;
  const saveButton=document.createElement('button');
  saveButton.type='button';saveButton.className='primary ocr-save-button';saveButton.textContent='保存';saveButton.disabled=true;
  saveButton.onclick=()=>saveOcrRecord(frame,saveButton);
  actions.append(saveButton);
  const closeButton=document.createElement('button');
  closeButton.type='button';closeButton.className='ghost ocr-close-button';closeButton.textContent='閉じる';
  closeButton.onclick=()=>{state.image='';state.images=[];state.scan=null;frame.remove()};
  actions.append(closeButton);
}
function markOcrReady(frame){const saveButton=frame?.querySelector('.ocr-save-button');if(saveButton)saveButton.disabled=false}
async function saveOcrRecord(frame,button){
  const values={};frame.querySelectorAll('input[name],textarea[name]').forEach(field=>values[field.name]=field.value.trim());
  if(!values.name){toast('お名前を入力してください');return}
  button.disabled=true;button.textContent='保存中…';
  try{
    state.customers=await api('/api/customers');
    const normalizedPhone=(values.phone||'').replace(/\D/g,'');
    let customer=state.customers.find(item=>item.name===values.name&&(normalizedPhone?String(item.phone||'').replace(/\D/g,'')===normalizedPhone:true));
    if(!customer)customer=await api('/api/customers',{method:'POST',body:JSON.stringify({name:values.name,phone:values.phone||'',gender:['male','female'].includes(state.chartGender)?state.chartGender:''})});
    if(!state.templates.length)state.templates=await api('/api/templates');
    const template=state.templates[0];
    if(!template)throw new Error('保存用テンプレートがありません');
    const treatmentLabel=state.workflowStage==='progress'?`${state.treatmentType} 途中経過`:state.treatmentType;
    values.treatment=treatmentLabel;
    const images=imagesForRecord();
    const visitDate=todayDateValue();
    await api('/api/records',{method:'POST',body:JSON.stringify({customerId:customer.id,visitDate,templateId:template.id,chartGender:state.chartGender,values,alerts:[],note:`${genderLabel(state.chartGender)} ${treatmentLabel} OCRから保存`,images})});
    state.partImages[state.workflowStage]='';
    button.textContent='保存済み';toast('カルテ画像・部位写真・OCR結果を保存しました');
  }catch(error){button.disabled=false;button.textContent='保存';toast(error.message)}
}
async function runSelectedFootOcr(){
  const button=$('#runFootOcr'),frame=$('.image-preview-frame');
  if(!button||!frame||!state.image)return;
  button.disabled=true;button.textContent='OCR中…';
  try{const images=state.images.length?state.images:[state.image];const result=await api('/api/ocr/foot',{method:'POST',body:JSON.stringify({images})});['kana','customerNo','name','email','phone','address','birthDate','occupation','footCondition','lifestyle','footCareHistory','consentDate','consentName','treatmentConsentDate','treatmentConsentName','skinTone','keratinCondition','dailyCare','otherNotes'].forEach(key=>{const field=frame.querySelector(`[name="${key}"]`);if(field)field.value=result[key]||''});markOcrReady(frame);toast(`${images.length}枚のOCR結果を入力欄へ反映しました`)}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='OCR'}
}
function enhanceCurrentView(name){
  if(name!=='dashboard')return;
  const recentHeading=$$('.section-head h2').find(element=>element.textContent==='最近の施術記録');
  if(recentHeading){recentHeading.textContent='お客様履歴';setupDashboardPatientSearch(recentHeading.closest('.section-head'))}
  const hero=$('.hero');
  const heading=$('.hero h2');
  if(heading)heading.textContent='カルテOCR';
  const description=$('.hero p');
  if(description)description.remove();
  const readButton=$('.hero>.primary');
  if(readButton)readButton.remove();
  if(hero){
    hero.append(createCameraActions('new'));
    if(state.image||state.images.length)showOcrFormForSelectedButton();
  }
}
async function setupDashboardPatientSearch(sectionHead){
  if(!sectionHead)return;
  sectionHead.classList.add('patient-search-head');
  const resultCard=sectionHead.nextElementSibling;
  if(!resultCard)return;
  const oldAction=sectionHead.querySelector('button');
  const searchFields=document.createElement('div');searchFields.className='patient-search-fields';
  const input=document.createElement('input');
  input.type='search';input.className='patient-search-input';input.placeholder='お客様名で検索';input.setAttribute('aria-label','お客様名で検索');
  const phoneInput=document.createElement('input');
  phoneInput.type='search';phoneInput.inputMode='tel';phoneInput.className='patient-search-input';phoneInput.placeholder='電話番号で検索';phoneInput.setAttribute('aria-label','電話番号で検索');
  const freewordInput=document.createElement('input');
  freewordInput.type='search';freewordInput.className='patient-search-input';freewordInput.placeholder='フリーワード検索';freewordInput.setAttribute('aria-label','フリーワード検索');
  const genderFilter=document.createElement('select');genderFilter.className='patient-gender-filter';genderFilter.setAttribute('aria-label','男女で表示を切り替え');genderFilter.innerHTML='<option value="">男女すべて</option><option value="male">男性</option><option value="female">女性</option>';
  searchFields.append(genderFilter,input,phoneInput,freewordInput);
  if(oldAction)oldAction.replaceWith(searchFields);else sectionHead.append(searchFields);
  try{
    const [customers,records]=await Promise.all([api('/api/customers'),api('/api/records')]);
    const filterPatients=()=>{
      const query=input.value.trim().toLowerCase();
      const phoneQuery=phoneInput.value.replace(/\D/g,'');
      const freewordQuery=freewordInput.value.trim().toLowerCase();
      const gender=genderFilter.value;
      const matches=records.filter(record=>{
        const customer=record.customer||customers.find(item=>item.id===record.customerId)||{};
        const recordGender=customer.gender||(['male','female'].includes(record.chartGender)?record.chartGender:'');
        const genderMatches=!gender||recordGender===gender;
        const nameMatches=`${customer.name||''} ${customer.kana||''}`.toLowerCase().includes(query);
        const phoneMatches=String(customer.phone||'').replace(/\D/g,'').includes(phoneQuery);
        const freewordMatches=`${JSON.stringify(customer)} ${JSON.stringify(record)}`.toLowerCase().includes(freewordQuery);
        return genderMatches&&nameMatches&&phoneMatches&&freewordMatches;
      });
      resultCard.innerHTML=matches.map(record=>{const customer=record.customer||customers.find(item=>item.id===record.customerId)||{},recordGender=customer.gender||record.chartGender||'';return `<div class="record-row history-record-row"><div class="date-box"><b>${esc(String(record.visitDate||'').slice(8,10)||'--')}</b>${esc(String(record.visitDate||'').slice(5,7).replace(/^0/,'')||'--')}月</div><div><b>${esc(customer.name||'お客様情報なし')}</b><small class="muted">${esc(customer.phone||'電話番号未登録')}</small></div><div><b>${esc(record.values?.treatment||'施術記録')}</b><small class="muted">${esc(record.note||record.values?.concern||'')}</small></div><div><span class="badge gender-badge ${esc(recordGender||'unset')}">${esc(genderLabel(recordGender))}</span> <span class="badge">${esc(record.staff||'担当者未登録')}</span></div><button type="button" class="ghost detail-button-active" data-customer-id="${esc(record.customerId)}">詳細</button></div>`}).join('')||'<div class="empty">該当する施術履歴はありません</div>';
      resultCard.querySelectorAll('.detail-button-active[data-customer-id]').forEach(button=>{button.onclick=()=>openCustomer(button.dataset.customerId)});
    };
    genderFilter.onchange=filterPatients;input.oninput=filterPatients;phoneInput.oninput=filterPatients;freewordInput.oninput=filterPatients;
    filterPatients();
  }catch(error){genderFilter.disabled=true;input.disabled=true;phoneInput.disabled=true;freewordInput.disabled=true;input.placeholder='お客様情報を取得できません';toast(error.message)}
}
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
async function renderCustomers(){
  state.customers=await api('/api/customers');
  $('#content').innerHTML=`<div class="searchbar"><input id="customerSearch" placeholder="お名前・電話番号で検索"><select id="customerGenderFilter" aria-label="性別で絞り込み"><option value="">すべて</option><option value="male">男性</option><option value="female">女性</option><option value="unset">未設定</option></select></div><div class="card" id="customerList"></div>`;
  const draw=()=>{const q=$('#customerSearch').value.toLowerCase(),gender=$('#customerGenderFilter').value;const rows=state.customers.filter(c=>(c.name+c.kana+c.phone).toLowerCase().includes(q)&&(!gender||(gender==='unset'?!c.gender:c.gender===gender)));$('#customerList').innerHTML=rows.map(c=>`<div class="customer-row"><div class="avatar">${esc(c.name[0])}</div><div><b>${esc(c.name)}</b><small class="muted">${esc(c.kana)}</small></div><div>${esc(c.phone)}</div><div><span class="badge gender-badge ${esc(c.gender||'unset')}">${esc(genderLabel(c.gender))}</span> ${c.alerts.length?`<span class="badge alert">! ${esc(c.alerts[0])}</span>`:'<span class="badge">注意事項なし</span>'}</div><button class="ghost" onclick="openCustomer('${c.id}')">履歴を見る</button></div>`).join('')||'<div class="empty">該当するお客様はいません</div>'};
  draw();$('#customerSearch').oninput=draw;$('#customerGenderFilter').onchange=draw;
}
async function addCustomer(){const name=prompt('お客様のお名前を入力してください');if(!name)return;const phone=prompt('電話番号（任意）')||'';const customer=await api('/api/customers',{method:'POST',body:JSON.stringify({name,phone})});toast(customer.billing?.tier==='paid'?`お客様を登録しました（有料対象 ${customer.billing.paidCustomers}名）`:`お客様を登録しました（無料枠 ${customer.billing?.companyCustomers||0}/30名）`);renderCustomers()}
async function openCustomer(id){
  const d=await api(`/api/customers/${id}`),c=d.customer;
  const recordsOldestFirst=[...d.records].sort((a,b)=>String(a.visitDate||'').localeCompare(String(b.visitDate||'')));
  const firstRecord=recordsOldestFirst.find(record=>record.values?.address||record.values?.email||record.values?.birthDate)||recordsOldestFirst[0];
  const first={...(firstRecord?.values||{})};
  const basicInfo=[
    ['フリガナ',first.kana||c.kana],['お客様No.',first.customerNo],['メール',first.email],
    ['電話番号',first.phone||c.phone],['住所',first.address],['生年月日',first.birthDate],['職業',first.occupation]
  ];
  $('#pageTitle').textContent='お客様カルテ';$('#pageSub').textContent='施術前に注意事項を確認してください';
  $('#content').innerHTML=`<button type="button" class="ghost" id="backToCustomers">← 一覧に戻る</button><div class="detail-grid" style="margin-top:18px"><section class="card profile"><div class="avatar">${esc(c.name[0])}</div><h2>${esc(c.name)}</h2><p class="muted">${esc(c.kana)}<br>${esc(c.phone)}</p><div class="customer-gender-control"><label>カルテ運用区分<select id="customerGender" ${d.canEdit?'':'disabled'}><option value="" ${!c.gender?'selected':''}>未設定</option><option value="male" ${c.gender==='male'?'selected':''}>男性用</option><option value="female" ${c.gender==='female'?'selected':''}>女性用</option></select></label></div><div class="alert-box"><b>⚠ 施術前注意事項</b>${c.alerts.length?`<ul>${c.alerts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>登録なし</p>'}</div><h3>お好み・ご希望</h3><ul>${c.preferences.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>登録なし</li>'}</ul><p class="muted last-visit">最終来店：${fmt(c.lastVisit)}</p><section class="customer-basic-info"><div class="customer-basic-info-heading"><h3>初回登録情報</h3>${d.canEdit?'<button type="button" class="ghost" id="editBasicInfo">編集</button>':''}</div><div id="basicInfoView">${basicInfo.map(([label,value])=>`<div><small>${esc(label)}</small><span>${esc(value||'未登録')}</span></div>`).join('')}</div><form id="basicInfoForm" class="customer-basic-info-form hidden"><label>お名前<input name="name" required value="${esc(c.name)}"></label><label>フリガナ<input name="kana" value="${esc(first.kana||c.kana||'')}"></label><label>お客様No.<input name="customerNo" value="${esc(first.customerNo||'')}"></label><label>メール<input name="email" type="email" value="${esc(first.email||'')}"></label><label>電話番号<input name="phone" value="${esc(first.phone||c.phone||'')}"></label><label>住所<input name="address" value="${esc(first.address||'')}"></label><label>生年月日<input name="birthDate" value="${esc(first.birthDate||'')}"></label><label>職業<input name="occupation" value="${esc(first.occupation||'')}"></label><div class="customer-basic-info-actions"><button type="button" class="ghost" id="cancelBasicInfo">キャンセル</button><button type="submit" class="primary">保存</button></div><p class="error" id="basicInfoError"></p></form></section></section><section><div class="section-head"><h2>施術タイムライン</h2></div><div class="timeline">${d.records.map(r=>`<article class="card"><div class="field-head"><b>${fmt(r.visitDate)}</b><span><span class="badge gender-badge ${esc(r.chartGender||'unset')}">${esc(genderLabel(r.chartGender))}</span> <span class="badge">${esc(r.staff)}</span></span></div>${r.alerts.length?`<div class="alert-box"><b>注意</b> ${r.alerts.map(esc).join(' ／ ')}</div>`:''}<h3>${esc(r.values.treatment||'施術記録')}</h3><p>${esc(r.note||r.values.concern||'')}</p><small class="muted">${Object.entries(r.values).filter(([k])=>!['treatment','concern'].includes(k)).map(([,v])=>v).filter(Boolean).map(esc).join(' ・ ')}</small></article>`).join('')||'<div class="empty">施術履歴はありません</div>'}</div></section></div>`;
  const profileContact=$('.profile > p.muted');
  if(profileContact&&d.sourceStore){const storeLabel=document.createElement('p');storeLabel.className=`customer-source-store${d.canEdit?'':' read-only'}`;storeLabel.textContent=`登録店舗：${d.sourceStore}${d.canEdit?'':'（閲覧のみ）'}`;profileContact.insertAdjacentElement('afterend',storeLabel)}
  const genderSelect=$('#customerGender');if(genderSelect&&d.canEdit)genderSelect.onchange=async()=>{genderSelect.disabled=true;try{await api(`/api/customers/${id}`,{method:'PUT',body:JSON.stringify({gender:genderSelect.value})});toast('カルテ運用区分を保存しました');await openCustomer(id)}catch(error){toast(error.message);genderSelect.disabled=false}};
  const editBasicInfo=$('#editBasicInfo'),basicInfoView=$('#basicInfoView'),basicInfoForm=$('#basicInfoForm');
  if(editBasicInfo&&basicInfoForm){const toggleBasicInfo=editing=>{basicInfoView.classList.toggle('hidden',editing);basicInfoForm.classList.toggle('hidden',!editing);editBasicInfo.classList.toggle('hidden',editing);if(editing)basicInfoForm.elements.name.focus()};editBasicInfo.onclick=()=>toggleBasicInfo(true);$('#cancelBasicInfo').onclick=()=>toggleBasicInfo(false);basicInfoForm.onsubmit=async event=>{event.preventDefault();const button=event.submitter,values=Object.fromEntries(new FormData(basicInfoForm));button.disabled=true;$('#basicInfoError').textContent='';try{await api(`/api/customers/${id}`,{method:'PUT',body:JSON.stringify({name:values.name,kana:values.kana,phone:values.phone,initialInfo:{customerNo:values.customerNo,email:values.email,address:values.address,birthDate:values.birthDate,occupation:values.occupation}})});toast('初回登録情報を保存しました');await openCustomer(id)}catch(error){$('#basicInfoError').textContent=error.message;button.disabled=false}}}
  const preferenceTitle=[...$$('.profile > h3')].find(element=>element.textContent==='お好み・ご希望');
  const preferenceList=preferenceTitle?.nextElementSibling;
  const preferenceBox=document.createElement('div');preferenceBox.className='preference-box';
  if(preferenceTitle&&preferenceList){preferenceTitle.replaceWith(preferenceBox);preferenceBox.append(preferenceTitle,preferenceList)}
  const alertBox=$('.profile .alert-box'),alertTitle=alertBox.querySelector('b');
  const alertHeader=document.createElement('div');alertHeader.className='alert-box-heading';
  const editAlertButton=document.createElement('button');editAlertButton.type='button';editAlertButton.className='ghost add-alert-button';editAlertButton.textContent='注意を追加';
  if(!d.canEdit){editAlertButton.classList.add('hidden');editAlertButton.title='登録店舗で編集できます'}
  alertBox.insertBefore(alertHeader,alertBox.firstChild);alertHeader.append(alertTitle,editAlertButton);
  const alertEditor=document.createElement('div');alertEditor.className='alert-editor hidden';
  const alertTextarea=document.createElement('textarea');alertTextarea.rows=4;alertTextarea.value=(c.alerts||[]).join('\n');alertTextarea.placeholder='注意事項を1行に1件ずつ入力してください';
  const alertActions=document.createElement('div');alertActions.className='alert-editor-actions';
  const cancelAlertButton=document.createElement('button');cancelAlertButton.type='button';cancelAlertButton.className='ghost';cancelAlertButton.textContent='キャンセル';
  const saveAlertButton=document.createElement('button');saveAlertButton.type='button';saveAlertButton.className='primary';saveAlertButton.textContent='保存';
  alertActions.append(cancelAlertButton,saveAlertButton);alertEditor.append(alertTextarea,alertActions);alertBox.append(alertEditor);
  const toggleAlertEditor=showEditor=>{alertEditor.classList.toggle('hidden',!showEditor);[...alertBox.children].filter(child=>child!==alertHeader&&child!==alertEditor).forEach(child=>child.classList.toggle('hidden',showEditor));if(showEditor)alertTextarea.focus()};
  editAlertButton.onclick=()=>toggleAlertEditor(true);cancelAlertButton.onclick=()=>toggleAlertEditor(false);
  saveAlertButton.onclick=async()=>{saveAlertButton.disabled=true;try{const alerts=alertTextarea.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);await api(`/api/customers/${id}`,{method:'PUT',body:JSON.stringify({alerts})});toast('注意事項を保存しました');await openCustomer(id)}catch(error){toast(error.message);saveAlertButton.disabled=false}};
  const preferenceHeader=document.createElement('div');preferenceHeader.className='preference-box-heading';
  const editPreferenceButton=document.createElement('button');editPreferenceButton.type='button';editPreferenceButton.className='ghost add-preference-button';editPreferenceButton.textContent='好みを追加';
  if(!d.canEdit){editPreferenceButton.classList.add('hidden');editPreferenceButton.title='登録店舗で編集できます'}
  preferenceBox.insertBefore(preferenceHeader,preferenceBox.firstChild);preferenceHeader.append(preferenceTitle,editPreferenceButton);
  const preferenceEditor=document.createElement('div');preferenceEditor.className='preference-editor hidden';
  const preferenceTextarea=document.createElement('textarea');preferenceTextarea.rows=4;preferenceTextarea.value=(c.preferences||[]).join('\n');preferenceTextarea.placeholder='好み・ご希望を1行に1件ずつ入力してください';
  const preferenceActions=document.createElement('div');preferenceActions.className='alert-editor-actions';
  const cancelPreferenceButton=document.createElement('button');cancelPreferenceButton.type='button';cancelPreferenceButton.className='ghost';cancelPreferenceButton.textContent='キャンセル';
  const savePreferenceButton=document.createElement('button');savePreferenceButton.type='button';savePreferenceButton.className='primary';savePreferenceButton.textContent='保存';
  preferenceActions.append(cancelPreferenceButton,savePreferenceButton);preferenceEditor.append(preferenceTextarea,preferenceActions);preferenceBox.append(preferenceEditor);
  const togglePreferenceEditor=showEditor=>{preferenceEditor.classList.toggle('hidden',!showEditor);preferenceList.classList.toggle('hidden',showEditor);if(showEditor)preferenceTextarea.focus()};
  editPreferenceButton.onclick=()=>togglePreferenceEditor(true);cancelPreferenceButton.onclick=()=>togglePreferenceEditor(false);
  savePreferenceButton.onclick=async()=>{savePreferenceButton.disabled=true;try{const preferences=preferenceTextarea.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);await api(`/api/customers/${id}`,{method:'PUT',body:JSON.stringify({preferences})});toast('お好み・ご希望を保存しました');await openCustomer(id)}catch(error){toast(error.message);savePreferenceButton.disabled=false}};
  const timelineArticles=$$('.timeline article');
  d.records.forEach((record,index)=>{const images=(record.images||[]).filter(Boolean);const article=timelineArticles[index];if(!article||!images.length)return;const gallery=document.createElement('div');gallery.className='record-image-gallery';images.forEach((source,imageIndex)=>{const image=document.createElement('img');image.src=source;image.alt=`保存したカルテ画像 ${imageIndex+1}枚目`;image.loading='lazy';image.tabIndex=0;image.setAttribute('role','button');image.onclick=()=>openRecordImage(source,image.alt);image.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openRecordImage(source,image.alt)}};gallery.append(image)});article.append(gallery)});
  $('#backToCustomers').onclick=()=>show('dashboard');
}
async function ensureScanData(){if(!state.customers.length)state.customers=await api('/api/customers');if(!state.templates.length)state.templates=await api('/api/templates');state.selectedTemplate=state.selectedTemplate||state.templates[0]}
async function renderScan(){await ensureScanData();const t=state.selectedTemplate;$('#content').innerHTML=`<div class="scan-layout"><section class="card upload"><div class="toolbar"><label>カルテフォーム<select id="scanTemplate">${state.templates.map(x=>`<option value="${x.id}" ${x.id===t.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>画像を選択<input id="scanFile" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div class="dropzone" id="dropzone">${state.image?`<img src="${state.image}" alt="カルテ画像">`:'<div><div class="empty-icon">▧</div><b>カルテ画像を選択してください</b><p class="muted">PNG / JPEG / WEBP</p></div>'}</div><div class="progress"><i id="ocrProgress"></i></div><div class="actions"><button class="ghost" id="demoOcr">サンプルで試す</button><button class="primary" id="runOcr" ${state.image?'':'disabled'}>✦ AI OCRを実行</button></div></section><section class="card"><div class="section-head"><h2>読取結果の確認</h2><span class="badge">保存前に修正できます</span></div><div id="ocrForm">${state.scan?scanForm(t,state.scan):'<div class="empty">左側で画像を選び<br>AI OCRを実行してください</div>'}</div></section></div>`;$('#scanTemplate').onchange=e=>{state.selectedTemplate=state.templates.find(x=>x.id===e.target.value);state.scan=null;renderScan()};$('#scanFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{state.image=r.result;renderScan()};r.readAsDataURL(f)};$('#demoOcr').onclick=()=>doOcr(true);$('#runOcr').onclick=()=>doOcr(false);bindScanSave()}
function scanForm(t,result){return `<div class="toolbar"><label>紐づけるお客様<select id="recordCustomer"><option value="">選択してください</option>${state.customers.map(c=>`<option value="${c.id}" ${result.customerName===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>来店日<input id="recordDate" type="date" value="${esc(result.visitDate||new Date().toISOString().slice(0,10))}"></label></div>${result.alerts?.length?`<div class="alert-box"><b>⚠ AIが注意事項を検出しました</b><div id="alertChips">${result.alerts.map((x,i)=>`<label style="display:flex;margin:9px 0"><input type="checkbox" checked value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div></div>`:''}<div class="form-fields">${t.fields.map(f=>{const v=result.values?.[f.id]||'',cf=result.confidence?.[f.id];return `<label class="${f.alert?'alert-field':''}"><span class="field-head"><span>${esc(f.label)}${f.required?' *':''}</span>${cf?`<span class="confidence ${cf<.85?'low':''}">読取確度 ${Math.round(cf*100)}%</span>`:''}</span>${f.type==='textarea'?`<textarea data-field="${f.id}" rows="2">${esc(v)}</textarea>`:`<input data-field="${f.id}" type="${f.type==='date'?'date':'text'}" value="${esc(v)}">`}</label>`}).join('')}<label>スタッフメモ<textarea id="recordNote" rows="3" placeholder="施術後の状態、次回への申し送りなど"></textarea></label></div><div class="actions"><button class="primary" id="saveRecord">この内容でカルテを保存</button></div>`}
async function doOcr(demo){try{$('#ocrProgress').style.width='35%';$('#runOcr').disabled=true;const result=await api(demo?'/api/ocr/demo':'/api/ocr',{method:'POST',body:JSON.stringify({templateId:state.selectedTemplate.id,image:state.image})});$('#ocrProgress').style.width='100%';state.scan=result;renderScan();toast('読取が完了しました。内容を確認してください')}catch(e){toast(e.message);$('#ocrProgress').style.width='0';$('#runOcr').disabled=false}}
function bindScanSave(){const b=$('#saveRecord');if(!b)return;b.onclick=async()=>{try{const values=Object.fromEntries($$('[data-field]').map(el=>[el.dataset.field,el.value]));const alerts=$$('#alertChips input:checked').map(x=>x.value);const images=imagesForRecord();await api('/api/records',{method:'POST',body:JSON.stringify({customerId:$('#recordCustomer').value,visitDate:$('#recordDate').value,templateId:state.selectedTemplate.id,values,alerts,note:$('#recordNote').value,images})});state.scan=null;state.image='';state.images=[];state.partImages[state.workflowStage]='';toast('カルテ画像と部位写真を保存しました');show('dashboard')}catch(e){toast(e.message)}}}
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
