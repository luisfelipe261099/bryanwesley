"use client";

import { useState } from "react";
import { QrCode, X } from "lucide-react";

/**
 * QR que o barbeiro lê para validar a chegada do cliente.
 * O SVG é gerado no servidor (biblioteca `qrcode`) e chega pronto —
 * o cliente só decide quando mostrar.
 */
export function CheckinQR({
  svg,
  code,
  service,
}: {
  svg: string;
  code: string;
  service: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline label inline-flex items-center gap-2 rounded-full px-5 py-3 text-electric"
      >
        <QrCode className="h-3.5 w-3.5" />
        Meu QR
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Code de check-in"
          className="fixed inset-0 z-[60] grid place-items-center bg-ink/90 p-5 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass w-full max-w-xs rounded-3xl p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="label text-electric">Check-in</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="text-steel-400 transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="mx-auto mt-5 w-full overflow-hidden rounded-2xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />

            <p className="mt-4 font-display text-2xl tracking-[0.2em] text-white">
              {code}
            </p>
            <p className="mt-1 text-sm text-steel-400">{service}</p>
            <p className="mt-4 text-xs leading-relaxed text-steel-400">
              Mostre este código ao barbeiro no início do atendimento. Se o
              leitor falhar, ele pode digitar o código acima.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
