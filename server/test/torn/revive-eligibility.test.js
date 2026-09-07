const test = require('node:test');
const assert = require('node:assert/strict');
const { TornApiError } = require('../../src/torn/client');
const {
  hasReviveAbility,
  createReviveEligibilityService
} = require('../../src/torn/revive-eligibility');

test('detects Torn permanent revive ability from current v2 job perks', () => {
  assert.equal(hasReviveAbility({ job: ['- 10% Education length', '+ Ability to revive'] }), true);
  assert.equal(hasReviveAbility({ job: ['+ 10% Crime success'] }), false);
});

test('eligibility service returns only safe eligibility state and never raw perks', async () => {
  const service = createReviveEligibilityService({
    tornClient: {
      async getUserPerks(key) {
        assert.equal(key, 'secret-key');
        return { job: ['+ Ability to revive'], faction: ['secret-ish irrelevant perk'] };
      }
    },
    verificationCredentialRepository: {
      async getDecryptedActiveForUser(userId) {
        assert.equal(userId, 'u1');
        return { plaintextKey: 'secret-key', status: { usable: true } };
      }
    }
  });

  const result = await service.check('u1');
  assert.deepEqual(result, { status: 'ELIGIBLE', canRevive: true });
  assert.equal(JSON.stringify(result).includes('secret-key'), false);
  assert.equal(JSON.stringify(result).includes('secret-ish'), false);
});

test('eligibility service distinguishes not-unlocked from missing perks permission', async () => {
  const repository = {
    async getDecryptedActiveForUser() { return { plaintextKey: 'key', status: { usable: true } }; }
  };
  const notUnlocked = createReviveEligibilityService({
    tornClient: { async getUserPerks() { return { job: ['+ 10% Crime success'] }; } },
    verificationCredentialRepository: repository
  });
  assert.deepEqual(await notUnlocked.check('u1'), { status: 'NOT_UNLOCKED', canRevive: false });

  const missingPermission = createReviveEligibilityService({
    tornClient: {
      async getUserPerks() {
        throw new TornApiError('TORN_UNAVAILABLE', 'not enough access', { status: 200, tornStatus: 16 });
      }
    },
    verificationCredentialRepository: repository
  });
  await assert.rejects(
    () => missingPermission.check('u1'),
    error => error && error.code === 'REVIVE_ABILITY_PERMISSION_REQUIRED'
  );
});

test('eligibility service marks an invalid stored key unusable before rejecting it', async () => {
  let marked = null;
  const service = createReviveEligibilityService({
    tornClient: {
      async getUserPerks() { throw new TornApiError('TORN_INVALID_KEY', 'invalid'); }
    },
    verificationCredentialRepository: {
      async getDecryptedActiveForUser() { return { plaintextKey: 'old-key', status: { usable: true } }; },
      async markUnusable(input) { marked = input; }
    }
  });

  await assert.rejects(
    () => service.check('u9'),
    error => error && error.code === 'VERIFICATION_CREDENTIAL_INVALID'
  );
  assert.equal(marked.userId, 'u9');
  assert.equal(marked.reason, 'TORN_INVALID_KEY');
});
