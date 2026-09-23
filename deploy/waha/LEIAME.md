# WhatsApp grátis com o WAHA

O [WAHA](https://waha.devlike.pro) é o WhatsApp Web rodando numa máquina ligada
24h. Ele conecta no **número de sempre** da barbearia (lendo um QR code, como
no WhatsApp Web) e deixa o sistema conversar por ele: quem manda mensagem
escolhe serviço, dia e horário ali mesmo, e o horário cai na agenda.

**Por que não na Vercel?** A Vercel só acorda quando alguém abre o site e
dorme de novo em segundos. O WhatsApp Web precisa ficar conectado o tempo
todo — como uma aba do WhatsApp Web que nunca fecha. Por isso ele mora numa
máquina à parte, e essa máquina pode ser grátis.

> **Leia antes:** o WAHA não é oficial. O WhatsApp pode bloquear número que
> pareça robô de spam. O atendente foi feito para o uso seguro — ele só
> **responde** quem escreveu, com "visto" e "digitando…" antes, e os lembretes
> saem espaçados. Mesmo assim: nada de disparo em massa pelo número da
> barbearia.

## O jeito fácil: pelo painel (recomendado)

Nada de domínio, certificado, porta aberta ou variável na Vercel. Ao lado do
WAHA roda uma "ponte" que só faz conexões **de saída** para o site — por isso
funciona em qualquer máquina, até atrás do roteador de casa.

### 1. Criar a máquina grátis no Google Cloud

O Google dá uma máquina pequena de graça para sempre (plano *Always Free*).
Três detalhes decidem se ela é grátis — o resto pode ficar como vier:

1. Entre em [console.cloud.google.com](https://console.cloud.google.com) com uma
   conta Google e ative o faturamento. Pede cartão, mas esta máquina não é cobrada.
2. Menu → **Compute Engine → Instâncias de VM → Criar instância**.
3. **Região:** `us-central1` (Iowa), `us-east1` ou `us-west1` — só essas são grátis.
4. **Tipo de máquina:** `e2-micro`.
5. **Disco de inicialização:** Ubuntu 24.04 LTS, tipo **Disco permanente
   padrão**, 30 GB. (O "equilibrado", que vem marcado, é cobrado.)
6. Firewall: não precisa marcar nada. Clique em **Criar**.

Dica: em **Faturamento → Orçamentos e alertas**, crie um alerta de R$ 1 para
saber na hora se algo sair do grátis.

### 2. Colar um comando

No sistema: **Painel → Mensagens → WhatsApp da barbearia → Gerar comando de
instalação**. Copie o comando (vale 30 minutos, uma vez).

No Google Cloud, na lista de instâncias, clique em **SSH** ao lado da
máquina: abre uma janela preta. Cole o comando e aperte Enter. Em uns 3
minutos aparece "✓ Pronto!".

### 3. Escanear o QR code

Volte ao painel: o QR code aparece sozinho. No celular da barbearia,
**WhatsApp → ⋮ → Aparelhos conectados → Conectar aparelho** e aponte para a
tela. Está com o painel aberto no próprio celular? Use **Gerar código** e
digite o código em "Conectar com número de telefone".

Pronto: mande "oi" de outro número para testar.

### Depois de instalado

- **Desligue a "mensagem de saudação" e a "mensagem de ausência"** do WhatsApp
  Business. O atendente entende o que sai do celular como "alguém da
  barbearia assumiu a conversa" e fica quieto nela por 4 horas — a saudação
  automática o calaria logo na primeira mensagem.
- Quando você responde um cliente pelo celular, o atendente para naquela
  conversa. O painel lista essas conversas com **Devolver ao atendente**; o
  cliente também pode mandar "menu".
- O celular precisa entrar na internet de vez em quando: aparelho conectado
  cai se o celular ficar uns 14 dias desligado.
- A ponte se atualiza sozinha quando o site muda. Para atualizar o WAHA, gere
  um comando novo no painel (em **Servidor**) e cole de novo — o número
  continua conectado.
- Ver o que está acontecendo, na janela SSH:
  `cd /opt/whatsapp-barbearia && sudo docker compose logs -f`

### Outras máquinas

Qualquer Linux com 1 GB de RAM serve para o mesmo comando: Oracle Cloud
*Always Free* (grátis, mas o cadastro costuma falhar por falta de vaga), uma
VPS de R$ 25–40/mês (Hostinger, Contabo, Hetzner, Magalu Cloud) ou um
computador velho ligado na barbearia com Ubuntu. Render e Koyeb, que têm plano
grátis, **não servem**: desligam a máquina quando o site fica sem acesso e
apagam os arquivos ao reiniciar — o número desconectaria o tempo todo.

## Opcional: entender frases inteiras (Gemini, grátis)

Sem IA o atendente já entende número, "sábado", "amanhã", "15h", o nome do
serviço e "sim". Com o Gemini ele entende "quero cortar sábado de tarde,
umas 3h" — e sempre confirma antes de marcar.

1. Entre em [aistudio.google.com](https://aistudio.google.com) → **Get API key**.
2. Coloque em `GEMINI_API_KEY` na Vercel e faça Redeploy.

O plano grátis tem limite diário (o sistema para em 400 pedidos/dia —
`GEMINI_TETO_DIARIO` — e segue pelo menu). No plano grátis o Google pode usar
o conteúdo para melhorar os produtos dele: por isso só vai o texto que o
cliente escreveu, os nomes dos serviços e o calendário — nunca telefone,
cadastro ou histórico.

## Avançado: WAHA com HTTPS próprio

Para quem já tem domínio e prefere que o site fale direto com o WAHA. Os
arquivos desta pasta sobem o WAHA atrás do Caddy (HTTPS automático):

```bash
cp .env.example .env      # DOMINIO, WAHA_API_KEY e as senhas
docker compose up -d
```

Libere as portas 80 e 443. Na Vercel: `WAHA_URL=https://SEU-DOMINIO`,
`WAHA_API_KEY` (a mesma do `.env`) e `WAHA_HMAC_KEY` (`openssl rand -hex 32`).
Depois, no painel, **Conectar** cria a sessão já com o webhook e mostra o QR
code. (Domínio grátis tipo sslip.io existe, mas o limite compartilhado de
certificados do Let's Encrypt às vezes estoura — com a ponte, nada disso é
preciso.)
