import { useId, useState, type ReactNode } from 'react'
import { CircleHelpIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type PageHelpProps = {
  title: string
  children: ReactNode
  label?: string
}

/**
 * Botão "?" no cabeçalho: abre um diálogo com o texto de ajuda (2–4 frases ou listas), sem encher a página.
 */
export function PageHelp({ title, children, label = 'Saiba mais sobre esta página' }: PageHelpProps) {
  const [open, setOpen] = useState(false)
  const helpBodyId = useId()

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CircleHelpIcon className="h-4 w-4" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton aria-describedby={helpBodyId}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div
            id={helpBodyId}
            className="text-left text-sm text-muted-foreground *:[_p+_p]:mt-3 *:[_p]:m-0 *:[_ul]:mt-2 *:[_ul]:list-inside *:[_ul]:list-disc *:[_ul]:space-y-1.5 *:[_ul]:pl-1 *:[_li]:pl-0.5"
          >
            {children}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
