const { z } = require('zod');

const optionalPositiveInteger = z.preprocess(
  value => value === '' || value === null || value === undefined ? undefined : value,
  z.coerce.number().int().positive().optional()
);

const optionalSecret = z.preprocess(
  value => value === '' || value === null || value === undefined ? undefined : value,
  z.string().min(1).max(128).optional()
);

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_KEY_ENCRYPTION_KEY: z.string()
    .regex(/^[0-9a-fA-F]{64}$/, 'API_KEY_ENCRYPTION_KEY must be 64 hexadecimal characters'),
  SESSION_TOKEN_PEPPER: z.string().min(1, 'SESSION_TOKEN_PEPPER is required'),
  TORN_API_BASE_URL: z.string().url().default('https://api.torn.com/v2'),
  OPERATOR_TORN_ID: z.coerce.number().int().positive().optional(),
  ADMIN_API_TOKEN: z.string().min(1).optional(),
  SHEETS_MIRROR_URL: z.string().default(''),
  SHEETS_MIRROR_TOKEN: z.string().default(''),
  REVIVERELAY_GOOGLE_SERVICE_ACCOUNT_FILE: z.string().default(''),
  REVIVERELAY_ERROR_SHEET_ID: z.string().default(''),
  REVIVERELAY_ERROR_SHEET_TAB: z.string().default('ReviveRelay Issues'),
  REVIVERELAY_REVIEW_MANIFEST_FILE: z.string().default(''),
  REVIVERELAY_STABLE_MANIFEST_FILE: z.string().default(''),
  SUBSCRIPTION_MODE: z.enum(['free', 'review', 'live']).default('free'),
  PRO_RECEIVER_TORN_ID: optionalPositiveInteger,
  PRO_RECEIVER_API_KEY: optionalSecret
}).superRefine((value, ctx) => {
  const hasReviewManifest = Boolean(value.REVIVERELAY_REVIEW_MANIFEST_FILE);
  const hasStableManifest = Boolean(value.REVIVERELAY_STABLE_MANIFEST_FILE);
  if (hasReviewManifest !== hasStableManifest) {
    ctx.addIssue({
      code:z.ZodIssueCode.custom,
      path:[hasReviewManifest ? 'REVIVERELAY_STABLE_MANIFEST_FILE' : 'REVIVERELAY_REVIEW_MANIFEST_FILE'],
      message:'REVIVERELAY_REVIEW_MANIFEST_FILE and REVIVERELAY_STABLE_MANIFEST_FILE must be configured together'
    });
  }
  if (value.SUBSCRIPTION_MODE === 'free') return;
  if (!value.PRO_RECEIVER_TORN_ID) {
    ctx.addIssue({
      code:z.ZodIssueCode.custom,
      path:['PRO_RECEIVER_TORN_ID'],
      message:`PRO_RECEIVER_TORN_ID is required when SUBSCRIPTION_MODE=${value.SUBSCRIPTION_MODE}`
    });
  }
  if (!value.PRO_RECEIVER_API_KEY) {
    ctx.addIssue({
      code:z.ZodIssueCode.custom,
      path:['PRO_RECEIVER_API_KEY'],
      message:`PRO_RECEIVER_API_KEY is required when SUBSCRIPTION_MODE=${value.SUBSCRIPTION_MODE}`
    });
  }
});

function loadConfig(env = process.env) {
  return configSchema.parse(env);
}

module.exports = {
  loadConfig
};
