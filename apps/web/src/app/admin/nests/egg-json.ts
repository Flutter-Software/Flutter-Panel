function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function unwrapEggJson(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const nested = [
    raw,
    raw.egg,
    raw.attributes,
    isRecord(raw.data) ? raw.data : null,
    isRecord(raw.data) ? raw.data.attributes : null,
    isRecord(raw.data) ? raw.data.egg : null,
  ];
  for (const candidate of nested) {
    if (!isRecord(candidate)) continue;
    if (
      "name" in candidate ||
      "docker_images" in candidate ||
      "docker_image" in candidate ||
      "image" in candidate ||
      "startup" in candidate
    ) {
      return candidate;
    }
  }
  return raw;
}

function pickImage(egg: Record<string, unknown>): string {
  if (typeof egg.docker_image === "string") return egg.docker_image;
  if (typeof egg.image === "string") return egg.image;
  if (Array.isArray(egg.docker_images)) {
    const first = egg.docker_images.find((value) => typeof value === "string" && value);
    return typeof first === "string" ? first : "";
  }
  if (isRecord(egg.docker_images)) {
    const first = Object.values(egg.docker_images).find((value) => typeof value === "string" && value);
    return typeof first === "string" ? first : "";
  }
  return "";
}

export function previewFromJson(raw: unknown): { name: string; image: string; variables: number } | null {
  const egg = unwrapEggJson(raw);
  if (!egg) return null;
  const name = typeof egg.name === "string" ? egg.name : "";
  const image = pickImage(egg);
  const variables = Array.isArray(egg.variables) ? egg.variables.length : 0;
  if (!name && !image) return null;
  return { name: name || "Imported egg", image, variables };
}

export function parseEggJson(jsonText: string) {
  const trimmed = jsonText.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return {
      egg: null as unknown,
      preview: null as ReturnType<typeof previewFromJson>,
      parseError: null as string | null,
    };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (Array.isArray(value)) {
      return { egg: null, preview: null, parseError: "Paste a single egg JSON object, not an array." };
    }
    if (!value || typeof value !== "object") {
      return { egg: null, preview: null, parseError: "Egg JSON must be an object." };
    }
    const preview = previewFromJson(value);
    if (!preview) {
      return {
        egg: value,
        preview: null,
        parseError: "Could not find an egg name or Docker image in that JSON.",
      };
    }
    return { egg: value, preview, parseError: null };
  } catch {
    return { egg: null, preview: null, parseError: "JSON is not valid yet." };
  }
}
