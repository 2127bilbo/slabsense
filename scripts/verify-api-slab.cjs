(async()=>{
const {makeHandler}=await import('../api/slab.js');
function res(){const r={code:200,body:null,headers:{}};r.setHeader=(k,v)=>{r.headers[k]=v;};r.status=c=>{r.code=c;return r;};r.json=b=>{r.body=b;return r;};r.end=()=>r;return r;}
const row={cert:'SS26-00001',status:'paid',card_name:'Pikachu V',grade_value:10};
const db={from:(t)=>({select:()=>({eq:(c,v)=>({maybeSingle:async()=>({data:(t==='slab_public'&&v==='SS26-00001')?row:null,error:null})})})})};
const h=makeHandler(db);let bad=0;
let r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.code!==200||r.body.slab.card_name!=='Pikachu V'){console.log('FAIL found',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{cert:'ss26-00001'}},r);if(r.code!==200){console.log('FAIL case-insensitive',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-99999'}},r);if(r.code!==404||r.body.error!=='not_found'){console.log('FAIL 404',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{}},r);if(r.code!==400){console.log('FAIL 400',r.code);bad++;}
r=res();await h({method:'POST',query:{cert:'SS26-00001'}},r);if(r.code!==405){console.log('FAIL 405',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.headers['Cache-Control']!=='public, max-age=60'){console.log('FAIL cache header',r.headers);bad++;}
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
