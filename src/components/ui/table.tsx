import * as React from "react"

import { cn } from "@/lib/utils"

// Primitivos de tabela estilizados — substituem os <table> crus espalhados (LeadsPage,
// SalesReportPage, DataViewsPage, AnalyticsPage, etc.). Densidade SaaS, borda fina, hover.
//
// Densidade é decisão de sistema, não de tela: linha de ~40px com texto simples. Estas
// medidas valem para as 27 telas com tabela, então NÃO sobrescreva `py-*` na página —
// era o que /leads (py-5) e o funil em lista (py-4) faziam, e uma linha de lead custava
// 101px, cinco leads por tela. Precisa de linha alta? O conteúdo da célula manda; o
// padding fica quieto.

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-border bg-muted/40 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/60 transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-medium tracking-wide text-muted-foreground uppercase whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0",
        // Valor atômico não quebra linha. `tabular-nums` já é como o código marca
        // número, data e dinheiro, então serve de gancho: quando a coluna é espremida,
        // "R$ 1.234,56" e "10/08/2026" preferem alargar a tabela (o contêiner tem
        // overflow-x) a virar duas linhas e engordar TODA a linha da tabela. Era essa
        // quebra que fazia a linha de /leads medir 101px por causa do telefone.
        "[&_.tabular-nums]:whitespace-nowrap",
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption data-slot="table-caption" className={cn("mt-3 text-sm text-muted-foreground", className)} {...props} />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
