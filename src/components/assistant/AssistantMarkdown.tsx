import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

import { cn } from '@/lib/utils'

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-bold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed [&>p]:mb-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-2 hover:no-underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className)
    if (isBlock) {
      return <code className={cn('font-mono text-xs', className)}>{children}</code>
    }
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem]">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded border border-border bg-muted/50 p-2 text-xs last:mb-0">{children}</pre>
  ),
  hr: () => <hr className="my-3 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-primary/40 pl-3 italic text-muted-foreground">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse border border-border text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
}

type Props = {
  content: string
  className?: string
}

/** Renderiza respostas do GLM em Markdown (listas, negrito, cabeçalhos, links). */
export function AssistantMarkdown({ content, className }: Props) {
  return (
    <div className={cn('assistant-md max-w-none break-words text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
