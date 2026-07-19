import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, FileUp, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCrm } from '@/context/CrmContext'
import { getDataProviderMode } from '@/services/dataMode'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import {
  deleteTaskAttachmentRow,
  fetchAttachmentsForTaskIds,
  getAttachmentSignedUrl,
  uploadTaskAttachment,
  type LeadTaskAttachmentRow,
} from '@/services/leadTaskAttachments'
import { cn } from '@/lib/utils'

type Props = {
  leadId: string
  className?: string
}

export function LeadTaskPanel({ leadId, className }: Props) {
  const crm = useCrm()
  const dataMode = getDataProviderMode()
  const supa = dataMode === 'supabase' && isSupabaseConfigured
  const tasks = crm.leadTasks
    .filter((t) => t.leadId === leadId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const [newTitle, setNewTitle] = useState('')
  const [attByTask, setAttByTask] = useState<Record<string, LeadTaskAttachmentRow[]>>({})
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
  const [attachmentToDelete, setAttachmentToDelete] = useState<LeadTaskAttachmentRow | null>(null)

  const taskIdKey = tasks.map((t) => t.id).join(',')
  useEffect(() => {
    if (!supa || taskIdKey === '') {
      setAttByTask((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    let cancelled = false
    const ids = taskIdKey.split(',')
    void (async () => {
      try {
        const rows = await fetchAttachmentsForTaskIds(ids)
        if (cancelled) return
        const map: Record<string, LeadTaskAttachmentRow[]> = {}
        for (const r of rows) {
          const list = map[r.leadTaskId] ?? []
          list.push(r)
          map[r.leadTaskId] = list
        }
        setAttByTask(map)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supa, taskIdKey, leadId])

  const handleAdd = () => {
    const t = newTitle.trim()
    if (!t) return
    crm.addLeadTask({ leadId, title: t, assigneeId: null, dueAt: null, status: 'open', taskType: 'sequence', metadata: {} })
    setNewTitle('')
    toast.success('Tarefa adicionada')
  }

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= tasks.length) return
    const ids = tasks.map((x) => x.id)
    const t = ids[index]
    ids[index] = ids[j]
    ids[j] = t
    crm.reorderLeadTasks(leadId, ids)
  }

  const openFile = async (a: LeadTaskAttachmentRow) => {
    try {
      const url = await getAttachmentSignedUrl(a.storagePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir arquivo')
    }
  }

  const removeAttachment = async (a: LeadTaskAttachmentRow) => {
    try {
      await deleteTaskAttachmentRow(a.id, a.storagePath)
      setAttByTask((p) => ({
        ...p,
        [a.leadTaskId]: (p[a.leadTaskId] ?? []).filter((x) => x.id !== a.id),
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha')
    }
  }

  return (
    <section className={cn('space-y-3', className)} aria-labelledby="lead-tasks-heading">
      <h2 id="lead-tasks-heading" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Sequência e tarefas
      </h2>
      <p className="m-0 text-xs text-muted-foreground">
        Ordene a sequência; anexe arquivos por tarefa (sincroniza com a banco de dados no modo online).
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Nova tarefa da sequência"
          aria-label="Nova tarefa da sequência"
          className="min-w-[12rem] flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
        />
        <Button type="button" size="sm" onClick={handleAdd}>
          Adicionar
        </Button>
      </div>

      <ul className="m-0 list-none space-y-2 p-0">
        {tasks.length === 0 && <li className="text-sm text-muted-foreground">Sem tarefas ainda.</li>}
        {tasks.map((task, i) => (
          <li
            key={task.id}
            className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3"
          >
            <div className="flex flex-wrap items-start gap-2">
              <label className="mt-0.5 flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={task.status === 'done'}
                  onCheckedChange={() =>
                    crm.updateLeadTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })
                  }
                />
                <span className={task.status === 'done' ? 'line-through text-muted-foreground' : ''}>{task.title}</span>
              </label>
              <div className="flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} title="Mover acima" aria-label="Mover tarefa para cima" disabled={i === 0}>
                  <ChevronUp className="h-4 w-4" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} title="Mover abaixo" aria-label="Mover tarefa para baixo" disabled={i === tasks.length - 1}>
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => setTaskToDelete(task.id)}
                  title="Remover tarefa"
                  aria-label="Remover tarefa"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
            {supa ? (
              <div className="pl-6 text-xs text-muted-foreground">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-primary hover:underline focus-within:ring-2 focus-within:ring-ring/50">
                  <FileUp className="h-3.5 w-3.5" aria-hidden />
                  <span>Anexar arquivo</span>
                  <input
                    type="file"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      try {
                        const row = await uploadTaskAttachment(task.id, f)
                        setAttByTask((p) => ({
                          ...p,
                          [task.id]: [...(p[task.id] ?? []), row],
                        }))
                        toast.success('Arquivo enviado')
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Falha no envio')
                      }
                    }}
                  />
                </label>
                <ul className="mt-1.5 m-0 list-inside list-disc space-y-0.5 p-0">
                  {(attByTask[task.id] ?? []).map((a) => (
                    <li key={a.id} className="list-none pl-0">
                      <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => void openFile(a)}>
                        <Paperclip className="mr-1 inline h-3 w-3" aria-hidden />
                        {a.fileName || a.storagePath}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1 text-xs text-destructive"
                        onClick={() => setAttachmentToDelete(a)}
                      >
                        Remover
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={taskToDelete !== null}
        onOpenChange={(open) => { if (!open) setTaskToDelete(null) }}
        title="Eliminar tarefa?"
        description="A tarefa será removida da sequência. Esta ação não pode ser desfeita."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (taskToDelete) crm.removeLeadTask(taskToDelete)
          setTaskToDelete(null)
        }}
      />

      <ConfirmDialog
        open={attachmentToDelete !== null}
        onOpenChange={(open) => { if (!open) setAttachmentToDelete(null) }}
        title="Remover anexo?"
        description="O arquivo anexado será apagado de forma permanente. Esta ação não pode ser desfeita."
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (attachmentToDelete) void removeAttachment(attachmentToDelete)
          setAttachmentToDelete(null)
        }}
      />
    </section>
  )
}
