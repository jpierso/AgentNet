export function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://agentnet_test:agentnet_test@localhost:5433/agentnet_test';
  process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
  process.env.JWT_ISSUER = 'agentnet-test';
  process.env.JWT_AUDIENCE = 'agentnet-api-test';
  process.env.JWT_TTL_MINUTES = '15';
  process.env.LOG_LEVEL = 'error';
  process.env.WEBHOOK_SECRET = 'test-webhook-secret-min-16-chars';
  process.env.PORT = '0';
  process.env.HOST = '0.0.0.0';
}

setup();
