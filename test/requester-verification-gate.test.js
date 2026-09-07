const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {validateTransactionCredential}=require('../server/src/torn/key-capabilities');

const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

const logMetadata={categories:{14:'Money outgoing',15:'Items incoming',16:'Items outgoing',17:'Money incoming'}};

function keyInfo({user=[],logAvailable=[],customPermissions=true}={}){
  return {
    tornId:123,
    name:'Requester',
    selections:{user,company:[],faction:[],market:[],property:[],torn:[],racing:[],forum:[],key:['info']},
    access:{level:4,type:'Custom',faction:false,company:false,log:{custom_permissions:customPermissions,available:logAvailable.map(category_id=>({category_id,log_ids:[]}))}}
  };
}

test('requester verification treats profile plus revives as recommended narrow access',()=>{
  const result=validateTransactionCredential({
    keyInfo:keyInfo({user:['profile','revives']}),
    ownerTornId:123,
    logMetadata
  });
  assert.equal(result.requester,true);
  assert.equal(result.broadAccess,false);
});

test('reviver verification treats perks plus revives and restricted transaction logs as recommended narrow access',()=>{
  const result=validateTransactionCredential({
    keyInfo:keyInfo({user:['basic','revives','perks','log'],logAvailable:[14,15,16,17]}),
    ownerTornId:123,
    logMetadata
  });
  assert.equal(result.reviver,true);
  assert.equal(result.broadAccess,false);
});

test('userscript describes requester verification as required before a request can be accepted',()=>{
  assert.match(source,/requester[^\n]{0,220}(?:verification|evidence)[^\n]{0,220}(?:before|until)[^\n]{0,220}accept/i);
});
