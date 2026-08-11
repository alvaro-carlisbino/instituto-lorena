-- Lembrete de cirurgia rearmado continuava carregando o erro e a data do envio velho.
--
-- Os dois `on conflict do update` do trigger devolvem a linha para 'pendente' quando a
-- cirurgia é remarcada, mas não limpavam `error` nem `sent_at`. Resultado: 8 lembretes
-- estavam 'pendente' exibindo "venda sem lead vinculado", e 7 dessas vendas já tinham
-- lead havia dias. Quem abre a tela lê um erro que não vale mais, e quem depura o disparo
-- persegue um problema que já foi resolvido.
--
-- Achado em 11/ago/2026, junto do vazamento de polo dos lembretes.

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
          -- Voltou para a fila: o resultado da tentativa anterior não vale mais.
          error = null,
          sent_at = null
      where surgery_reminders.status in ('pendente', 'cancelado')
        and surgery_reminders.scheduled_for is distinct from excluded.scheduled_for;

    -- Remarcou para mais perto: o que sobrou depois da cirurgia sai da fila.
    -- Antes do aviso de exames de propósito: remarcação puxando a data para perto
    -- é exatamente o caso em que o D-30 velho precisa virar aviso de hoje.
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
        where surgery_reminders.status <> 'enviado';
    end if;
  end if;

  if new.status = 'cancelada' then
    update public.surgery_reminders set status = 'cancelado'
    where sale_id = new.id and status = 'pendente';
  end if;

  return new;
end $function$;

-- Limpa o que já está mentindo: linha 'pendente' não tem resultado de envio para exibir.
update public.surgery_reminders
set error = null, sent_at = null
where status = 'pendente' and (error is not null or sent_at is not null);
