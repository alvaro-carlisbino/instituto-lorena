import { type ReactNode, useState } from 'react'
import { CircleHelpIcon, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type HelpSection = {
  icon: string
  title: string
  content: ReactNode
}

type HelpDrawerProps = {
  title: string
  sections: HelpSection[]
  label?: string
}

/**
 * HelpDrawer — Painel de ajuda lateral contextual.
 * Abre como Sheet pela direita sem bloquear o fluxo de trabalho.
 * Substitui o PageHelp (dialog central) para melhor UX.
 */
export function HelpDrawer({
  title,
  sections,
  label = 'Ajuda desta página',
}: HelpDrawerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        <CircleHelpIcon className="size-4" aria-hidden />
        Ajuda
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-sm overflow-y-auto flex flex-col gap-0 p-0"
        >
          <SheetHeader className="border-b border-border px-5 py-4 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <CircleHelpIcon className="size-4 text-primary shrink-0" />
              <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Fechar ajuda"
            >
              <X className="size-4" />
            </Button>
          </SheetHeader>

          <div className="flex flex-col gap-0 divide-y divide-border">
            {sections.map((section, i) => (
              <div key={i} className="px-5 py-4 space-y-1.5">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span aria-hidden className="text-base leading-none">
                    {section.icon}
                  </span>
                  {section.title}
                </p>
                <div className="text-sm text-muted-foreground leading-relaxed pl-6">
                  {section.content}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-auto border-t border-border px-5 py-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Dúvidas? Fale com o administrador da clínica ou acesse as Configurações.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
