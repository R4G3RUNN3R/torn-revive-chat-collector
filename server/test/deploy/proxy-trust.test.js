const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nginxPath = path.resolve(__dirname, '../../../deploy/reviverelay.nginx.conf.example');

test('single-hop Nginx proxy replaces untrusted forwarded client IP headers', () => {
  const nginx = fs.readFileSync(nginxPath, 'utf8');

  assert.match(
    nginx,
    /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/,
    'Nginx must replace X-Forwarded-For with the socket client IP'
  );
  assert.doesNotMatch(
    nginx,
    /\$proxy_add_x_forwarded_for/,
    'client supplied X-Forwarded-For must not be preserved at this single-hop proxy boundary'
  );
  assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:3100\s*;/);
});
