(async()=>{
const {slabSessionParams,pickImages,copySlabImages,mintSlab,SLAB_PRICE_KEY}=await import('../api/_lib/slabs.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};

// slabSessionParams
const p=slabSessionParams({customerId:'cus_1',userId:'u1',scanId:'s1',priceId:'price_slab',successUrl:'https://x/ok',cancelUrl:'https://x/no'});
if(p.mode!=='payment')fail('mode',p.mode);
if(!p.shipping_address_collection||p.shipping_address_collection.allowed_countries.join()!=='US')fail('shipping',p.shipping_address_collection);
if(p.metadata.scan_id!=='s1'||p.metadata.price_key!==SLAB_PRICE_KEY||p.metadata.user_id!=='u1'||p.metadata.price_id!=='price_slab')fail('metadata',p.metadata);
if(p.line_items.length!==1||p.line_items[0].price!=='price_slab'||p.line_items[0].quantity!==1)fail('line_items',p.line_items);
if(p.customer!=='cus_1'||p.success_url!=='https://x/ok'||p.cancel_url!=='https://x/no')fail('urls');

// pickImages
if(JSON.stringify(pickImages({user_card_image:'a',enhanced_front_path:'b',front_image_path:'c',enhanced_back_path:'d',back_image_path:'e'}))!=='{"front":"a","back":"d"}')fail('pick 1');
if(JSON.stringify(pickImages({front_image_path:'c',back_image_path:'e'}))!=='{"front":"c","back":"e"}')fail('pick 2');
if(JSON.stringify(pickImages({}))!=='{"front":null,"back":null}')fail('pick 3');

// fakes
function fakeStorage(){const up=[];return {uploads:up,from:(b)=>({upload:async(path,buf,opts)=>{up.push({b,path,len:buf.length,opts});return {data:{path},error:null};},getPublicUrl:(path)=>({data:{publicUrl:'https://cdn/'+b+'/'+path}})})};}
const fetchOk=async(url)=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer,headers:{get:()=>'image/jpeg'}});
const fetchBad=async(url)=>({ok:false,status:404});

// copySlabImages
let st=fakeStorage();
let r=await copySlabImages({storage:st,fetchImpl:fetchOk},'SS26-00007',{front:'https://src/f.jpg',back:'https://src/b.jpg'});
if(r.front_image_url!=='https://cdn/slab-images/SS26-00007/front.jpg'||r.back_image_url!=='https://cdn/slab-images/SS26-00007/back.jpg')fail('copy urls',r);
if(st.uploads.length!==2||st.uploads[0].path!=='SS26-00007/front.jpg'||st.uploads[0].opts.contentType!=='image/jpeg'||st.uploads[0].opts.upsert!==true)fail('copy uploads',st.uploads);
st=fakeStorage();r=await copySlabImages({storage:st,fetchImpl:fetchBad},'SS26-00008',{front:'https://src/f.jpg',back:null});
if(r.front_image_url!==null||r.back_image_url!==null||st.uploads.length!==0)fail('copy failure tolerated',r,st.uploads);

// mintSlab fake db
function fakeDb(state){
  state.slabs=state.slabs||[];state.updates=[];
  const rowFor=(t,f,v)=>t==='slabs'?state.slabs.find(x=>x[f]===v)||null:(t==='scans'&&state.scan&&state.scan[f]===v?state.scan:null);
  return {calls:state,from:(t)=>({
    select:()=>({eq:(f,v)=>({maybeSingle:async()=>({data:rowFor(t,f,v),error:null})})}),
    insert:(row)=>({select:()=>({single:async()=>{if(t!=='slabs')throw new Error('insert '+t);const s={id:'slab_'+(state.slabs.length+1),cert:'SS26-0000'+(state.slabs.length+1),status:'paid',...row};state.slabs.push(s);return {data:s,error:null};}})}),
    update:(patch)=>({eq:async(f,v)=>{state.updates.push({t,patch,f,v});const s=rowFor(t,f,v);if(s)Object.assign(s,patch);return {data:null,error:null};}})
  })};
}
const scan={id:'scan1',user_id:'u1',user_card_image:'https://src/f.jpg',back_image_path:'https://src/b.jpg'};
let db=fakeDb({scan});st=fakeStorage();const logs=[];
r=await mintSlab({db,storage:st,fetchImpl:fetchOk,log:(...a)=>logs.push(a.join(' '))},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_1',shipping:{name:'Bob',address:{country:'US'}}});
if(!r.created||r.slab.cert!=='SS26-00001'||r.slab.scan_id!=='scan1'||r.slab.user_id!=='u1'||r.slab.stripe_session_id!=='cs_1'||!r.slab.shipping)fail('mint create',r);
if(r.slab.front_image_url!=='https://cdn/slab-images/SS26-00001/front.jpg'||r.slab.back_image_url!=='https://cdn/slab-images/SS26-00001/back.jpg')fail('mint image urls',r.slab);
if(db.calls.updates.length!==1||db.calls.updates[0].f!=='id')fail('mint update by id',db.calls.updates);
// replay: same session id → existing row, no insert, no upload
const before=db.calls.slabs.length,ups=st.uploads.length;
r=await mintSlab({db,storage:st,fetchImpl:fetchOk,log:()=>{}},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_1',shipping:null});
if(r.created||db.calls.slabs.length!==before||st.uploads.length!==ups||r.slab.cert!=='SS26-00001')fail('mint replay',r);
// scan missing → throws (order must not be silently dropped)
let threw=false;try{await mintSlab({db:fakeDb({}),storage:fakeStorage(),fetchImpl:fetchOk,log:()=>{}},{scanId:'nope',userId:'u1',stripeSessionId:'cs_2',shipping:null});}catch(e){threw=/scan/i.test(e.message);}
if(!threw)fail('mint missing scan throws');
// scan owned by someone else → throws
threw=false;try{await mintSlab({db:fakeDb({scan}),storage:fakeStorage(),fetchImpl:fetchOk,log:()=>{}},{scanId:'scan1',userId:'u2',stripeSessionId:'cs_3',shipping:null});}catch(e){threw=/owner|belong/i.test(e.message);}
if(!threw)fail('mint wrong owner throws');
// image copy failure → row still created, urls null, logged
db=fakeDb({scan});r=await mintSlab({db,storage:fakeStorage(),fetchImpl:fetchBad,log:(...a)=>logs.push(a.join(' '))},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_4',shipping:null});
if(!r.created||r.slab.front_image_url!==null)fail('mint tolerates copy failure',r);
if(!logs.some(l=>/image/i.test(l)&&/SS26-/.test(l)))fail('copy failure logged with cert',logs);

console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
