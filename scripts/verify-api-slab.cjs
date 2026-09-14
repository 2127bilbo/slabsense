(async()=>{
const {makeHandler}=await import('../api/_lib/routes/slab-get.js');
function res(){const r={code:200,body:null,headers:{}};r.setHeader=(k,v)=>{r.headers[k]=v;};r.status=c=>{r.code=c;return r;};r.json=b=>{r.body=b;return r;};r.end=()=>r;return r;}
const row={cert:'SS26-00001',status:'paid',card_name:'Pikachu V',grade_value:10};
let calls=0;const db={from:(t)=>{calls++;return ({select:()=>({eq:(c,v)=>({maybeSingle:async()=>({data:(t==='slab_public'&&v==='SS26-00001')?row:null,error:null})})})});}};
const h=makeHandler(db);let bad=0;
let r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.code!==200||r.body.slab.card_name!=='Pikachu V'){console.log('FAIL found',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{cert:'ss26-00001'}},r);if(r.code!==200){console.log('FAIL case-insensitive',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-99999'}},r);if(r.code!==404||r.body.error!=='not_found'){console.log('FAIL 404',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{}},r);if(r.code!==400){console.log('FAIL 400',r.code);bad++;}
r=res();await h({method:'POST',query:{cert:'SS26-00001'}},r);if(r.code!==405){console.log('FAIL 405',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.headers['Cache-Control']!=='public, max-age=60, s-maxage=60'){console.log('FAIL cache header',r.headers);bad++;}
r=res();const before=calls;await h({method:'GET',query:{cert:"SS26-1' or 1=1"}},r);if(r.code!==404||r.body.error!=='not_found'){console.log('FAIL malformed 404',r.code,r.body);bad++;}if(calls!==before){console.log('FAIL malformed cert hit the db');bad++;}
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
