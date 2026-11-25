const ABROAD_HOSPITAL = /^in an? [a-z][a-z .'-]* hospital\b/i;
const HOME_HOSPITAL = /^in hospital\b/i;
const UNKNOWN = Object.freeze({ hospitalUntil: null, abroad: null });

function deriveRequesterStatus(profile) {
  const status = profile && profile.status;
  if (!status || typeof status !== 'object') return { ...UNKNOWN };
  if (String(status.state || '').trim().toLowerCase() !== 'hospital') return { ...UNKNOWN };

  const untilSeconds = Number(status.until);
  const hospitalUntil = Number.isFinite(untilSeconds) && untilSeconds > 0
    ? new Date(Math.floor(untilSeconds) * 1000)
    : null;
  const description = String(status.description || '').trim();
  let abroad = null;
  if (HOME_HOSPITAL.test(description)) abroad = false;
  else if (ABROAD_HOSPITAL.test(description)) abroad = true;
  return { hospitalUntil, abroad };
}

module.exports = {
  deriveRequesterStatus
};
