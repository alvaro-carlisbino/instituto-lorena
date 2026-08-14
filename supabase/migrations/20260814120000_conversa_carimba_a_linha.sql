-- A conversa pertence ao polo da LINHA por onde ela acontece, e a tela de cada polo
-- só mostra a conversa dele.
--
-- O NÓ (14/ago/2026, 5ª vez que a clínica reclama de "mensagem do Tricopill no nosso CRM"):
--
-- 1. Uma pessoa = um lead. `findLeadByPhone` unifica por telefone SEM olhar tenant, de
--    propósito, e `upsertLeadByPhone` só grava `tenant_id` ao CRIAR. Então paciente da
--    clínica que compra Tricopill continua sendo lead da clínica — correto para
--    financeiro e métrica.
-- 2. A conversa de VENDAS, porém, mora dentro desse lead da clínica.
-- 3. O carimbo era ASSIMÉTRICO: a mensagem de ENTRADA vinha com `tenant_id` explícito da
--    linha (tricopill), mas a resposta do bot e os eventos de sistema ("Pix gerado",
--    "Pagamento confirmado") entravam sem tenant e caíam neste trigger, que carimbava com
--    o tenant do LEAD (clínica). Metade da conversa em cada polo.
-- 4. A policy `tenant_isolation` liberava a leitura por "é lead que eu enxergo", então a
--    clínica lia a conversa inteira — inclusive "Quero o kit 3+1" e o Pix de R$ 945,25 no
--    card de um paciente do funil cirúrgico.
--
-- Conserto na origem (o trigger) em vez de nos ~65 pontos que inserem interação: qualquer
-- código que esquecer o tenant já nasce carimbado certo.

-- 1) Carimbo: a LINHA manda; sem linha, vale o cadastro.
create or replace function public._stamp_tenant_id_from_lead()
returns trigger
language plpgsql
as $$
declare
  tid text;
  lead_id_val text;
begin
  if new.tenant_id is null then
    lead_id_val := nullif((hstore(new) -> 'lead_id'), '');
    if lead_id_val is not null then
      -- A conversa segue a linha: quem é dono da linha é dono da mensagem.
      select w.tenant_id into tid
      from public.leads l
      join public.whatsapp_channel_instances w on w.id = l.whatsapp_instance_id
      where l.id = lead_id_val;
      -- Sem linha (ManyChat, Instagram, registro manual) vale o polo do cadastro.
      if tid is null then
        select tenant_id into tid from public.leads where id = lead_id_val;
      end if;
      if tid is not null then
        new.tenant_id := tid;
        return new;
      end if;
    end if;
    tid := public.current_tenant_id();
    if tid is null then tid := 'instituto-lorena'; end if;
    new.tenant_id := tid;
  end if;
  return new;
end;
$$;

-- 2) Histórico: re-carimbar o que aconteceu na linha do outro polo.
--
-- `enforce_role_write()` barra UPDATE em `interactions` para quem não é service_role, e a
-- sessão de migração não é. A claim abaixo é o mesmo caminho que as edge functions usam.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

update public.interactions i
set tenant_id = w.tenant_id
from public.leads l
join public.whatsapp_channel_instances w on w.id = l.whatsapp_instance_id
where l.id = i.lead_id
  and w.tenant_id <> i.tenant_id;

update public.crm_media_items m
set tenant_id = w.tenant_id
from public.leads l
join public.whatsapp_channel_instances w on w.id = l.whatsapp_instance_id
where l.id = m.lead_id
  and w.tenant_id <> m.tenant_id;

select set_config('request.jwt.claims', '', false);

-- 3) Tela: a leitura passa a ser pelo polo da MENSAGEM.
--
-- Aperta só o SELECT, de propósito. A `tenant_isolation` original continua valendo para
-- INSERT/UPDATE/DELETE: se ela também apertasse a escrita, a atendente de um polo
-- respondendo num lead fixado na linha do outro tomaria erro na cara — o trigger acima
-- carimbaria a resposta com o tenant da linha e o WITH CHECK barraria.
drop policy if exists tenant_isolation_read on public.interactions;
create policy tenant_isolation_read on public.interactions
  as restrictive for select
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
  );

drop policy if exists tenant_isolation_read on public.crm_media_items;
create policy tenant_isolation_read on public.crm_media_items
  as restrictive for select
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
  );
