const crypto = require("node:crypto");

function normalizeDynamic(value) {
  let text = String(value ?? "").toLowerCase();
  text = text.replace(/https?:\/\/[^\s)]+/gi, "<url>");
  text = text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "<uuid>");
  text = text.replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?\b/gi, "<timestamp>");
  text = text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "<quoted>");
  text = text.replace(/\b\d+\b/g, "<n>");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function normalizeLocation(location) {
  let file = String(location).trim().replace(/^\(|\)$/g, "");
  file = file.replace(/:\d+(?::\d+)?$/, "");

  if (/^https?:\/\//i.test(file)) {
    try {
      file = new URL(file).pathname || "/";
    } catch {
      file = "<url>";
    }
  } else {
    file = file.replace(/[?#].*$/, "");
  }

  return normalizeDynamic(file);
}

function stackSignature(stack) {
  if (!stack) return [];
  const signatures = [];
  const lines = String(stack).split(/\r?\n/);

  for (const raw of lines) {
    if (signatures.length >= 3) break;
    const line = raw.trim();
    let fn;
    let location;
    const firefox = /^(.*?)@(.*)$/.exec(line);
    const v8 = /^at\s+(.*)$/i.exec(line);

    if (firefox) {
      [, fn, location] = firefox;
    } else if (v8) {
      const withFunction = /^(.*?)\s+\((.*)\)$/.exec(v8[1]);
      if (withFunction) {
        [, fn, location] = withFunction;
      } else {
        fn = "<anonymous>";
        location = v8[1];
      }
    } else {
      continue;
    }

    signatures.push(`${normalizeDynamic(fn)}@${normalizeLocation(location)}`);
  }
  return signatures;
}

function fingerprintError(envelope = {}) {
  const stableType = String(envelope.errorCode || envelope.errorName || "error").trim().toLowerCase();
  const basis = {
    product: String(envelope.product || "reviverelay").trim().toLowerCase(),
    component: String(envelope.component || "unknown").trim().toLowerCase(),
    type: stableType,
    message: normalizeDynamic(envelope.message || ""),
    stack: stackSignature(envelope.stack)
  };

  return crypto.createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}

module.exports = {
  fingerprintError
};
