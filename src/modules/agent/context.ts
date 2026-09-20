import { prisma } from "../../lib/prisma";
import { signedAssetUrl } from "../../lib/storage/r2";
import { listSkills } from "../skills/registry";
import type { AgentMessage } from "./model.types";

export async function buildConversationContext(
  taskId: string,
) {
  const [skills, summary, recentMessages] = await Promise.all([
    listSkills(),
    prisma.taskSummary.findUnique({
      where: { taskId },
    }),
    prisma.message.findMany({
      where: {
        taskId,
        role: {
          in: ["USER", "ASSISTANT"],
        },
      },

      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],

      take: 3,
      include: {
        attachments: {
          where: { status: "READY" },
          orderBy: { position: "asc" },
        },
      },
    }),
  ]);

  recentMessages.reverse();

  const context: AgentMessage[] = [
    {
      role: "system" as const,
      content:
        "You are a production agent running on OpenRouter Free. Act only on the latest user request; earlier requests and tool results are context, not unfinished instructions. Never repeat an earlier media operation unless the latest request explicitly asks for it. Use typed tools when needed. For requests to create, generate, draw, render, or make an image, call gpt_image_2 instead of replying with text. Use Low quality by default for fast image previews unless the user asks for higher quality. For requests to crop an attached or previously generated image, call crop_image using the exact attached-media URL; never invent or rewrite that URL. For requests to merge videos, call merge_videos using the exact video URLs from attached media, including every query-string parameter on signed URLs, and preserve the requested order. Available skills are discoverable metadata only; call load_skill before relying on a skill body.\n\n" +
        skills
          .map(
            (skill) =>
              `- ${skill.name}: ${skill.description}`,
          )
          .join("\n"),
    },
  ];

  // ----------------------------------------
  // SUMMARY
  // ----------------------------------------

  if (summary?.content) {
    context.push({
      role: "system" as const,

      content:
        `Conversation summary:\n\n${summary.content}`,
    });
  }

  // ----------------------------------------
  // RECENT 3 MESSAGES
  // ----------------------------------------

  for (const message of recentMessages) {
    const text = extractText(message.contentBlocks);

    const attachments = await Promise.all(
      message.attachments.map(async (attachment) => {
        let url = attachment.url;
        if (attachment.storageKey) {
          try {
            url = await signedAssetUrl(attachment.storageKey);
          } catch {
            // A public URL can still be useful when a signing configuration changes.
          }
        }
        return url
          ? `- ${attachment.mimeType} "${attachment.filename}": ${url}`
          : `- ${attachment.mimeType} "${attachment.filename}" (media is unavailable)`;
      }),
    );
    const attachmentText = attachments.length
      ? `\n\nAttached media:\n${attachments.join("\n")}\nUse these exact URLs with crop_image (image_url) or merge_videos (video_urls) when the request calls for it.`
      : "";
    const content = `${text}${attachmentText}`.trim();

    if (!content) {
      continue;
    }

    if (message.role === "USER") {
      context.push({
        role: "user" as const,
        content,
      });
    }

    if (message.role === "ASSISTANT") {
      context.push({
        role: "assistant" as const,
        content,
      });
    }
  }

  return context;
}

function extractText(
  contentBlocks: unknown,
): string {
  if (!Array.isArray(contentBlocks)) {
    return "";
  }

  return contentBlocks
    .filter(
      (
        block,
      ): block is {
        type: string;
        text: string;
      } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}
