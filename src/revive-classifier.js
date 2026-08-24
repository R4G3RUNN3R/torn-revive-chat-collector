(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TornReviveClassifier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CLASSIFIER_VERSION = '2.0.0';
  const CANDIDATE_THRESHOLD = 60;

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function addReason(reasons, reason) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  function classifyReviveMessage({ text, channelType } = {}) {
    const normalized = normalize(text);
    const channel = normalize(channelType).replace(/[\s-]+/g, '_');
    const reasons = [];
    let score = 0;
    let hardNegative = false;

    const hasReviveTerm = /\b(?:revive|revives|rev)\b/.test(normalized);
    if (hasReviveTerm) {
      score += 25;
      addReason(reasons, 'positive:revive-term');
    }

    if (/\bneed(?:ing)?\s+(?:a\s+)?(?:revive|rev)\b/.test(normalized)) {
      score += 40;
      addReason(reasons, 'positive:need-revive');
    }

    if (/\bcan\s+(?:someone|anyone)\s+(?:revive|rev)\s+me\b/.test(normalized)) {
      score += 45;
      addReason(reasons, 'positive:direct-request');
    } else if (/\b(?:revive|rev)\s+me\b/.test(normalized)) {
      score += 35;
      addReason(reasons, 'positive:revive-me');
    }

    if (/\b(?:revive|rev)\s+(?:please|pls|plz)\b|\b(?:please|pls|plz)\s+(?:revive|rev)\b/.test(normalized)) {
      score += 35;
      addReason(reasons, 'positive:polite-request');
    } else if (hasReviveTerm && /\b(?:please|pls|plz|someone|anyone)\b/.test(normalized)) {
      score += 15;
      addReason(reasons, 'positive:request-language');
    }

    const terseReviveQuestion = /^rev(?:ive)?\s*\?$/.test(normalized);
    if (terseReviveQuestion) {
      score += 20;
      addReason(reasons, 'positive:terse-question');
    }

    const hasPaymentHint = /(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:k|m|b)\b|\b(?:paying|payment|cash|xan|xanax)\b)/.test(normalized);
    if (hasReviveTerm && hasPaymentHint) {
      score += 15;
      addReason(reasons, 'positive:payment-hint');
    }

    if (hasReviveTerm && channel === 'hospital') {
      score += 15;
      addReason(reasons, 'positive:hospital-context');
    }

    const negativeRules = [
      [/\b(?:selling|offering)\s+(?:a\s+)?revives?\b/, 'negative:selling-revives'],
      [/\brevive\s+service\b/, 'negative:revive-service'],
      [/\brevive\s+skill\b/, 'negative:revive-skill'],
      [/\brevive\s+contract\b/, 'negative:revive-contract'],
      [/\b(?:recruit|recruiting|recruitment)\b/, 'negative:recruiting'],
      [/\b(?:i\s+can|i\s+will|able\s+to)\s+revive\s+(?:people|others|you)\b/, 'negative:offering-help'],
      [/\breviving\s+(?:people|others)\b/, 'negative:reviving-discussion']
    ];

    if (hasReviveTerm) {
      for (const [pattern, reason] of negativeRules) {
        if (!pattern.test(normalized)) continue;
        hardNegative = true;
        score -= 80;
        addReason(reasons, reason);
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    return Object.freeze({
      candidate: !hardNegative && score >= CANDIDATE_THRESHOLD,
      score,
      reasons: Object.freeze(reasons.slice()),
      version: CLASSIFIER_VERSION
    });
  }

  return Object.freeze({
    CLASSIFIER_VERSION,
    CANDIDATE_THRESHOLD,
    classifyReviveMessage
  });
});
