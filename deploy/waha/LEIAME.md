# WhatsApp grátis com o WAHA

O [WAHA](https://waha.devlike.pro) é o WhatsApp Web rodando num servidor da
barbearia. Ele conecta no **número de sempre** (lendo um QR code, como no
WhatsApp Web) e deixa o sistema conversar por ele: quem manda mensagem
escolhe serviço, dia e horário ali mesmo, e o horário cai na agenda.

Desde a versão 2026.6 o WAHA é inteiro grátis. O custo é só o servidor — que
também pode ser grátis.

> **Leia antes:** o WAHA não é oficial. O WhatsApp pode bloquear número que
> pareça robô de spam. O atendente foi feito para o uso seguro — ele só
> **responde** quem escreveu, com pausa de gente ("visto", "digitando…") — e
> os lembretes saem espaçados. Mesmo assim: nada de disparo em massa pelo
> número da barbearia (promoção para a lista inteira de clientes é o jeito
> mais rápido de perder o número).

## 1. O servidor (uma máquina ligada 24h)

Precisa de 1 GB de RAM e Docker. Opções, da mais barata:

| Onde | Custo | Observação |
|------|-------|------------|
| Oracle Cloud "Always Free" | R$ 0 | Máquina ARM de graça para sempre; o cadastro pede cartão e às vezes falta vaga em São Paulo. Use a imagem `devlikeapro/waha:gows-arm`. |
| Google Cloud e2-micro | R$ 0 | Grátis nas regiões dos EUA (us-central1, us-east1, us-west1). 1 GB dá conta. |
| VPS comum (Hostinger, Contabo, Hetzner, Magalu Cloud) | ~R$ 25–40/mês | O caminho sem surpresa. |

Libere as portas **80** e **443** no firewall do provedor (na Oracle: *Security
List* da rede e o `iptables` da máquina).

Instale o Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Subir o WAHA

Copie esta pasta (`deploy/waha`) para o servidor e:

```bash
cp .env.example .env
nano .env                 # DOMINIO, WAHA_API_KEY e as senhas
docker compose up -d
```

Confira abrindo `https://SEU-DOMINIO/dashboard` (usuário e senha do `.env`).

## 3. Ligar no site (Vercel → Settings → Environment Variables)

| Variável | Valor |
|----------|-------|
| `WAHA_URL` | `https://SEU-DOMINIO` |
| `WAHA_API_KEY` | a mesma do `.env` do servidor |
| `WAHA_HMAC_KEY` | uma chave nova (`openssl rand -hex 32`) — assina o que o WAHA manda para o site |
| `GEMINI_API_KEY` | opcional — veja o passo 5 |

Salve e faça um **Redeploy**.

## 4. Conectar o número

No sistema: **Painel → Mensagens → WhatsApp da barbearia → Conectar**.
Aparece o QR code: no celular da barbearia, **WhatsApp → ⋮ → Aparelhos
conectados → Conectar aparelho** e aponte para a tela. Está com o painel
aberto no próprio celular? Use **Gerar código** e digite o código em
"Conectar com número de telefone".

Pronto: mande "oi" de outro número para testar.

**Importante:**

- **Desligue a "mensagem de saudação" e a "mensagem de ausência"** do
  WhatsApp Business. O atendente entende o que sai do celular como "alguém
  da barbearia assumiu a conversa" e fica quieto nela por 4 horas — a
  saudação automática o calaria logo na primeira mensagem.
- Quando você responde um cliente pelo celular, o atendente para naquela
  conversa (4h; ajuste com `WHATSAPP_PAUSA_HUMANO_MIN`). O painel lista essas
  conversas com o botão **Devolver ao atendente**; o cliente também pode
  mandar "menu".
- O celular precisa entrar na internet de vez em quando: aparelho conectado
  cai se o celular ficar uns 14 dias desligado.

## 5. Opcional: entender frases inteiras (Gemini, grátis)

Sem IA o atendente já entende número, "sábado", "amanhã", "15h", o nome do
serviço e "sim". Com o Gemini ele entende "quero cortar sábado de tarde,
umas 3h" — e sempre confirma antes de marcar.

1. Entre em [aistudio.google.com](https://aistudio.google.com) → **Get API key**.
2. Coloque em `GEMINI_API_KEY` na Vercel e faça Redeploy.

O plano grátis tem limite diário (o sistema para em 400 pedidos/dia —
`GEMINI_TETO_DIARIO` — e segue pelo menu). No plano grátis o Google pode usar
o conteúdo para melhorar os produtos dele: por isso só vai o texto que o
cliente escreveu, os nomes dos serviços e o calendário — nunca telefone,
cadastro ou histórico. O modelo padrão é `gemini-3.5-flash-lite`; troque com
`GEMINI_MODEL`.

## Manutenção

```bash
docker compose pull && docker compose up -d   # atualizar o WAHA
docker compose logs -f waha                   # ver o que está acontecendo
```

A sessão fica em `./sessions`: atualizar ou reiniciar não desconecta o
número.
