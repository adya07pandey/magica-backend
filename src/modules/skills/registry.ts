import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MAX_SKILL_FILE_BYTES = 128_000;
const SUPPORTED_ASSET_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
]);

const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  description: z.string().min(1).max(500),
});

export type SkillMetadata = z.infer<
  typeof SkillFrontmatterSchema
> & {
  contentHash: string;
};

type SkillRecord = SkillMetadata & {
  directory: string;
  body: string;
};

let cachedRegistry:
  | Map<string, SkillRecord>
  | undefined;

export async function listSkills() {
  const registry = await loadSkillRegistry();

  return [...registry.values()].map((skill) => ({
    name: skill.name,
    description: skill.description,
    contentHash: skill.contentHash,
  }));
}

export async function loadSkill(name: string) {
  const registry = await loadSkillRegistry();
  const skill = registry.get(name);

  if (!skill) {
    throw new Error(`Unknown skill: ${name}`);
  }

  return {
    name: skill.name,
    description: skill.description,
    content: skill.body,
    contentHash: skill.contentHash,
  };
}

export async function readSkillAsset(params: {
  skillName: string;
  assetPath: string;
}) {
  const registry = await loadSkillRegistry();
  const skill = registry.get(params.skillName);

  if (!skill) {
    throw new Error(
      `Unknown skill: ${params.skillName}`,
    );
  }

  const normalizedAssetPath =
    params.assetPath.replace(/\\/g, "/");

  if (
    normalizedAssetPath.includes("..") ||
    path.isAbsolute(normalizedAssetPath)
  ) {
    throw new Error(
      "Skill asset path traversal is not allowed",
    );
  }

  const absolutePath = path.resolve(
    skill.directory,
    normalizedAssetPath,
  );

  const relativePath = path.relative(
    skill.directory,
    absolutePath,
  );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Skill asset path traversal is not allowed",
    );
  }

  const extension = path.extname(
    absolutePath,
  );

  if (!SUPPORTED_ASSET_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported skill asset type: ${extension}`,
    );
  }

  const fileStat = await stat(absolutePath);

  if (fileStat.size > MAX_SKILL_FILE_BYTES) {
    throw new Error("Skill asset is too large");
  }

  const content = await readFile(
    absolutePath,
    "utf8",
  );

  return {
    skillName: skill.name,
    assetPath: normalizedAssetPath,
    content,
    contentHash: hashContent(content),
  };
}

async function loadSkillRegistry() {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const root = path.resolve(
    process.cwd(),
    "agent-skills",
  );

  const entries = await readdir(root, {
    withFileTypes: true,
  });

  const registry = new Map<string, SkillRecord>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(root, entry.name);
    const skillPath = path.join(
      directory,
      "SKILL.md",
    );

    const fileStat = await stat(skillPath);

    if (fileStat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `Skill ${entry.name} is too large`,
      );
    }

    const raw = await readFile(
      skillPath,
      "utf8",
    );

    const parsed = parseSkillFile(raw);

    if (registry.has(parsed.name)) {
      throw new Error(
        `Duplicate skill name: ${parsed.name}`,
      );
    }

    registry.set(parsed.name, {
      ...parsed,
      directory,
      contentHash: hashContent(raw),
    });
  }

  cachedRegistry = registry;

  return registry;
}

function parseSkillFile(raw: string) {
  if (!raw.startsWith("---\n")) {
    throw new Error(
      "Skill file is missing YAML frontmatter",
    );
  }

  const end = raw.indexOf("\n---", 4);

  if (end === -1) {
    throw new Error(
      "Skill file has malformed YAML frontmatter",
    );
  }

  const frontmatter = raw.slice(4, end);
  const body = raw.slice(end + 4).trim();
  const metadata: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    metadata[key] = value;
  }

  const parsed =
    SkillFrontmatterSchema.parse(metadata);

  return {
    ...parsed,
    body,
  };
}

function hashContent(content: string) {
  return createHash("sha256")
    .update(content)
    .digest("hex");
}
