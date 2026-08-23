class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestValidationError';
    this.code = 'INVALID_OFFER';
  }
}

function normalizeComment(comment) {
  if (comment === null || comment === undefined) return null;
  if (typeof comment !== 'string') {
    throw new RequestValidationError('Comment must be text');
  }
  const trimmed = comment.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new RequestValidationError('Comment must be 500 characters or fewer');
  }
  return trimmed;
}

function validateOffer({ paymentMethod, offerAmount, comment = null } = {}) {
  if (paymentMethod !== 'cash' && paymentMethod !== 'xanax') {
    throw new RequestValidationError('Payment method must be cash or xanax');
  }

  if (!Number.isSafeInteger(offerAmount)) {
    throw new RequestValidationError('Offer amount must be a whole integer');
  }

  if (paymentMethod === 'cash' && offerAmount < 500000) {
    throw new RequestValidationError('Cash offer must be at least 500000 Torn dollars');
  }

  if (paymentMethod === 'xanax' && offerAmount < 1) {
    throw new RequestValidationError('Xanax offer must be at least 1');
  }

  return {
    paymentMethod,
    offerAmount,
    comment: normalizeComment(comment)
  };
}

module.exports = {
  RequestValidationError,
  validateOffer
};
