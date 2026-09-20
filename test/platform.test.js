const test = require('node:test');
const assert = require('node:assert/strict');
const Platform = require('../src/platform');

test('detectRuntime identifies TornPDA from native storage or PDA HTTP bridge', () => {
  assert.equal(Platform.detectRuntime({}).isTornPda,false);
  assert.equal(Platform.detectRuntime({PDA_storage:{loadAll(){}}}).isTornPda,true);
  assert.equal(Platform.detectRuntime({PDA_httpGet(){}}).isTornPda,true);
});

test('TornPDA storage loads durable state and migrates missing GM values once', async () => {
  const durable={existing:'durable'};
  const migrated={};
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {...durable};},
      async setMany(values){Object.assign(migrated,values);},
      async set(key,value){durable[key]=value;}
    },
    gmGetValue:(key,fallback)=>key==='legacy'?'from-gm':fallback,
    gmSetValue:()=>{},
    keys:['existing','legacy']
  });
  await storage.initialize();
  assert.equal(storage.get('existing','x'),'durable');
  assert.equal(storage.get('legacy','x'),'from-gm');
  assert.deepEqual(migrated,{legacy:'from-gm'});
});

test('TornPDA storage writes update synchronous cache and durable adapter', async () => {
  const writes=[];
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{async loadAll(){return {};},async set(key,value){writes.push([key,value]);}},
    keys:[]
  });
  await storage.initialize();
  storage.set('panel',{x:1});
  assert.deepEqual(storage.get('panel',null),{x:1});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(writes,[['panel',{x:1}]]);
});

test('TornPDA request adapter serializes POST bodies and keeps bodyless DELETE supported', async () => {
  const calls=[];
  const globalObject={
    async PDA_httpPost(url,headers,body){calls.push(['POST',url,headers,body]);return {status:200,responseText:'{"ok":true}'};},
    async PDA_httpDelete(url,headers){calls.push(['DELETE',url,headers]);return {status:204,responseText:''};}
  };
  const request=Platform.createRequestAdapter({runtime:{isTornPda:true},globalObject});
  const post=await request({method:'POST',url:'https://example.test/v1/x',headers:{Accept:'application/json'},body:{a:1}});
  assert.equal(post.status,200);
  assert.deepEqual(post.body,{ok:true});
  assert.equal(calls[0][3],'{"a":1}');
  assert.equal(calls[0][2]['Content-Type'],'application/json');
  const del=await request({method:'DELETE',url:'https://example.test/v1/key',headers:{}});
  assert.equal(del.status,204);
});

test('TornPDA request adapter rejects DELETE bodies rather than silently dropping confirmation', async () => {
  const request=Platform.createRequestAdapter({
    runtime:{isTornPda:true},
    globalObject:{async PDA_httpDelete(){throw new Error('must not be called');}}
  });
  await assert.rejects(
    ()=>request({method:'DELETE',url:'https://example.test/v1/account',body:{confirm:'DELETE'}}),
    error=>error && error.code==='TORNPDA_DELETE_BODY_UNSUPPORTED'
  );
});

test('desktop request adapter preserves GM transport JSON behavior', async () => {
  const request=Platform.createRequestAdapter({
    runtime:{isTornPda:false},
    gmXmlHttpRequest:options=>{
      assert.equal(options.method,'POST');
      assert.equal(options.data,'{"a":1}');
      options.onload({status:200,responseText:'{"ok":true}'});
    }
  });
  const response=await request({method:'POST',url:'https://example.test',body:{a:1}});
  assert.deepEqual(response.body,{ok:true});
});

test('resume hooks coalesce TornPDA focus/pageshow/visibility events', async () => {
  const listeners=new Map();
  const window={
    addEventListener:(name,fn)=>listeners.set('w:'+name,fn),
    removeEventListener:()=>{}
  };
  const document={
    visibilityState:'visible',
    addEventListener:(name,fn)=>listeners.set('d:'+name,fn),
    removeEventListener:()=>{}
  };
  let calls=0;
  const cleanup=Platform.installResumeHooks({runtime:{isTornPda:true},window,document,callback:()=>{calls++;}});
  listeners.get('w:focus')();
  listeners.get('w:pageshow')();
  listeners.get('d:visibilitychange')();
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(calls,1);
  cleanup();
});
