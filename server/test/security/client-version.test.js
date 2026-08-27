const test=require('node:test'); const assert=require('node:assert/strict');
const {checkClientVersion,isProtectedMarketplaceMutation}=require('../../src/security/client-version');
test('client version gate rejects missing, malformed and old versions',()=>{
 const registry={latestVersion:'0.4.2',minimumVersion:'0.4.0',automatic:{installUrl:'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js'}};
 assert.equal(checkClientVersion({current:'0.3.9',releaseRegistry:registry}).allowed,false);
 assert.equal(checkClientVersion({current:'0.4.0',releaseRegistry:registry}).allowed,true);
 assert.equal(checkClientVersion({current:'',releaseRegistry:registry}).allowed,false);
 assert.equal(checkClientVersion({current:'broken',releaseRegistry:registry}).allowed,false);
});
test('only protected marketplace mutations are gated',()=>{
 for(const [method,url] of [['POST','/v1/requests'],['POST','/v1/requests/x/cancel'],['POST','/v1/requests/x/accept'],['POST','/v1/transactions/x/check-payment'],['POST','/v1/transactions/x/retry-request'],['POST','/v1/transactions/x/retry-response'],['POST','/v1/transactions/x/request-refund'],['POST','/v1/transactions/x/check-refund']]) assert.equal(isProtectedMarketplaceMutation(method,url),true,`${method} ${url}`);
 for(const [method,url] of [['GET','/health'],['GET','/v1/client/version'],['POST','/v1/auth/bind'],['GET','/v1/me'],['POST','/v1/telemetry/errors'],['GET','/v1/reviver/queue'],['GET','/v1/transactions/x'],['POST','/v1/verification-credential']]) assert.equal(isProtectedMarketplaceMutation(method,url),false,`${method} ${url}`);
});
