const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLASSIFIER_VERSION,
  CANDIDATE_THRESHOLD,
  classifyReviveMessage
} = require('../src/revive-classifier');

const fixtures = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures', 'revive-messages.json'), 'utf8')
);

test('classifier contract is versioned and uses the documented threshold', () => {
  assert.equal(CLASSIFIER_VERSION, '2.0.0');
  assert.equal(CANDIDATE_THRESHOLD, 60);
});

for (const fixture of fixtures) {
  test(`${fixture.expected ? 'accepts' : 'rejects'} ${JSON.stringify(fixture.text)} in ${fixture.channelType}`, () => {
    const result = classifyReviveMessage({
      text: fixture.text,
      channelType: fixture.channelType
    });

    assert.equal(result.candidate, fixture.expected);
    assert.equal(result.version, CLASSIFIER_VERSION);
    assert.equal(Number.isInteger(result.score), true);
    assert.equal(result.score >= 0 && result.score <= 100, true);
    assert.equal(Array.isArray(result.reasons), true);
  });
}

test('classifier is deterministic for identical input', () => {
  const input = { text: '  Need   REVIVE please, paying 500k! ', channelType: 'global' };
  assert.deepEqual(classifyReviveMessage(input), classifyReviveMessage(input));
});

test('hospital context can qualify a terse revive request while global cannot', () => {
  const hospital = classifyReviveMessage({ text: 'rev?', channelType: 'hospital' });
  const global = classifyReviveMessage({ text: 'rev?', channelType: 'global' });

  assert.equal(hospital.candidate, true);
  assert.equal(global.candidate, false);
  assert.ok(hospital.score > global.score);
});

test('strong advertisement language overrides revive and payment terms', () => {
  const result = classifyReviveMessage({
    text: 'selling revives now, 1 xan each, message me',
    channelType: 'trade'
  });
  assert.equal(result.candidate, false);
  assert.ok(result.reasons.some((reason) => reason.startsWith('negative:')));
});
