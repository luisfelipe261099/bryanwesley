"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, X } from "lucide-react";

export type LeituraQr = { token: string } | { code: string };

/**
 * Entende o que veio no QR: o link de check-in do app
 * (…/barbeiro/checkin/<token>) ou um código de 6 letras. O token só vai
 * para a nossa própria ação de check-in; nenhum link lido é aberto.
 */
export function interpretarQr(texto: string): LeituraQr | null {
  const t = texto.trim();
  const m = t.match(/\/barbeiro\/checkin\/([A-Za-z0-9_-]{8,128})(?:[/?#]|$)/);
  if (m) return { token: m[1] };
  if (/^[A-Za-z0-9]{6}$/.test(t)) return { code: t.toUpperCase() };
  return null;
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Câmera em tela cheia que lê o QR do cliente. */
export function LerQr({ onLer, onFechar }: { onLer: (l: LeituraQr) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(true);
  const [montado, setMontado] = useState(false);
  const lerRef = useRef(onLer);
  lerRef.current = onLer;

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    let parar = false;
    let stream: MediaStream | null = null;
    let quadro = 0;
    let avisoAte = 0;

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro(
          window.isSecureContext
            ? "Este navegador não abre a câmera aqui. Use a câmera do celular no QR ou digite o código."
            : "A câmera só abre no endereço seguro (https). Digite o código.",
        );
        setAbrindo(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        const nome = (e as { name?: string })?.name;
        setErro(
          nome === "NotAllowedError" || nome === "SecurityError"
            ? "A câmera foi bloqueada. Libere a câmera para este site nos ajustes do navegador e tente de novo."
            : nome === "NotFoundError" || nome === "OverconstrainedError"
              ? "Não achamos uma câmera neste aparelho. Digite o código."
              : "Não deu para abrir a câmera agora. Tente de novo ou digite o código.",
        );
        setAbrindo(false);
        return;
      }
      if (parar) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setAbrindo(false);

      // Leitor nativo quando existe (Android/Chrome); no iPhone, jsQR.
      let detector: Detector | null = null;
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      if (BD) {
        try {
          detector = new BD({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const ler = async () => {
        if (parar) return;
        let texto: string | null = null;
        if (v.readyState >= 2 && v.videoWidth) {
          try {
            if (detector) {
              texto = (await detector.detect(v))[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              const escala = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
              canvas.width = Math.round(v.videoWidth * escala);
              canvas.height = Math.round(v.videoHeight * escala);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              texto = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          } catch {
            texto = null;
          }
        }
        if (parar) return;
        if (texto) {
          const l = interpretarQr(texto);
          if (l) {
            parar = true;
            navigator.vibrate?.(60);
            lerRef.current(l);
            return;
          }
          if (Date.now() > avisoAte) {
            avisoAte = Date.now() + 2500;
            setAviso("Esse QR não é de um agendamento. Peça para o cliente abrir o QR no app.");
          }
        }
        quadro = window.setTimeout(ler, detector ? 150 : 120);
      };
      ler();
    }

    iniciar();
    return () => {
      parar = true;
      window.clearTimeout(quadro);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [onFechar]);

  if (!montado) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Ler QR do cliente" className="fixed inset-0 z-[100] flex flex-col bg-black">
      <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />

      {!erro && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative aspect-square w-[min(72vw,320px)] rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
            <span className="absolute -left-0.5 -top-0.5 h-10 w-10 rounded-tl-3xl border-l-4 border-t-4 border-electric" />
            <span className="absolute -right-0.5 -top-0.5 h-10 w-10 rounded-tr-3xl border-r-4 border-t-4 border-electric" />
            <span className="absolute -bottom-0.5 -left-0.5 h-10 w-10 rounded-bl-3xl border-b-4 border-l-4 border-electric" />
            <span className="absolute -bottom-0.5 -right-0.5 h-10 w-10 rounded-br-3xl border-b-4 border-r-4 border-electric" />
          </div>
        </div>
      )}

      <div className="relative flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="label text-white">Ler QR do cliente</span>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar câmera"
          className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative mt-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
        {abrindo && (
          <p className="inline-flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a câmera…
          </p>
        )}
        {erro ? (
          <div className="mx-auto max-w-sm rounded-2xl border border-amber-400/30 bg-surface-2 p-4 text-left">
            <p role="alert" className="flex items-start gap-2 text-sm text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              {erro}
            </p>
            <button
              type="button"
              onClick={onFechar}
              className="btn-royal label mt-4 w-full rounded-xl px-4 py-3 text-white"
            >
              Digitar o código
            </button>
          </div>
        ) : (
          !abrindo && (
            <p className="mx-auto max-w-xs text-sm text-white/90">
              {aviso ?? "Aponte para o QR que aparece no app do cliente."}
            </p>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}
