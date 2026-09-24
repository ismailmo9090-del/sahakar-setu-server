import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_KEY: z.string(),

  REDIS_URL: z.string(),

  GROQ_API_KEY: z.string(),
  GROQ_MODEL_PRIMARY: z.string().default('openai/gpt-oss-120b'),
  GROQ_MODEL_FALLBACK: z.string().default('openai/gpt-oss-20b'),

  VOSK_MODEL_PATH: z.string().default('./models/vosk-model-hi-0.22'),
  VOSK_SAMPLE_RATE: z.coerce.number().default(16000),

  TTS_VOICE_HINDI: z.string().default('hi-IN-MadhurNeural'),
  TTS_VOICE_ENGLISH: z.string().default('en-IN-NeerjaNeural'),
  TTS_PYTHON_SERVICE_URL: z.string().url().default('http://localhost:5001'),

  VAPI_API_KEY: z.string().optional(),
  VAPI_WEBHOOK_SECRET: z.string().optional(),
  VAPI_PUBLIC_BASE_URL: z.string().optional(),
  VAPI_LLM_SECRET: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),

  HMAC_SECRET: z.string().min(32),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),

  TRACKING_ID_PREFIX: z.string().default('SS'),
  TRACKING_ID_YEAR: z.coerce.number().default(2026),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}
