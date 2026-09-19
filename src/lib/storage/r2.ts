import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

import { env } from "../env";

export function isR2Configured() {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME,
  );
}

function getClient() {
  if (!isR2Configured()) {
    throw new Error("Cloudflare R2 is not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "asset";
}

export function attachmentStorageKey(input: {
  userId: string;
  taskId: string;
  attachmentId: string;
  filename: string;
}) {
  return `users/${input.userId}/tasks/${input.taskId}/attachments/${input.attachmentId}/${cleanSegment(input.filename)}`;
}

export function publicAssetUrl(storageKey: string) {
  return env.R2_PUBLIC_URL
    ? `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${storageKey}`
    : null;
}

export async function copyRemoteAssetToR2(input: {
  sourceUrl: string;
  storageKey: string;
  mimeType: string;
}) {
  const source = await fetch(input.sourceUrl);
  if (!source.ok || !source.body) {
    throw new Error(`Unable to read uploaded media (${source.status})`);
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: input.storageKey,
      Body: Readable.fromWeb(source.body as never),
      ContentType: input.mimeType,
    }),
  );

  return { storageKey: input.storageKey, url: publicAssetUrl(input.storageKey) };
}

export async function uploadAssetToR2(input: {
  body: ReadableStream<Uint8Array>;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: input.storageKey,
      Body: Readable.fromWeb(input.body as never),
      ContentLength: input.sizeBytes,
      ContentType: input.mimeType,
    }),
  );

  return {
    storageKey: input.storageKey,
    url: publicAssetUrl(input.storageKey),
  };
}

export async function signedAssetUrl(storageKey: string, expiresIn = 60 * 60) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: storageKey }),
    { expiresIn },
  );
}
