import {
  Scissors,
  Brush,
  Crown,
  Ruler,
  Eye,
  Sparkles,
  Palette,
  Droplets,
  type LucideIcon,
} from "lucide-react";

// Um ícone por serviço — mesma família (Lucide), traço consistente.
export const serviceIcons: Record<string, LucideIcon> = {
  corte: Scissors,
  barba: Brush,
  combo: Crown,
  pezinho: Ruler,
  sobrancelha: Eye,
  platinado: Sparkles,
  pigmentacao: Palette,
  hidratacao: Droplets,
};
