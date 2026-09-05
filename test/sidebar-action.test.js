const test = require('node:test');
const assert = require('node:assert/strict');
const { createSidebarController } = require('../src/sidebar-action');

class FakeElement {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();
    this.children=[];
    this.parentNode=null;
    this.attributes=new Map();
    this.dataset={};
    this.style={};
    this.className='';
    this.textContent='';
    this.disabled=false;
    this.listeners=new Map();
  }
  appendChild(child){ if(child.parentNode) child.remove(); child.parentNode=this; this.children.push(child); return child; }
  insertBefore(child,anchor){ if(child.parentNode) child.remove(); const index=this.children.indexOf(anchor); if(index<0)return this.appendChild(child); child.parentNode=this; this.children.splice(index,0,child); return child; }
  remove(){ if(!this.parentNode)return; const a=this.parentNode.children; const i=a.indexOf(this); if(i>=0)a.splice(i,1); this.parentNode=null; }
  setAttribute(name,value){ this.attributes.set(name,String(value)); if(name==='data-reviverelay-sidebar-action') this.dataset.reviverelaySidebarAction=String(value); }
  getAttribute(name){ return this.attributes.has(name)?this.attributes.get(name):null; }
  addEventListener(type,fn){ this.listeners.set(type,fn); }
  removeEventListener(type){ this.listeners.delete(type); }
  click(){ const fn=this.listeners.get('click'); if(fn) fn({preventDefault(){},stopPropagation(){}}); }
  querySelectorAll(selector){
    const out=[];
    const match=(node)=> selector==='[data-reviverelay-sidebar-action]' && node.getAttribute('data-reviverelay-sidebar-action')!==null;
    const walk=(node)=>{ for(const child of node.children){ if(match(child))out.push(child); walk(child); } };
    walk(this); return out;
  }
}

class FakeDocument {
  constructor(){ this.body=new FakeElement('body'); this.sidebar=new FakeElement('nav'); this.sidebar.setAttribute('id','sidebar'); this.body.appendChild(this.sidebar); }
  createElement(tag){ return new FakeElement(tag); }
  querySelector(selector){
    if (['#sidebar','nav[aria-label="Primary"]','nav[aria-label="Main"]','[role="navigation"][class*="sidebar"]','[class*="sidebar"] nav'].includes(selector)) return this.sidebar && this.sidebar.parentNode ? this.sidebar : null;
    return null;
  }
  querySelectorAll(selector){ return this.body.querySelectorAll(selector); }
  rebuildSidebar(){ if(this.sidebar) this.sidebar.remove(); this.sidebar=new FakeElement('nav'); this.sidebar.setAttribute('id','sidebar'); this.body.appendChild(this.sidebar); }
}

class FakeMutationObserver {
  constructor(callback){ this.callback=callback; this.targets=[]; this.disconnected=false; FakeMutationObserver.instances.push(this); }
  observe(target,options){ this.targets.push({target,options}); }
  disconnect(){ this.disconnected=true; }
  trigger(){ this.callback([],this); }
}
FakeMutationObserver.instances=[];

function makeWindow(){
  const timers=[];
  return {
    MutationObserver:FakeMutationObserver,
    setTimeout(fn){ timers.push(fn); return timers.length; },
    clearTimeout(){},
    flush(){ while(timers.length) timers.shift()(); }
  };
}

test('reconcile is idempotent and creates exact accessible label once', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  const window=makeWindow();
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate(){},getState:()=> 'READY'});
  controller.reconcile();
  controller.reconcile();
  const actions=document.querySelectorAll('[data-reviverelay-sidebar-action]');
  assert.equal(actions.length,1);
  assert.equal(actions[0].getAttribute('aria-label'),'ReviveRelay → Revive Me!');
  assert.equal(actions[0].getAttribute('data-state'),'READY');
  assert.equal(actions[0].textContent.includes('ReviveRelay → Revive Me!'),false); // child spans carry visible text
  assert.equal(actions[0].children[1].textContent,'ReviveRelay → Revive Me!');
});

test('sidebar rebuild causes exactly one action to reappear without reading chat roots', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  const window=makeWindow();
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate(){},getState:()=> 'READY'});
  controller.reconcile();
  document.rebuildSidebar();
  controller.reconcile();
  assert.equal(document.querySelectorAll('[data-reviverelay-sidebar-action]').length,1);
  assert.equal(document.sidebar.querySelectorAll('[data-reviverelay-sidebar-action]').length,1);
});

test('state updates preserve label and click activation receives current state', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  const window=makeWindow();
  let state='SETUP_REQUIRED';
  const activations=[];
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate:s=>activations.push(s),getState:()=>state});
  controller.reconcile();
  let action=document.querySelectorAll('[data-reviverelay-sidebar-action]')[0];
  assert.equal(action.getAttribute('data-state'),'SETUP_REQUIRED');
  action.click();
  state='READY'; controller.setState('READY');
  action=document.querySelectorAll('[data-reviverelay-sidebar-action]')[0];
  assert.equal(action.getAttribute('data-state'),'READY');
  assert.equal(action.children[1].textContent,'ReviveRelay → Revive Me!');
  action.click();
  state='SUBMITTING'; controller.setState('SUBMITTING'); action.click();
  assert.deepEqual(activations,['SETUP_REQUIRED','READY']);
});

test('observer is bounded to sidebar/navigation ancestor and destroy removes its own action', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  const window=makeWindow();
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate(){},getState:()=> 'READY'});
  controller.reconcile();
  assert.equal(FakeMutationObserver.instances.length,1);
  assert.equal(FakeMutationObserver.instances[0].targets[0].target,document.sidebar);
  assert.equal(FakeMutationObserver.instances[0].targets[0].options.subtree,true);
  controller.destroy();
  assert.equal(FakeMutationObserver.instances[0].disconnected,true);
  assert.equal(document.querySelectorAll('[data-reviverelay-sidebar-action]').length,0);
});


test('ReviveRelay action is placed near the top of the Torn sidebar rather than appended at the bottom', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  for (const name of ['home','items','city','job','crimes']) {
    const node=new FakeElement('a');
    node.textContent=name;
    document.sidebar.appendChild(node);
  }
  const window=makeWindow();
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate(){},getState:()=> 'READY'});
  controller.reconcile();
  const action=document.querySelectorAll('[data-reviverelay-sidebar-action]')[0];
  assert.equal(document.sidebar.children.indexOf(action),1);
  assert.equal(document.sidebar.children.at(-1)===action,false);
  controller.reconcile();
  assert.equal(document.sidebar.children.indexOf(action),1);
});


test('ReviveRelay sidebar action is a real red button with a white medical cross', () => {
  FakeMutationObserver.instances=[];
  const document=new FakeDocument();
  const window=makeWindow();
  const controller=createSidebarController({document,window,label:'ReviveRelay → Revive Me!',onActivate(){},getState:()=> 'READY'});
  controller.reconcile();
  const action=document.querySelectorAll('[data-reviverelay-sidebar-action]')[0];
  assert.equal(action.style.background,'#a4161a');
  assert.equal(action.style.color,'#fff');
  assert.equal(action.style.borderRadius,'5px');
  assert.equal(action.style.fontWeight,'700');
  assert.equal(action.children[0].textContent,'✚');
  assert.equal(action.children[0].style.color,'#fff');
});
