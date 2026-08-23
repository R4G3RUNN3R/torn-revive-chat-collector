function validateOffer(input) {
  const paymentMethod = input && input.paymentMethod;
  const offerAmount = input && input.offerAmount;

  if (paymentMethod !== 'cash' && paymentMethod !== 'xanax') {
    throw new Error('Unsupported payment method');
  }

  if (!Number.isFinite(offerAmount) || !Number.isInteger(offerAmount)) {
    throw new Error('Offer amount must be a whole number');
  }

  if (paymentMethod === 'cash' && offerAmount < 500000) {
    throw new Error('Cash offer must be at least 500000');
  }

  if (paymentMethod === 'xanax' && offerAmount < 1) {
    throw new Error('Xanax offer must be at least 1');
  }

  let comment = null;
  if (input.comment != null) {
    if (typeof input.comment !== 'string') {
      throw new Error('Comment must be text');
    }
    const trimmed = input.comment.trim();
    if (trimmed.length > 500) {
      throw new Error('Comment must not exceed 500 characters');
    }
    comment = trimmed || null;
  }

  return {
    paymentMethod,
    offerAmount,
    comment
  };
}

module.exports = {
  validateOffer
};
