"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import type { PublicUser } from "@flutter-software/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 2 * 1024 * 1024;

const SIZE_CLASS = {
  sm: "size-8 text-xs",
  md: "size-9 text-xs",
  lg: "size-14 text-lg",
} as const;

const ICON_CLASS = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

function imageMime(file: File) {
  if (IMAGE_TYPES.has(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return null;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

export function avatarInitials(user: { username?: string | null; email?: string | null } | null) {
  const fromName = (user?.username ?? "").replace(/[^a-zA-Z]/g, "").slice(0, 2);
  if (fromName) return fromName.toUpperCase();
  const local = (user?.email ?? "").split("@")[0] ?? "";
  return (local.replace(/[^a-zA-Z]/g, "").slice(0, 2) || "??").toUpperCase();
}

export function UserAvatar({
  user,
  src,
  initials,
  size = "sm",
  editable = false,
  className,
  onChanged,
  onError,
}: {
  user?: { username?: string | null; email?: string | null; avatarUrl?: string | null } | null;
  src?: string | null;
  initials?: string;
  size?: keyof typeof SIZE_CLASS;
  editable?: boolean;
  className?: string;
  onChanged?: (user: PublicUser) => void;
  onError?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const photo = preview ?? src ?? user?.avatarUrl ?? null;
  const letters = initials ?? avatarInitials(user);

  async function onFile(file: File | undefined) {
    if (!file || !editable) return;
    if (file.size > MAX_BYTES) {
      onError?.("Image must be 2 MB or smaller");
      return;
    }
    const mime = imageMime(file);
    if (!mime) {
      onError?.("Could not use that image");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setPending(true);
    try {
      const result = await api<{ data: { user: PublicUser } }>("/api/v1/auth/profile/avatar", {
        method: "PATCH",
        body: JSON.stringify({ avatar: { mime, data: await fileToBase64(file) } }),
      });
      onChanged?.(result.data.user);
      setPreview(null);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not use that image");
      setPreview(null);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const face = (
    <>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center">{letters}</span>
      )}
    </>
  );

  const shellClass = cn(
    "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground",
    SIZE_CLASS[size],
    className,
  );

  if (!editable) {
    return <span className={shellClass}>{face}</span>;
  }

  return (
    <>
      <button
        type="button"
        className={cn("group no-press cursor-pointer", shellClass)}
        aria-label="Change profile photo"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        <span
          className={cn(
            "flex size-full items-center justify-center transition duration-200",
            pending
              ? "scale-105 blur-[2px]"
              : "group-hover:scale-105 group-hover:blur-[2px] group-focus-visible:scale-105 group-focus-visible:blur-[2px]",
          )}
        >
          {face}
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity",
            pending ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {pending ? (
            <Loader2 className={cn("animate-spin text-white", ICON_CLASS[size])} />
          ) : (
            <Camera className={cn("text-white", ICON_CLASS[size])} />
          )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
    </>
  );
}
