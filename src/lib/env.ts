import "dotenv/config";
import { z } from "zod";


const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  MAGICA_API_KEY: z.string().min(1),
  MAGICA_BASE_URL: z
    .string()
    .url()
    .default("https://inference.magica.com"),
  FRONTEND_URL: z
    .string()
    .url()
    .default("http://localhost:3001"),
  TRANSLOADIT_KEY: z.string().optional(),
  TRANSLOADIT_SECRET: z.string().optional(),
  TRANSLOADIT_TEMPLATE_ID: z.string().optional(),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
});


export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  REDIS_URL: process.env.REDIS_URL,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  MAGICA_API_KEY: process.env.MAGICA_API_KEY,
  MAGICA_BASE_URL: process.env.MAGICA_BASE_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  TRANSLOADIT_KEY: process.env.TRANSLOADIT_KEY,
  TRANSLOADIT_SECRET: process.env.TRANSLOADIT_SECRET,
  TRANSLOADIT_TEMPLATE_ID: process.env.TRANSLOADIT_TEMPLATE_ID,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
});
