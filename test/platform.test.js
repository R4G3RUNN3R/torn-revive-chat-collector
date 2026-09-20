const test = require('node:test');
const assert = require('node:assert/strict');
const Platform = require('../src/platform');

function pdaGlobals(overrides = {}) {
  const {PDA_storage:storageOverrides,...rest}=overrides;
  return {
    flutter_inappwebview:{callHandler(){}},
    PDA_storage:{
      async loadAll(){ return {}; },
      async set(){},
      ...storageOverrides
    },
    async PDA_httpGet(){ return {status:200,responseText:'{}'}; },
    async PDA_httpPost(){ return {status:200,responseText:'{}'}; },
    ...rest
  };
}

test('detectRuntime tolerates TornPDA bridge/helper injection timing without accepting partial helper pairs', () => {
  assert.equal(Platform.detectRuntime({}).isTornPda,false);
  assert.equal(Platform.detectRuntime({PDA_storage:{loadAll(){},set(){}}}).isTornPda,false);
  assert.equal(Platform.detectRuntime({PDA_httpGet(){},PDA_httpPost(){}}).isTornPda,false);
  assert.equal(Platform.detectRuntime({...pdaGlobals(),flutter_inappwebview:null}).isTornPda,true);
  assert.equal(Platform.detectRuntime({flutter_inappwebview:{callHandler(){}}}).isTornPda,true);
  assert.equal(Platform.detectRuntime(pdaGlobals()).isTornPda,true);
});

test('TornPDA storage loads durable state, migrates missing GM values, and clears migrated legacy copies', async () => {
  const durable={existing:'durable'};
  const migrated={};
  const gmWrites=[];
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {...durable};},
      async setMany(values){Object.assign(migrated,values);},
      async set(key,value){durable[key]=value;}
    },
    gmGetValue:(key,fallback)=>key==='legacy'?'from-gm':fallback,
    gmSetValue:(key,value)=>gmWrites.push([key,value]),
    keys:['existing','legacy'],
    legacyDefaults:{legacy:null}
  });
  await storage.initialize();
  assert.equal(storage.mode(),'pda');
  assert.equal(storage.get('existing','x'),'durable');
  assert.equal(storage.get('legacy','x'),'from-gm');
  assert.deepEqual(migrated,{legacy:'from-gm'});
  assert.deepEqual(gmWrites,[['legacy',null],[Platform.FALLBACK_DIRTY_KEY,false]]);
});

test('TornPDA storage falls back to GM storage if native initialization fails', async () => {
  const gm = {token:'legacy-token'};
  const errors=[];
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){throw new Error('storage unavailable');},
      async set(){throw new Error('must not write');}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token'],
    onError:(error,context)=>errors.push([context,error.message])
  });
  await storage.initialize();
  assert.equal(storage.mode(),'gm');
  assert.equal(storage.get('token',''),'legacy-token');
  storage.set('token','new-token');
  assert.equal(gm.token,'new-token');
  assert.equal(errors[0][0],'storage.pda.initialize');
});



test('TornPDA migration write failure preserves loaded durable state when degrading to GM', async () => {
  const gm={token:'stale-token',legacy:'legacy-value'};
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {token:'durable-token'};},
      async setMany(){throw Object.assign(new Error('full'),{code:'QuotaExceeded'});},
      async set(){}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token','legacy'],
    legacyDefaults:{legacy:null}
  });
  await storage.initialize();
  assert.equal(storage.mode(),'gm');
  assert.equal(storage.get('token',''),'durable-token');
  assert.equal(gm.token,'durable-token');
  assert.equal(gm.legacy,'legacy-value');
  assert.equal(gm[Platform.FALLBACK_DIRTY_KEY],true);
});

test('TornPDA restart reconciles newer dirty GM fallback state back into native storage', async () => {
  const gm={token:'fallback-new',[Platform.FALLBACK_DIRTY_KEY]:true};
  const native={token:'native-stale'};
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {...native};},
      async setMany(values){Object.assign(native,values);},
      async set(key,value){native[key]=value;}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token'],
    legacyDefaults:{token:''}
  });
  await storage.initialize();
  assert.equal(storage.mode(),'pda');
  assert.equal(storage.get('token',''),'fallback-new');
  assert.equal(native.token,'fallback-new');
  assert.equal(gm.token,'');
  assert.equal(gm[Platform.FALLBACK_DIRTY_KEY],false);
});

test('TornPDA storage write synchronous throw degrades safely to GM', async () => {
  const gm={};
  let shouldThrow=false;
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {token:'native'};},
      set(){if(shouldThrow) throw new Error('sync failure'); return Promise.resolve();}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token']
  });
  await storage.initialize();
  shouldThrow=true;
  assert.doesNotThrow(()=>storage.set('token','changed'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(storage.mode(),'gm');
  assert.equal(gm.token,'changed');
  assert.equal(gm[Platform.FALLBACK_DIRTY_KEY],true);
});

test('TornPDA storage write failure degrades to GM and preserves cached state', async () => {
  const gm={};
  let fail=false;
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {token:'durable-token'};},
      async set(key,value){if(fail) throw new Error('quota');}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token']
  });
  await storage.initialize();
  assert.equal(storage.mode(),'pda');
  fail=true;
  storage.set('token','new-token');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(storage.mode(),'gm');
  assert.equal(gm.token,'new-token');
  assert.equal(storage.get('token',''),'new-token');
});

test('TornPDA request adapter serializes explicit and bodyless POSTs and keeps bodyless DELETE supported', async () => {
  const calls=[];
  const globalObject=pdaGlobals({
    async PDA_httpPost(url,headers,body){calls.push(['POST',url,headers,body]);return {status:200,responseText:'{"ok":true}'};},
    async PDA_httpDelete(url,headers){calls.push(['DELETE',url,headers]);return {status:204,responseText:''};}
  });
  const request=Platform.createRequestAdapter({runtime:{isTornPda:true},globalObject});
  const post=await request({method:'POST',url:'https://example.test/v1/x',headers:{Accept:'application/json'},body:{a:1}});
  assert.equal(post.status,200);
  assert.deepEqual(post.body,{ok:true});
  assert.equal(calls[0][3],'{"a":1}');
  assert.equal(calls[0][2]['Content-Type'],'application/json');

  await request({method:'POST',url:'https://example.test/v1/empty',headers:{}});
  assert.equal(calls[1][3],'{}');
  assert.equal(calls[1][2]['Content-Type'],'application/json');

  const del=await request({method:'DELETE',url:'https://example.test/v1/key',headers:{}});
  assert.equal(del.status,204);
});

test('TornPDA request adapter rejects DELETE bodies rather than silently dropping confirmation', async () => {
  const globalObject=pdaGlobals({async PDA_httpDelete(){throw new Error('must not be called');}});
  const request=Platform.createRequestAdapter({runtime:{isTornPda:true},globalObject});
  await assert.rejects(
    ()=>request({method:'DELETE',url:'https://example.test/v1/account',body:{confirm:'DELETE'}}),
    error=>error && error.code==='TORNPDA_DELETE_BODY_UNSUPPORTED'
  );
});

test('TornPDA request adapter bounds hung native requests', async () => {
  const globalObject=pdaGlobals({PDA_httpGet:()=>new Promise(()=>{})});
  const request=Platform.createRequestAdapter({runtime:{isTornPda:true},globalObject});
  await assert.rejects(
    ()=>request({method:'GET',url:'https://example.test/v1/hang',timeoutMs:5}),
    error=>error && error.code==='NETWORK_ERROR' && error.retryable===true
  );
});

test('TornPDA request adapter falls back to GM transport when an optional native method is unavailable', async () => {
  let gmMethod=null;
  const globalObject=pdaGlobals();
  const request=Platform.createRequestAdapter({
    runtime:{isTornPda:true},
    globalObject,
    gmXmlHttpRequest:options=>{
      gmMethod=options.method;
      options.onload({status:200,responseText:'{"ok":true}'});
    }
  });
  const response=await request({method:'PATCH',url:'https://example.test/v1/x',body:{a:1}});
  assert.equal(gmMethod,'PATCH');
  assert.deepEqual(response.body,{ok:true});
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

test('PDA notifier stacks multiple notifications instead of overlapping fixed toasts', () => {
  const byId=new Map();
  function node(tag) {
    return {
      tagName:String(tag).toUpperCase(),
      id:'',
      className:'',
      children:[],
      setAttribute(){},
      append(...children){
        this.children.push(...children);
        for(const child of children){if(child.id) byId.set(child.id,child);}
      },
      appendChild(child){this.append(child);},
      addEventListener(){},
      remove(){},
      textContent:''
    };
  }
  const document={
    body:node('body'),
    createElement:node,
    getElementById:id=>byId.get(id)||null
  };
  const notify=Platform.createNotifier({runtime:{isTornPda:true},document});
  assert.equal(notify({title:'One',text:'First',timeout:3000}),true);
  assert.equal(notify({title:'Two',text:'Second',timeout:3000}),true);
  const stack=document.body.children[0];
  assert.equal(stack.id,'rr-pda-toast-stack');
  assert.equal(stack.children.length,2);
});


test('TornPDA navigation uses current WebView for approved HTTPS update and Torn links', () => {
  const assigned=[];
  const window={
    location:{href:'https://www.torn.com/index.php',assign:url=>assigned.push(url)},
    open(){throw new Error('TornPDA must not use popup navigation');}
  };
  const globals=pdaGlobals();
  const platform=Platform.createPlatform({
    globalObject:globals,
    window,
    document:{},
    gm:{}
  });
  assert.equal(platform.runtime.isTornPda,true);
  assert.equal(platform.openUrl('https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js'),true);
  assert.equal(platform.openUrl('https://www.torn.com/preferences.php#tab=api'),true);
  assert.equal(platform.openUrl('http://www.torn.com/'),false);
  assert.equal(platform.openUrl('https://evil.example/steal'),false);
  assert.deepEqual(assigned,[
    'https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js',
    'https://www.torn.com/preferences.php#tab=api'
  ]);
});

test('desktop navigation preserves new-tab behavior only for approved HTTPS hosts', () => {
  const opened=[];
  const window={
    location:{href:'https://www.torn.com/index.php'},
    open:(...args)=>{opened.push(args); return null;}
  };
  const platform=Platform.createPlatform({
    globalObject:{},
    window,
    document:{},
    gm:{xmlHttpRequest(){}}
  });
  assert.equal(platform.runtime.isTornPda,false);
  assert.equal(platform.openUrl('https://reviverelay.voidsmithindustries.com/dist/review/ReviveRelay.user.js'),true);
  assert.equal(platform.openUrl('javascript:alert(1)'),false);
  assert.equal(opened.length,1);
  assert.equal(opened[0][1],'_blank');
});


test('failed dirty reconciliation keeps newer GM fallback state authoritative', async () => {
  const gm={token:'fallback-new',[Platform.FALLBACK_DIRTY_KEY]:true};
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {token:'native-stale'};},
      async setMany(){throw Object.assign(new Error('still unavailable'),{code:'QuotaExceeded'});},
      async set(){}
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token'],
    legacyDefaults:{token:''}
  });
  await storage.initialize();
  assert.equal(storage.mode(),'gm');
  assert.equal(storage.get('token',''),'fallback-new');
  assert.equal(gm.token,'fallback-new');
  assert.equal(gm[Platform.FALLBACK_DIRTY_KEY],true);
});

test('late native write failure cannot roll back a newer GM fallback write', async () => {
  let rejectFirst;
  let rejectSecond;
  let writes=0;
  const gm={};
  const storage=Platform.createStorage({
    runtime:{isTornPda:true},
    pdaStorage:{
      async loadAll(){return {token:'native-token',preset:'native-preset'};},
      set(){
        writes += 1;
        return new Promise((resolve,reject)=>{
          if(writes===1) rejectFirst=reject;
          else rejectSecond=reject;
        });
      }
    },
    gmGetValue:(key,fallback)=>Object.hasOwn(gm,key)?gm[key]:fallback,
    gmSetValue:(key,value)=>{gm[key]=value;},
    keys:['token','preset']
  });
  await storage.initialize();
  storage.set('token','token-a');
  storage.set('preset','preset-b');
  await new Promise(resolve=>setImmediate(resolve));
  rejectFirst(new Error('first failed'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(storage.mode(),'gm');
  storage.set('token','token-a-prime');
  assert.equal(gm.token,'token-a-prime');
  rejectSecond(new Error('second failed late'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(gm.token,'token-a-prime');
  assert.equal(gm.preset,'preset-b');
  assert.equal(gm[Platform.FALLBACK_DIRTY_KEY],true);
});
