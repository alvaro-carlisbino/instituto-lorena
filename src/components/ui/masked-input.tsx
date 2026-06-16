import * as React from "react"

import { Input } from "@/components/ui/input"

// Inputs com máscara BR (CPF, CEP, telefone). Controlados: exibem formatado e devolvem
// SÓ os dígitos via onValueChange(raw). Use raw nos ops/cadastro (Bling/NF-e exigem dígitos).

export const onlyDigits = (v: string) => String(v ?? "").replace(/\D/g, "")

export function formatCpf(v: string): string {
  const d = onlyDigits(v).slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4")
}

export function formatCep(v: string): string {
  const d = onlyDigits(v).slice(0, 8)
  return d.replace(/^(\d{5})(\d)/, "$1-$2")
}

export function formatPhoneBr(v: string): string {
  const d = onlyDigits(v).slice(0, 11)
  if (d.length <= 2) return d.replace(/^(\d{0,2})/, "($1")
  if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, "($1) $2")
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3")
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3")
}

type MaskedInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  /** valor cru (dígitos) OU já formatado — sempre reexibido formatado */
  value?: string
  /** devolve (rawDigits, formatted) a cada mudança */
  onValueChange?: (raw: string, formatted: string) => void
}

function makeMaskedInput(format: (v: string) => string, inputMode: React.HTMLAttributes<HTMLInputElement>["inputMode"]) {
  return function MaskedInput({ value = "", onValueChange, ...props }: MaskedInputProps) {
    const formatted = format(value)
    return (
      <Input
        inputMode={inputMode}
        value={formatted}
        onChange={(e) => {
          const raw = onlyDigits(e.target.value)
          onValueChange?.(raw, format(raw))
        }}
        {...props}
      />
    )
  }
}

export const CpfInput = makeMaskedInput(formatCpf, "numeric")
export const CepInput = makeMaskedInput(formatCep, "numeric")
export const PhoneInput = makeMaskedInput(formatPhoneBr, "tel")
