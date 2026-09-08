const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const composePath=path.join(root,'deploy','docker-compose.review.yml');

test('review compose isolates API and billing scanner from stable runtime',()=>{
  assert.equal(fs.existsSync(composePath),true,'review compose must exist');
  const compose=fs.readFileSync(composePath,'utf8');
  assert.match(compose,/reviverelay-review-api:/);
  assert.match(compose,/reviverelay-review-subscription-worker:/);
  assert.match(compose,/127\.0\.0\.1:18731:3100/);
  assert.match(compose,/review-subscription-worker\.js/);
  assert.doesNotMatch(compose,/127\.0\.0\.1:18730:3100/);
  assert.doesNotMatch(compose,/^\s{2}reviverelay-api:\s*$/m);
  assert.doesNotMatch(compose,/^\s{2}reviverelay-worker:\s*$/m);
  assert.doesNotMatch(compose,/^\s{2}reviverelay-db:\s*$/m);
  assert.match(compose,/SUBSCRIPTION_MODE:\s*review/);
  assert.match(compose,/REVIVERELAY_SERVER_VERSION:\s*0\.6\.1/);
  assert.match(compose,/REVIVERELAY_MINIMUM_CLIENT_VERSION:\s*0\.6\.1/);
  assert.match(compose,/REVIVERELAY_RELEASE_CHANNEL:\s*review/);
  assert.match(compose,/reviverelay_db_internal:/);
  assert.match(compose,/reviverelay_egress:/);
  assert.match(compose,/external:\s*true/);
  assert.doesNotMatch(compose,/PRO_RECEIVER_API_KEY:\s*[^\s#]+/);
});
