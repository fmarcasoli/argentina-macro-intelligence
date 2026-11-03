import {
  Activity,
  Banknote,
  BarChart3,
  Bot,
  Calculator,
  FileText,
  FlaskConical,
  Gauge,
  Layers,
  Settings,
  SlidersHorizontal,
  Star,
  type LucideProps,
} from "lucide-react";
import type { NavSection } from "@/lib/nav";

const ICONS: Record<NavSection["icon"], React.ComponentType<LucideProps>> = {
  overview: Gauge,
  indec: BarChart3,
  bcra: Banknote,
  integrated: Layers,
  builder: SlidersHorizontal,
  econometrics: FlaskConical,
  simulator: Activity,
  calculators: Calculator,
  ai: Bot,
  reports: FileText,
  favorites: Star,
  settings: Settings,
};

export function NavIcon({ name, ...props }: { name: NavSection["icon"] } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden {...props} />;
}
