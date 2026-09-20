
# 🚀 Magica Backend

# Magica Backend


Magica is an agentic media workflow backend. It exposes the public API used by the frontend, stores tasks/messages/attachments in Postgres, authenticates users with Clerk, dispatches durable work through Trigger.dev, routes LLM calls through OpenRouter, and executes media tools through Magica.

## Submission Links

- Frontend repository: `https://github.com/adya07pandey/magica-frontend`
- Backend repository: `https://github.com/adya07pandey/magica-backend`
- Deployed app: `https://magica-frontend-phi.vercel.app/`
- API documentation: `<mintlify-docs-url>`

## Tech Stack

- Next.js 16 route handlers for the API surface
- TypeScript
- PostgreSQL with Prisma 7
- Clerk backend auth
- Trigger.dev 4 for durable background runs
- OpenRouter for free model routing and tool calling
- Magica APIs for media generation and editing
- Cloudflare R2 for uploaded/generated asset storage
- Redis/Upstash for rate limiting and runtime coordination
- Zod for validation

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Generate Prisma:

```bash
pnpm prisma generate
```

Run database migrations or push the Prisma schema according to your local database workflow:

```bash
pnpm prisma db push
```

Start API and Trigger.dev worker together:

```bash
pnpm dev
```

The API runs on the Next.js port printed in the terminal. The frontend should point `BACKEND_URL` to this backend origin.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma. |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key for verifying authenticated requests. |
| `OPENROUTER_API_KEY` | Yes | API key for model routing and chat/tool calls. |
| `MAGICA_API_KEY` | Yes | API key for Magica media tool execution. |
| `MAGICA_BASE_URL` | No | Defaults to `https://inference.magica.com`. |
| `FRONTEND_URL` | Yes | Public frontend origin used for CORS and OpenRouter referer headers. |
| `REDIS_URL` | Yes | Redis connection string. Upstash `rediss://` is supported. |
| `UPSTASH_REDIS_REST_URL` | Recommended | REST endpoint for request rate limiting. |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | REST token for request rate limiting. |
| `R2_ACCOUNT_ID` | Yes for uploads | Cloudflare account ID. |
| `R2_ACCESS_KEY_ID` | Yes for uploads | R2 access key ID. |
| `R2_SECRET_ACCESS_KEY` | Yes for uploads | R2 secret access key. |
| `R2_BUCKET_NAME` | Yes for uploads | R2 bucket for attachments and generated assets. |
| `R2_PUBLIC_URL` | Optional | Public/custom asset base URL. |
| `TRANSLOADIT_KEY` | Optional | Retained for Transloadit compatibility endpoints. |
| `TRANSLOADIT_SECRET` | Optional | Retained for Transloadit compatibility endpoints. |
| `TRANSLOADIT_TEMPLATE_ID` | Optional | Retained for Transloadit compatibility endpoints. |
| `WEBHOOK_URL` | Optional | Optional webhook target for run/tool notifications. |
| `WEBHOOK_SECRET` | Optional | Optional webhook signing secret. |

## Available Scripts

```bash
pnpm dev          # Run Next.js API and Trigger.dev worker
pnpm dev:api      # Run only the Next.js API
pnpm dev:trigger  # Run only Trigger.dev
pnpm build        # Generate Prisma and build Next.js
pnpm start        # Run production server
pnpm lint         # ESLint
```

## Architecture Overview

The backend separates the synchronous public API from durable agent execution.

- `app/api/*` contains route handlers for tasks, messages, attachments, uploads, runs, waitpoints, health, and compatibility endpoints.
- `src/modules/auth/*` maps Clerk identities to local users and protects API routes.
- `src/modules/tasks/*` owns task/message persistence and task summaries.
- `src/modules/agent/*` builds model context, calls OpenRouter, handles tool calls, and records run progress.
- `src/modules/tools/*` registers available tools and contains adapters for `gpt_image_2`, `crop_image`, `merge_videos`, and skills.
- `src/modules/tools/magica/*` is the Magica provider client and status parsing layer.
- `trigger/agent-run.ts` executes agent runs durably.
- `trigger/tool-run.ts` executes provider tool calls as child runs.
- `src/lib/storage/r2.ts` stores uploaded and generated media in Cloudflare R2.
- `src/lib/cors.ts` centralizes CORS headers from `FRONTEND_URL`.

## Agent and Tool Flow

1. The frontend sends a prompt to `POST /api/tasks` or `POST /api/tasks/{taskId}` with attachment IDs.
2. The backend creates the message, creates an `AgentRun`, stores an idempotency key, and dispatches Trigger.dev.
3. The agent builds task context and asks OpenRouter for the next model action.
4. If the model calls a tool, the backend validates the tool input with Zod and dispatches a child Trigger.dev tool run.
5. Tool adapters call Magica, poll provider status, normalize outputs, and store tool results.
6. The agent stores assistant/tool messages and marks the run complete or failed.
7. The frontend listens to `GET /api/v1/runs/{runId}/events` for realtime progress.

## Implemented Tools

- `gpt_image_2`: text-to-image generation. Returns `image_urls`.
- `crop_image`: crops an uploaded/generated image by percent or pixel coordinates. Returns `image_url`.
- `merge_videos`: merges two or more videos with optional transition. Returns `video_url`.
- `skills`: registry-driven helper tools available to the agent.

## API Documentation

The Mintlify-ready documentation lives in `../mintlify-docs`. It includes:

- `docs.json` for Mintlify navigation
- `openapi.json` for public API reference
- MDX guides for authentication, quickstart, architecture, tools, webhooks, and errors

Deploy that folder as a separate Mintlify project and set the final docs URL in both READMEs before submission.

## Design Decisions and Trade-Offs

- Durable work runs in Trigger.dev so long-running Magica jobs survive frontend refreshes and request timeouts.
- The public API is idempotent for task creation/message send operations to avoid duplicate runs during retries.
- Tool schemas are Zod-first, which keeps runtime validation and model-facing tool contracts close together.
- Direct R2 upload is the primary upload path for reliability in the demo. Transloadit endpoints are retained for compatibility and future resumable-upload work.
- Server-Sent Events are used for realtime run updates because the client only needs backend-to-browser progress events.
- `FRONTEND_URL` and frontend `BACKEND_URL` are environment-driven so local, Vercel preview, and production deployments do not require code changes.

## Deployment

Deploy this repository to Vercel as the backend/API app. Configure all required environment variables, then run:

```bash
pnpm build
```

Deployment checks:

- `GET /api/health` returns 200.
- Authenticated `GET /api/me` returns the reviewer user.
- Direct uploads create READY attachments in R2.
- Trigger.dev can execute `agent-run` and `tool-run`.
- `gpt_image_2`, `crop_image`, and `merge_videos` complete and return usable asset URLs.
- Frontend origin is allowed through `FRONTEND_URL`.

## What I Would Improve With More Time

- Add generated API clients from the OpenAPI spec.
- Add provider-level retry/backoff policies per tool type.
- Add a background asset ingestion queue for very large uploads.
- Add stronger observability dashboards for run latency, provider failure rates, and credit usage.
- Add integration tests that exercise Trigger.dev locally with mocked Magica/OpenRouter responses.
