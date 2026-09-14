// The single /api/slabs function must route ?action= to the right handler and 404 unknown actions.
(async()=>{
const {makeHandler}=await import('../api/slabs.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};
function res(){return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;},end(){return this;}};}
const row={cert:'SS26-00001',status:'paid',card_name:'Glaceon'};
const db={auth:{getUser:async(t)=>t==='adm'?{data:{user:{id:'u1'}},error:null}:{data:{user:null},error:{message:'x'}}},
  from:(t)=>{let f=[];const b={select:()=>b,eq:(k,v)=>{f.push([k,v]);return b;},order:()=>b,limit:()=>b,
    maybeSingle:async()=>({data:(t==='slab_public'||t==='slabs')&&f.some(([k,v])=>k==='cert'&&v==='SS26-00001')?row:null,error:null}),
    then:(ok)=>ok({data:[row],error:null})};return b;}};
const h=makeHandler({db,adminIds:new Set(['u1']),env:{VITE_SUPABASE_URL:'https://x.supabase.co',VITE_SUPABASE_ANON_KEY:'anon'}});
let r=res();await h({method:'GET',headers:{},query:{cert:'SS26-00001'}},r);if(r.code!==200||r.body.slab.cert!=='SS26-00001')fail('default action = get',r.code,r.body);
r=res();await h({method:'GET',headers:{},query:{action:'get',cert:'SS26-00001'}},r);if(r.code!==200)fail('explicit get',r.code);
r=res();await h({method:'GET',headers:{},query:{action:'config'}},r);if(r.code!==200||r.body.anonKey!=='anon')fail('config',r.code,r.body);
r=res();await h({method:'GET',headers:{},query:{action:'queue',status:'paid'}},r);if(r.code!==401)fail('queue needs auth',r.code);
r=res();await h({method:'GET',headers:{authorization:'Bearer adm'},query:{action:'queue',status:'paid'}},r);if(r.code!==200||!Array.isArray(r.body.rows))fail('queue as admin',r.code,r.body);
r=res();await h({method:'POST',headers:{authorization:'Bearer adm'},query:{action:'status'},body:{cert:'SS26-00001',status:'shipped'}},r);if(r.code!==409)fail('status routed (paid->shipped is 409)',r.code,r.body);
r=res();await h({method:'GET',headers:{},query:{action:'bogus'}},r);if(r.code!==404||r.body.error!=='not_found')fail('unknown action',r.code,r.body);
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
