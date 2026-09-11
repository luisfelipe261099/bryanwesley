"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { Modal } from "@/components/Modal";

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

      <Modal open={open} onClose={() => setOpen(false)} label="Check-in" maxWidth="max-w-xs">
        <div className="text-center">
          <div
            className="mx-auto w-full overflow-hidden rounded-2xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
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
      </Modal>
    </>
  );
}
