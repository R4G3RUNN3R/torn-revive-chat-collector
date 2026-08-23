const { z } = require('zod');

const booleanFromString = z.preprocess(
  (value) => value === 'true',
  z.boolean()
);

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_KEY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'API_KEY_ENCRYPTION_KEY must be 64 hex characters'),
  SESSION_TOKEN_PEPPER: z.string().min(1, 'SESSION_TOKEN_PEPPER is required'),
  TORN_API_BASE_URL: z.string().url().default('https://api.torn.com/v2'),
  OPERATOR_TORN_ID: z.string().regex(/^\d+$/).optional().default(''),
  ADMIN_API_TOKEN: z.string().optional().default(''),
  SHEETS_MIRROR_URL: z.union([z.string().url(), z.literal('')]).optional().default(''),
  SHEETS_MIRROR_TOKEN: z.string().optional().default(''),
  PAID_TIER_ENABLED: booleanFromString.default(false)
});

function loadConfig(env = process.env) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid ReviveRelay configuration: ${details}`);
  }
  return parsed.data;
}

module.exports = {
  loadConfig
};
