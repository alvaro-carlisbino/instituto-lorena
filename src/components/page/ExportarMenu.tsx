import { useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Botão único de exportação das telas de relatório: Excel (.xlsx) ou PDF. */
export function ExportarMenu({
  onExcel,
  onPdf,
  disabled,
  className,
}: {
  onExcel: () => Promise<void> | void
  onPdf: () => void
  disabled?: boolean
  className?: string
}) {
  const [gerando, setGerando] = useState(false)
  const rodar = async (fn: () => Promise<void> | void) => {
    setGerando(true)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar')
    } finally {
      setGerando(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || gerando}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 gap-1.5', className)}
      >
        <Download className="size-4" aria-hidden />
        <span className="hidden sm:inline">{gerando ? 'Gerando…' : 'Exportar'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => void rodar(onExcel)}>
          <FileSpreadsheet className="size-4" aria-hidden /> Planilha Excel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void rodar(onPdf)}>
          <FileText className="size-4" aria-hidden /> PDF para imprimir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
