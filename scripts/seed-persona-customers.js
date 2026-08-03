const fs = require('fs');
const path = require('path');

const personas = [
  ['P001','高橋 ひなた','タカハシ ヒナタ','female','facial',3,'1992-04-18','会社員','乾燥しやすく頬に赤みが出やすい','低刺激で自然な仕上がり'],
  ['P002','森川 さくら','モリカワ サクラ','female','foot',2,'1987-09-03','販売職','立ち仕事でかかとが乾燥しやすい','保湿を重視したケア'],
  ['P003','小野寺 みなみ','オノデラ ミナミ','female','body',1,'1995-01-26','デザイナー','自己処理で腕に乾燥が出やすい','刺激を抑えた施術'],
  ['P004','相沢 こはる','アイザワ コハル','female','facial',3,'1983-12-11','事務職','口周りの産毛と乾燥が気になる','眉周りを自然に整える'],
  ['P005','水野 しおり','ミズノ シオリ','female','foot',2,'1978-06-29','自営業','足裏の角質とかかとの硬さが気になる','足裏をなめらかに整える'],
  ['P006','桜井 ゆい','サクライ ユイ','female','body',1,'1998-10-07','保育士','脚の自己処理後に赤みが出やすい','保湿を十分に行う'],
  ['P007','白石 あかり','シライシ アカリ','female','facial',3,'1990-02-14','講師','Tゾーンは皮脂が多く頬は乾燥する','肌状態を確認しながら施術'],
  ['P008','藤本 まどか','フジモト マドカ','female','foot',2,'1981-08-22','看護師','靴の圧迫で小指側に角質ができやすい','爪周りを丁寧に整える'],
  ['P009','北川 りん','キタガワ リン','female','body',1,'1996-05-09','美容師','背中とうなじの産毛が気になる','うなじの形を相談して決める'],
  ['P010','石原 ななみ','イシハラ ナナミ','female','facial',3,'1985-11-30','管理職','眉間と口周りに乾燥がある','短時間で落ち着いた施術'],
  ['P011','大野 悠真','オオノ ユウマ','male','foot',2,'1989-03-17','営業職','革靴で足裏とかかとが硬くなりやすい','角質ケアとホームケア案内'],
  ['P012','神谷 直人','カミヤ ナオト','male','body',1,'1993-07-25','エンジニア','胸と腹部の自己処理で刺激を感じる','施術後の鎮静を重視']
];

const serviceData = {
  facial: {
    treatment: 'フェイシャルワックス', details: ['フェイスラインと口周りのワックスケア','眉周りと額のデザイン調整'], products: ['ライコン ピンクini ホットワックス','ライコン プレワックスローション','ライコン ソーシングクリーム'],
    initial: { hairRemovalHistory:'自己処理は月1回程度', waxAreas:'額、眉周り、口周り、フェイスライン', cosmetics:'敏感肌用化粧水と保湿クリーム', dailyCare:'朝晩の洗顔後に保湿' }
  },
  foot: {
    treatment: 'フットケア', details: ['足浴、足裏とかかとの角質ケア、保湿','爪の長さと形の調整、足裏の保湿'], products: ['lyco’pedi フットバスソルト','lyco’pedi 角質リムーバー','lyco’pedi フットクリーム'],
    initial: { footCareHistory:'サロンでのフットケア経験あり', dailyCare:'入浴後に保湿クリームを使用', otherNotes:'靴の圧迫部位を確認して施術' }
  },
  body: {
    treatment: 'ボディワックス', details: ['腕、脚、背中のワックスケア','施術部位の確認、ワックス、鎮静と保湿'], products: ['ライコン プレミアムハードワックス','ライコン プレワックスローション','ライコン アフターワックスローション'],
    initial: { hairRemovalHistory:'電気シェーバーで月2回程度', bodyAreas:'腕、脚、背中、腹部から相談', vioDesign:'対象外', cosmetics:'無香料ボディローション', dailyCare:'入浴後にボディ保湿' }
  }
};

function dateFor(index,visit){const day=String(4+index*2+visit).padStart(2,'0');return visit===0?`2026-05-${day}`:visit===1?`2026-06-${day}`:`2026-07-${day}`}
function buildDataset(){return personas.map(([customerNo,name,kana,gender,service,visits,birthDate,occupation,condition,preference],index)=>{
  const info=serviceData[service], phone=`090-8000-${String(index+1).padStart(4,'0')}`;
  const common={customerNo,name,kana,email:`persona${String(index+1).padStart(2,'0')}@example.invalid`,phone,address:`東京都デモ区サンプル${index+1}丁目`,birthDate,occupation,lifestyle:'睡眠と水分摂取を意識している',skinCondition:condition,...info.initial,treatment:`${info.treatment} 新規登録`};
  const records=[{recordType:'registration_sheet',visitDate:dateFor(index,0),staff:'佐藤 あい',values:common,note:'OCRを使用せず新規登録シートの項目から作成'}];
  for(let visit=1;visit<visits;visit++)records.push({recordType:'treatment_entry',visitDate:dateFor(index,visit),staff:visit===1?'佐藤 あい':'中村 めぐみ',values:{recordNo:`${customerNo}-${visit+1}`,name,serviceDateTime:`${dateFor(index,visit)} 10:00`,staff:visit===1?'佐藤 あい':'中村 めぐみ',treatment:info.treatment,treatmentDetails:info.details[visit-1],productsUsed:info.products.join('\n'),comment:`${condition}を確認。${preference}を反映し、施術後のホームケアを案内。`,retail:info.products.at(-1),discount:visit===1?'再来店特典 5%OFF':'',amount:service==='body'?'15400円':service==='foot'?'7700円':'9900円',discountedAmount:visit===1?(service==='body'?'14630円':service==='foot'?'7315円':'9405円'):''},note:'施術入力画面の項目から作成'});
  return {name,kana,phone,gender,alerts:condition.includes('赤み')?['刺激と赤みを確認']:[],preferences:[preference],records};
})}

function loadEnv(){const file=path.join(__dirname,'..','.env');if(!fs.existsSync(file))return;for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const at=line.indexOf('=');if(at<1)continue;const key=line.slice(0,at).trim();let value=line.slice(at+1).trim().replace(/^['"]|['"]$/g,'');if(!(key in process.env))process.env[key]=value}}
async function run(){loadEnv();const baseUrl=(process.argv[2]||'http://127.0.0.1:8798').replace(/\/$/,'');const tenantId=process.argv[3]||'tenant-b62ed88b';const login=await fetch(`${baseUrl}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:process.env.SYSTEM_ADMIN_ID||'admin',password:process.env.SYSTEM_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD})});const auth=await login.json();if(!login.ok)throw new Error(auth.error||'Login failed');const response=await fetch(`${baseUrl}/api/admin/tenants/${encodeURIComponent(tenantId)}/customer-dataset`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.token}`},body:JSON.stringify({confirm:'CREATE_PERSONA_CUSTOMERS',customers:buildDataset()})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Import failed');process.stdout.write(`${JSON.stringify(result)}\n`)}
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={buildDataset};
