import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string(),
    JWT_SECRET: z.string().min(16),
    JWT_ISSUER: z.string().default('agentnet'),
    JWT_AUDIENCE: z.string().default('agentnet-api'),
    JWT_TTL_MINUTES: z.coerce.number().min(1).max(60).default(15),
    WEBHOOK_SECRET: z.string().min(16),
    AUDIT_BACKEND: z.enum(['postgres', 'blockchain']).default('postgres'),
    // Blockchain config (required when AUDIT_BACKEND=blockchain)
    BLOCKCHAIN_PEER_ENDPOINT: z.string().optional(),
    BLOCKCHAIN_PEER_HOST_ALIAS: z.string().optional(),
    BLOCKCHAIN_TLS_CERT_PATH: z.string().optional(),
    BLOCKCHAIN_CERT_PATH: z.string().optional(),
    BLOCKCHAIN_KEY_PATH: z.string().optional(),
    BLOCKCHAIN_MSP_ID: z.string().optional(),
    BLOCKCHAIN_CHANNEL: z.string().optional(),
    BLOCKCHAIN_CHAINCODE: z.string().optional(),
  })
  .refine(
    (data) =>
      data.AUDIT_BACKEND !== 'blockchain' ||
      (data.BLOCKCHAIN_PEER_ENDPOINT &&
        data.BLOCKCHAIN_PEER_HOST_ALIAS &&
        data.BLOCKCHAIN_TLS_CERT_PATH &&
        data.BLOCKCHAIN_CERT_PATH &&
        data.BLOCKCHAIN_KEY_PATH &&
        data.BLOCKCHAIN_MSP_ID &&
        data.BLOCKCHAIN_CHANNEL &&
        data.BLOCKCHAIN_CHAINCODE),
    {
      message:
        'When AUDIT_BACKEND=blockchain, BLOCKCHAIN_PEER_ENDPOINT, BLOCKCHAIN_PEER_HOST_ALIAS, BLOCKCHAIN_TLS_CERT_PATH, BLOCKCHAIN_CERT_PATH, BLOCKCHAIN_KEY_PATH, BLOCKCHAIN_MSP_ID, BLOCKCHAIN_CHANNEL, and BLOCKCHAIN_CHAINCODE are required',
    },
  );

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env: Env = parsed.data;
