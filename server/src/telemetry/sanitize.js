const SAFE_CONTEXT_KEYS = new Set([
  "operation", "route", "jobType", "httpStatus", "tornStatus", "state",
  "method", "retryable", "releaseChannel"
]);

const MESSAGE_LIMIT = 1000;
const STACK_LIMIT = 8000;
const CONTEXT_STRING_LIMIT = 250;
const CONTEXT_KEY_LIMIT = 12;
const REDACTED = "[REDACTED]";

function redactString(value) {
  let text = String(value ?? "");

  text = text.replace(/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, REDACTED);
  text = text.replace(/\b(https?:\/\/)[^\s\/@:]+:[^\s\/@]+@([^\s\/'"<>]+)/gi, "$1[REDACTED]@$2");
  text = text.replace(
    /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password|session|authorization|cookie)=)[^&#\s"']*/gi,
    "$1[REDACTED]"
  );
  text = text.replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, "Authorization: [REDACTED]");
  text = text.replace(/\bCookie\s*:\s*[^\r\n]+/gi, "Cookie: [REDACTED]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/=\-]{6,}/gi, `Bearer ${REDACTED}`);
  text = text.replace(
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|cookie|session)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    (_match, name) => name.toLowerCase() === "cookie" ? REDACTED : `${name}=${REDACTED}`
  );
  text = text.replace(/\b(?:sk|pk|tok)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, REDACTED);
  text = text.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, REDACTED);
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, REDACTED);
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi, REDACTED);
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, REDACTED);

  return text;
}

function sanitizeBoundedString(value, limit) {
  return redactString(redactString(value).slice(0, limit)).slice(0, limit);
}

function sanitizeMessage(value) {
  return sanitizeBoundedString(value, MESSAGE_LIMIT);
}

function sanitizeStack(value) {
  return sanitizeBoundedString(value, STACK_LIMIT);
}

function sanitizeContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const context = {};
  for (const key of SAFE_CONTEXT_KEYS) {
    if (Object.keys(context).length >= CONTEXT_KEY_LIMIT) break;
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;

    const value = input[key];
    if (typeof value === "string") {
      context[key] = sanitizeBoundedString(value, CONTEXT_STRING_LIMIT);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      context[key] = value;
    } else if (typeof value === "boolean") {
      context[key] = value;
    }
  }
  return context;
}

function cleanScalarString(value, limit = CONTEXT_STRING_LIMIT) {
  if (typeof value !== "string") return undefined;
  return sanitizeBoundedString(value, limit);
}

function deepRedact(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepRedact(item)])
    );
  }
  return value;
}

function sanitizeTelemetryEnvelope(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  const output = {};

  for (const key of ["product", "component", "source", "version", "buildCommit", "severity", "errorName", "errorCode"]) {
    const value = cleanScalarString(input[key]);
    if (value !== undefined) output[key] = value;
  }

  if (input.message !== undefined) output.message = sanitizeMessage(input.message);
  if (input.stack !== undefined) output.stack = sanitizeStack(input.stack);
  output.context = sanitizeContext(input.context);

  if (input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime())) {
    output.occurredAt = input.occurredAt.toISOString();
  } else if (typeof input.occurredAt === "string") {
    const parsed = new Date(input.occurredAt);
    if (Number.isFinite(parsed.getTime())) output.occurredAt = parsed.toISOString();
  }

  const serialized = JSON.stringify(output);
  return deepRedact(JSON.parse(serialized));
}

module.exports = {
  SAFE_CONTEXT_KEYS,
  sanitizeTelemetryEnvelope,
  sanitizeMessage,
  sanitizeStack
};
