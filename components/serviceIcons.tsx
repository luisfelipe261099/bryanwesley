import {
  Scissors,
  Brush,
  Crown,
  Droplet,
  Ruler,
  Eye,
  Sparkles,
  Droplets,
  type LucideIcon,
} from "lucide-react";

// Um ícone por serviço — mesma família (Lucide), traço consistente.
export const serviceIcons: Record<string, LucideIcon> = {
  corte: Scissors,
  barba: Brush,
  combo: Crown,
  lavagem: Droplet,
  pezinho: Ruler,
  sobrancelha: Eye,
  platinado: Sparkles,
  hidratacao: Droplets,
};
