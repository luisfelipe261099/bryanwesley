// ───────────────────────────────────────────────────────────
// O WhatsApp está mandando mensagem de verdade?
//
// A tela só promete "você recebe a confirmação no WhatsApp" quando isso
// é verdade. Enquanto nada estiver ligado, as mensagens ficam guardadas
// na fila — e o cliente não pode ficar esperando uma que não vem.
// ───────────────────────────────────────────────────────────
import { isWhatsappConfigured } from "./providers/whatsapp";
import { pontePareada } from "./ponte";

export async function whatsappEnviando(): Promise<boolean> {
  if (isWhatsappConfigured()) return true;
  try {
    return await pontePareada();
  } catch {
    return false;
  }
}
