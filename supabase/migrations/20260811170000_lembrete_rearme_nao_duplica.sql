-- O rearme do lembrete podia mandar a mesma mensagem duas vezes para o paciente.
--
-- Achado por auditoria adversarial em cima do conserto anterior (20260811140000), que
-- limpou `error` e `sent_at` ao rearmar. A limpeza resolveu a linha que mentia na tela e
-- DESARMOU a única evidência que impedia a duplicata. Três fatos que se somam:
--
-- 1. O bloco "venda em cima da hora" guarda com `status <> 'enviado'`, então 'erro' e
--    'simulado' VOLTAM para a fila. O bloco de cima usa `status in ('pendente','cancelado')`
--    e exclui 'erro' de propósito: o mesmo trigger tinha duas políticas brigando.
--
-- 2. Esse mesmo bloco não tem o `is distinct from` que o de cima tem, então reescreve em
--    TODA gravação na clinic_sales — e `crm-cirurgia-push` carimba `srg_surgery_id` sozinho,
--    o que basta para rearmar.
--
-- 3. 'erro' NÃO prova que a mensagem não chegou. Em crm-send-message o `try` começa no
--    envio ao provedor e só fecha depois de cinco escritas no banco; qualquer uma delas
--    falhando devolve 502 com a mensagem já no celular do paciente.
--
-- Juntos: mensagem entregue → gravada como 'erro' → próxima escrita na venda rearma →
-- paciente recebe de novo. Sem teto, porque nada contava tentativa.
--
-- Conserto, em três partes:
--
-- (a) As duas cláusulas passam a usar a MESMA política, `status in ('pendente','cancelado')`.
--     Lembrete em 'erro' não volta sozinho para a fila. Deixar de enviar por engano é ruim;
--     mandar duas vezes para paciente de cirurgia é pior, e agora o erro fica visível em vez
--     de ser reciclado em silêncio.
-- (b) O bloco "em cima da hora" ganha o `is distinct from` que faltava: rearma quando a data
--     muda, não a cada UPDATE que passar pela tabela.
-- (c) `attempts` guarda quantas vezes já se tentou. É a auditoria que a limpeza de `error`
--     apagava: `error` descreve a tentativa atual, `attempts` não zera nunca. Quem for
--     reprocessar um lembrete em 'erro' faz isso de propósito, e o contador mostra o que
--     já aconteceu antes.

alter table public.surgery_reminders
  add column if not exists attempts integer not null default 0;

comment on column public.surgery_reminders.attempts is
  'Quantas vezes o envio já foi tentado. Nunca é zerado pelo rearme — é o que sobra de auditoria quando error/sent_at são limpos.';

create or replace function public.clinic_sales_after_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  alvo_dia date;
  etapa text;
  funil text;
begin
  if new.lead_id is not null then
    etapa := public.clinic_sale_stage(new);
    funil := case when new.kind = 'protocolo' then 'pipeline-protocolos' else 'pipeline-processo-cirurgico' end;
    update public.leads
      set pipeline_id = funil,
          stage_id = etapa,
          stage_entered_at = case when stage_id is distinct from etapa then now() else stage_entered_at end,
          updated_at = now()
    where id = new.lead_id
      and (pipeline_id is distinct from funil or stage_id is distinct from etapa);
  end if;

  if new.kind <> 'cirurgia' then
    return new;
  end if;

  if new.scheduled_at is not null then
    insert into public.surgery_checklist_items (tenant_id, sale_id, item, required, position)
    select new.tenant_id, new.id, c.item, c.required, c.position
    from public.surgery_checklist_catalog c
    where c.tenant_id = new.tenant_id and c.active
      and (c.item <> 'Reserva de hotel (paciente de fora)' or new.hotel_needed)
    on conflict (sale_id, item) do nothing;
  end if;

  if new.scheduled_at is not null and new.status in ('vendida', 'agendada') then
    alvo_dia := (new.scheduled_at at time zone 'America/Sao_Paulo')::date;

    insert into public.surgery_reminders (tenant_id, sale_id, kind, scheduled_for)
    select new.tenant_id, new.id, k.kind, alvo_dia - k.dias
    from (values ('d30', 30), ('d15', 15), ('d7', 7), ('d2', 2)) as k(kind, dias)
    where alvo_dia - k.dias >= current_date
    on conflict (sale_id, kind) do update
      set scheduled_for = excluded.scheduled_for,
          status = 'pendente',
          error = null,
          sent_at = null
      where surgery_reminders.status in ('pendente', 'cancelado')
        and surgery_reminders.scheduled_for is distinct from excluded.scheduled_for;

    update public.surgery_reminders set status = 'cancelado'
    where sale_id = new.id and status = 'pendente' and scheduled_for > alvo_dia;

    if alvo_dia - 30 < current_date and alvo_dia - current_date > 7 then
      insert into public.surgery_reminders (tenant_id, sale_id, kind, scheduled_for)
      values (new.tenant_id, new.id, 'd30', current_date)
      on conflict (sale_id, kind) do update
        set scheduled_for = current_date,
            status = 'pendente',
            error = null,
            sent_at = null
        -- MESMA política do bloco de cima: 'erro' e 'simulado' NÃO voltam sozinhos para a
        -- fila, e sem mudança de data não há reescrita.
        where surgery_reminders.status in ('pendente', 'cancelado')
          and surgery_reminders.scheduled_for is distinct from current_date;
    end if;
  end if;

  if new.status = 'cancelada' then
    update public.surgery_reminders set status = 'cancelado'
    where sale_id = new.id and status = 'pendente';
  end if;

  return new;
end $function$;
