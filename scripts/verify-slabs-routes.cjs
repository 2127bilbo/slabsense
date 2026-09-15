(async()=>{
const L=await import('../api/_lib/slabs.js');
const {makeHandler:mkQueue}=await import('../api/_lib/routes/slabs-queue.js');
const {makeHandler:mkStatus}=await import('../api/_lib/routes/slabs-status.js');
const {makeHandler:mkConfig}=await import('../api/_lib/routes/slabs-config.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};
function res(){return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;},end(){return this;}};}
// lib
try{L.assertTransition('paid','engraved');L.assertTransition('engraved','shipped');}catch(e){fail('good transitions',e);}
for(const [a,b] of [['paid','shipped'],['engraved','engraved'],['shipped','paid'],['paid','paid']]){let t=false;try{L.assertTransition(a,b);}catch(e){t=e.message==='bad_transition';}if(!t)fail('bad transition '+a+'>'+b);}
const now=new Date('2026-09-14T10:00:00Z');
if(JSON.stringify(L.statusPatch('engraved',now))!=='{"status":"engraved","engraved_at":"2026-09-14T10:00:00.000Z"}')fail('patch engraved');
if(JSON.stringify(L.statusPatch('shipped',now))!=='{"status":"shipped","shipped_at":"2026-09-14T10:00:00.000Z"}')fail('patch shipped');
const san=L.sanitizeSettings({W:69,secret:'s3',useToken:true,base:'x/'});if('secret' in san||san.useToken!==false||san.W!==69)fail('sanitize',san);
const flat=L.flattenQueueRow({cert:'SS26-00001',status:'paid',scans:{id:'s1',card_name:'Glaceon',grade_value:9}});if(flat.scan.card_name!=='Glaceon'||'scans' in flat||flat.cert!=='SS26-00001')fail('flatten',flat);
// fakes
const admin={auth:{getUser:async(t)=>t==='adm'?{data:{user:{id:'u1'}},error:null}:t==='usr'?{data:{user:{id:'u2'}},error:null}:{data:{user:null},error:{message:'x'}}}};
const rows=[{cert:'SS26-00001',status:'paid',paid_at:'2026-09-13',scans:{id:'s1',card_name:'Glaceon'}},{cert:'SS26-00002',status:'paid',paid_at:'2026-09-14',scans:{id:'s2',card_name:'Pikachu'}}];
function fakeDb(){const st={rows:rows.map(r=>({...r})),updates:[],uploads:[]};
  const q=(t)=>{let f=[],ord=null;const b={select:()=>b,eq:(k,v)=>{f.push([k,v]);return b;},order:(k,o)=>{ord=[k,o];return b;},limit:()=>b,
    maybeSingle:async()=>({data:st.rows.find(r=>f.every(([k,v])=>r[k]===v))||null,error:null}),
    update:(patch)=>{const conds=[];const u={eq:(k,v)=>{conds.push([k,v]);return u;},then:(ok)=>{const r=st.rows.find(r=>conds.every(([k,v])=>r[k]===v));if(r)Object.assign(r,patch);st.updates.push({patch,k:conds[0][0],v:conds[0][1]});return ok({data:null,error:null});}};return u;},
    then:(ok)=>ok({data:st.rows.filter(r=>f.every(([k,v])=>r[k]===v)),error:null})};
    return b;};
  return {st,auth:admin.auth,from:q,storage:{from:(bk)=>({upload:async(p,body,o)=>{st.uploads.push({bk,p,len:String(body).length,o});return {data:{path:p},error:null};}})}};
}
const deps=(db)=>({db,adminIds:new Set(['u1'])});
// config
let r=res();await mkConfig({env:{VITE_SUPABASE_URL:'https://x.supabase.co',VITE_SUPABASE_ANON_KEY:'anon'}})({method:'GET',headers:{}},r);
if(r.code!==200||r.body.supabaseUrl!=='https://x.supabase.co'||r.body.anonKey!=='anon')fail('config',r.body);
// queue auth
let db=fakeDb();r=res();await mkQueue(deps(db))({method:'GET',headers:{},query:{status:'paid'}},r);if(r.code!==401)fail('queue 401',r.code);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer usr'},query:{status:'paid'}},r);if(r.code!==403)fail('queue 403',r.code);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'paid'}},r);
if(r.code!==200||r.body.rows.length!==2||r.body.rows[0].scan.card_name!=='Glaceon')fail('queue rows',r.code,r.body);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'paid',q:'pika'}},r);if(r.body.rows.length!==1||r.body.rows[0].cert!=='SS26-00002')fail('queue search',r.body);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'bogus'}},r);if(r.code!==400)fail('queue bad status',r.code);
// status: engrave
const svg='<?xml version="1.0"?><svg/>';const lt={name:'GLACEON',cert:'SS26-00001',grade:'9',gradeWord:'MINT'};
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved'}},r);if(r.code!==400||r.body.error!=='svg_required')fail('svg required',r.code,r.body);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved',svg,label_text:Object.assign({},lt,{cert:'SS26-09999'}),label_settings:{}}},r);
if(r.code!==400||r.body.error!=='label_text_mismatch')fail('label_text mismatch',r.code,r.body);
if(db.st.uploads.length!==0)fail('label_text mismatch should not upload',db.st.uploads);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved',svg,label_text:lt,label_settings:{W:69,secret:'z',useToken:true}}},r);
if(r.code!==200||r.body.slab.status!=='engraved'||!r.body.slab.engraved_at)fail('engrave',r.code,r.body);
if(db.st.uploads.length!==1||db.st.uploads[0].bk!=='slab-labels'||db.st.uploads[0].p!=='SS26-00001.svg'||db.st.uploads[0].o.contentType!=='image/svg+xml')fail('svg upload',db.st.uploads);
const up=db.st.updates.find(u=>u.patch.status==='engraved').patch;if(up.label_svg_path!=='SS26-00001.svg'||up.label_text.name!=='GLACEON'||'secret' in up.label_settings||up.label_settings.useToken!==false)fail('engrave patch',up);
// status: bad transition, ship, not found
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved',svg,label_text:lt,label_settings:{}}},r);if(r.code!==409)fail('re-engrave 409',r.code);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'shipped'}},r);if(r.code!==200||r.body.slab.status!=='shipped'||!r.body.slab.shipped_at)fail('ship',r.code,r.body);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-99999',status:'shipped'}},r);if(r.code!==404)fail('status 404',r.code);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer usr'},body:{cert:'SS26-00002',status:'shipped'}},r);if(r.code!==403)fail('status 403',r.code);
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
