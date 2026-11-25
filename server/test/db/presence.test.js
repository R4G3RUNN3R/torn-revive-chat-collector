const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createPresenceRepository } = require('../../src/db/presence');

const NOW = new Date('2026-11-25T12:00:00Z');
const minutesAgo = minutes => new Date(NOW.getTime() - minutes * 60000);

async function seedUser(pool, tornId, {
  reviverStanding = 'active', lastSeen = minutesAgo(1), requester = true, reviver = true,
  paidUntil = null, banned = false, credential = true
} = {}) {
  const user = (await pool.query('INSERT INTO users (torn_id,current_name) VALUES ($1,$2) RETURNING id', [tornId, `P${tornId}`])).rows[0].id;
  if (reviverStanding) await pool.query('INSERT INTO revivers (user_id,standing) VALUES ($1,$2)', [user, reviverStanding]);
  if (lastSeen) await pool.query('INSERT INTO sessions (user_id,token_hash,last_seen_at) VALUES ($1,$2,$3)', [user, `hash-${tornId}`, lastSeen]);
  if (credential) {
    await pool.query(`
      INSERT INTO api_credentials (user_id,ciphertext,iv,auth_tag,access_scope,purpose,capability,last_validated_at)
      VALUES ($1,'c','i','t','{}'::jsonb,'transaction_verification',$2::jsonb,now())
    `, [user, JSON.stringify({ requester, reviver })]);
  }
  if (paidUntil) {
    await pool.query('INSERT INTO pro_entitlements (user_id,paid_started_at,paid_until,ever_paid) VALUES ($1,$2,$3,true)', [user, minutesAgo(60 * 24), paidUntil]);
  }
  if (banned) await pool.query("INSERT INTO bans (reviver_id,reason) VALUES ($1,'test')", [user]);
  return user;
}

test('countOnlineRevivers counts only recent, eligible, entitled revivers', async () => {
  await withDisposableDatabase('presence_online', async pool => {
    const future = new Date('2026-12-25T00:00:00Z');
    await seedUser(pool, 840001, { paidUntil: future });                       // counts
    await seedUser(pool, 840002, { paidUntil: future, lastSeen: minutesAgo(10) }); // stale
    await seedUser(pool, 840003, {});                                            // no entitlement
    await seedUser(pool, 840004, { paidUntil: future, banned: true });           // banned
    await seedUser(pool, 840005, { paidUntil: future, reviverStanding: 'suspended' });
    await seedUser(pool, 840006, { paidUntil: future, reviver: false });         // no reviver capability
    await seedUser(pool, 3877028, {});                                           // owner, no entitlement row
    const repo = createPresenceRepository(pool);

    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: true, ownerTornId: 3877028 }), 2);
    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: false, ownerTornId: 3877028 }), 3);
    assert.equal(await repo.countOnlineRevivers({ now: NOW, requireEntitlement: true, ownerTornId: null }), 1);
  });
});

test('getPlayerBadge reports verification without revealing anything else', async () => {
  await withDisposableDatabase('presence_badge', async pool => {
    await seedUser(pool, 850001, { reviverStanding: null, reviver: false });
    await seedUser(pool, 850002, {});
    await seedUser(pool, 850003, { banned: true });
    await seedUser(pool, 850004, { reviverStanding: null, credential: false });
    const repo = createPresenceRepository(pool);

    assert.deepEqual(await repo.getPlayerBadge(850001), { tornId: 850001, requesterVerified: true, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(850002), { tornId: 850002, requesterVerified: true, reviverVerified: true });
    assert.deepEqual(await repo.getPlayerBadge(850003), { tornId: 850003, requesterVerified: true, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(850004), { tornId: 850004, requesterVerified: false, reviverVerified: false });
    assert.deepEqual(await repo.getPlayerBadge(899999), { tornId: 899999, requesterVerified: false, reviverVerified: false });
  });
});
