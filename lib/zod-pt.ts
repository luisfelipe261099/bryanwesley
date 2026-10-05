// Mensagens de validação do zod em português.
//
// Sem isto, campo apagado no celular devolvia ao dono "Too small: expected
// number to be >=5" ou "Invalid input: expected number, received NaN".
// Importado pelos arquivos de ação; configurar mais de uma vez não tem
// efeito colateral.
import { z } from "zod";

z.config(z.locales.ptBR ? z.locales.ptBR() : z.locales.pt());

export { z };
