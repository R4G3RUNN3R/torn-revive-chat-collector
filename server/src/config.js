const { z } = require('zod');

const booleanFromString = z.preprocess(
  value => value === 'true',
  z.boolean()
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
  REVIVERELAY_RELEASE_MANIFEST_FILE: z.string().default(''),
  PAID_TIER_ENABLED: booleanFromString.default(false)
});

function loadConfig(env = process.env) {
  return configSchema.parse(env);
}

module.exports = {
  loadConfig
};
