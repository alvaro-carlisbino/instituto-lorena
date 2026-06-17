import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  // Placeholder puramente visual — escondido p/ leitores de tela (evita "caixas" vazias
  // sendo anunciadas). O aviso de carregamento deve ficar na região (aria-busy/aria-live).
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
