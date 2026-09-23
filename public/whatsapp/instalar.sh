#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────
# Instala o WhatsApp da barbearia neste servidor: o WAHA e a ponte que
# conversa com o site. Nenhuma porta aberta, nenhum domínio: a ponte só
# faz conexões de saída.
#
# O painel (Mensagens → WhatsApp da barbearia) monta o comando com o
# endereço do site e um código de uso único:
#
#   curl -fsSL https://SITE/whatsapp/instalar.sh | sudo bash -s -- https://SITE CODIGO
#
# Rodar de novo (com um código novo) atualiza sem desconectar o número.
# ───────────────────────────────────────────────────────────
set -euo pipefail

# Tudo dentro de uma função: com o script vindo por "curl | bash", um
# comando que lesse a entrada comeria o resto do arquivo.
principal() {
  local SITE="${1:-}" CODIGO="${2:-}"
  local DIR=/opt/whatsapp-barbearia

  falha() { echo; echo "✗ $*" >&2; exit 1; }
  passo() { echo; echo "▶ $*"; }

  [ -n "$SITE" ] && [ -n "$CODIGO" ] || falha "Use o comando gerado no painel (Mensagens → WhatsApp da barbearia)."
  [ "$(id -u)" -eq 0 ] || falha "Rode com sudo."
  SITE="${SITE%/}"
  command -v curl >/dev/null 2>&1 || falha "Falta o curl (sudo apt-get install -y curl)."

  passo "Docker"
  if ! command -v docker >/dev/null 2>&1; then
    echo "  instalando (1 a 2 minutos)…"
    curl -fsSL https://get.docker.com | sh </dev/null >/dev/null
  fi
  docker compose version >/dev/null 2>&1 || falha "O Docker Compose não veio junto. Instale o pacote docker-compose-plugin."
  systemctl enable --now docker >/dev/null 2>&1 || true

  # Máquina pequena (a grátis do Google tem 1 GB): um pouco de swap evita
  # que o WAHA seja derrubado por falta de memória.
  local mem
  mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem" -lt 1800 ] && ! swapon --show 2>/dev/null | grep -q .; then
    passo "Criando 2 GB de swap (a máquina tem ${mem} MB de memória)"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  passo "Conferindo o código com o site"
  local resposta segredo
  resposta="$(curl -fsS -X POST "$SITE/api/whatsapp/ponte/parear" \
    -H 'content-type: application/json' \
    --data "{\"codigo\":\"$CODIGO\"}" </dev/null 2>/dev/null)" \
    || falha "Código inválido ou vencido (vale 30 minutos, uma vez). Gere outro comando no painel."
  segredo="$(printf '%s' "$resposta" | sed -n 's/.*"segredo":"\([A-Za-z0-9_-]*\)".*/\1/p')"
  [ -n "$segredo" ] || falha "O site não devolveu o segredo da ponte."

  passo "Preparando $DIR"
  mkdir -p "$DIR"
  cd "$DIR"
  curl -fsSL "$SITE/whatsapp/ponte.mjs" -o ponte.mjs </dev/null || falha "Não deu para baixar a ponte do site."

  aleatorio() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  # Reinstalação: a chave do WAHA fica a mesma — a sessão do WhatsApp
  # (o número conectado) continua valendo.
  antigo() { [ -f .env ] && sed -n "s/^$1=//p" .env | head -n 1 || true; }
  local waha_key hmac imagem
  waha_key="$(antigo WAHA_API_KEY)"; [ -n "$waha_key" ] || waha_key="$(aleatorio)"
  hmac="$(antigo HMAC_LOCAL)"; [ -n "$hmac" ] || hmac="$(aleatorio)"
  case "$(uname -m)" in
    aarch64|arm64) imagem=devlikeapro/waha:gows-arm ;;
    *) imagem=devlikeapro/waha:gows ;;
  esac

  umask 077
  cat > .env <<ENV
SITE=$SITE
SEGREDO=$segredo
WAHA_API_KEY=$waha_key
HMAC_LOCAL=$hmac
IMAGEM=$imagem
ENV

  cat > docker-compose.yml <<'COMPOSE'
# WhatsApp da barbearia: o WAHA e a ponte que conversa com o site.
# Nenhuma porta aberta — a ponte só faz conexões de saída.
# Ver o que acontece:  sudo docker compose logs -f
services:
  waha:
    image: ${IMAGEM}
    restart: always
    environment:
      WAHA_API_KEY: ${WAHA_API_KEY}
      WHATSAPP_DEFAULT_ENGINE: GOWS
      TZ: America/Sao_Paulo
    volumes:
      # A sessão do WhatsApp mora aqui: sobrevive a reinício e atualização.
      - ./sessions:/app/.sessions

  ponte:
    image: node:22-alpine
    restart: always
    working_dir: /app
    command: ["node", "ponte.mjs"]
    environment:
      SITE: ${SITE}
      SEGREDO: ${SEGREDO}
      WAHA_API_KEY: ${WAHA_API_KEY}
      HMAC_LOCAL: ${HMAC_LOCAL}
    volumes:
      # Gravável: a ponte se atualiza sozinha quando o site tem versão nova.
      - ./ponte.mjs:/app/ponte.mjs
    depends_on:
      - waha
COMPOSE

  passo "Subindo o WhatsApp (a primeira vez baixa uns 300 MB)"
  docker compose pull --quiet </dev/null
  docker compose up -d --remove-orphans </dev/null

  echo
  echo "✓ Pronto!"
  echo
  echo "  Volte ao painel do site (Mensagens → WhatsApp da barbearia):"
  echo "  em alguns segundos aparece o QR code. Escaneie com o celular da"
  echo "  barbearia em WhatsApp → Aparelhos conectados → Conectar aparelho."
  echo
  echo "  Ver o que está acontecendo:  cd $DIR && sudo docker compose logs -f"
}

principal "$@"
