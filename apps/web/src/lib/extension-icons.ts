/**
 * Maps the icon names an extension manifest may use (`EXTENSION_ICONS` in
 * @flutter-software/shared) to lucide components. Unknown names fall back to
 * the puzzle piece so a typo never breaks the sidebar.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookOpen,
  Box,
  ChartColumn,
  Clock,
  Database,
  Gamepad2,
  Globe,
  Heart,
  List,
  Map,
  Package,
  Puzzle,
  Settings,
  Shield,
  Star,
  Terminal,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { ExtensionIcon } from "@flutter-software/shared";

const ICONS: Record<ExtensionIcon, LucideIcon> = {
  puzzle: Puzzle,
  users: Users,
  user: User,
  gamepad: Gamepad2,
  chart: ChartColumn,
  map: Map,
  shield: Shield,
  terminal: Terminal,
  globe: Globe,
  package: Package,
  zap: Zap,
  settings: Settings,
  list: List,
  box: Box,
  book: BookOpen,
  bell: Bell,
  heart: Heart,
  star: Star,
  clock: Clock,
  database: Database,
};

export function extensionIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name as ExtensionIcon]) || Puzzle;
}
