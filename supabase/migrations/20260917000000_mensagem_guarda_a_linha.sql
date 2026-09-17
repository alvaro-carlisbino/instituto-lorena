-- A MENSAGEM guarda por qual linha passou (16/set/2026).
--
-- Com o WhatsApp da Aline Muniz ao lado da SDR, a mesma pessoa conversa pelos dois números e o
-- /chat mostrava tudo num fio só: o "teste" que saiu pela SDR às 15:48 logo acima do "teste" que
-- chegou no número da Muniz às 21:05. "Tá misturando mensagem, não pode."
--
-- Até aqui a linha só existia no LEAD (`leads.whatsapp_instance_id`, a última por onde a pessoa
-- falou), e `interactions` não dizia por onde cada mensagem passou. Com uma linha por polo isso
-- bastava; com duas, é impossível separar a conversa depois do fato.
--
-- Regra de leitura (front): `whatsapp_instance_id` nulo = linha PADRÃO do polo da mensagem
-- (primeira ativa por `sort_order`). É o que vale para todo o histórico anterior a hoje, quando a
-- clínica tinha uma linha só. Nota de sistema (`channel = 'system'`: etapa movida, Shosp, troca de
-- linha) é do LEAD e aparece no fio de todas as linhas, por isso não recebe carimbo.

alter table public.interactions
  add column if not exists whatsapp_instance_id text;

comment on column public.interactions.whatsapp_instance_id is
  'Linha de WhatsApp por onde a mensagem passou. Nulo = linha padrão do polo (histórico de uma linha só). Ver 20260917000000.';

-- Carimbo na ENTRADA, mesma filosofia do `_stamp_tenant_id_from_lead`: consertar no trigger em vez
-- dos ~65 pontos que inserem interação. Quem sabe a linha (webhook, crm-send-message, resposta da
-- IA) passa explícito; quem não passa herda a linha em que o lead está amarrado NESTE instante. O
-- webhook reamarra o lead antes de gravar a entrada, e o envio sai pela linha amarrada, então o
-- palpite coincide com a verdade nos caminhos comuns.
create or replace function public._stamp_linha_da_mensagem()
returns trigger
language plpgsql
as $$
begin
  if new.whatsapp_instance_id is null
     and new.lead_id is not null
     and new.channel = 'whatsapp' then
    select l.whatsapp_instance_id into new.whatsapp_instance_id
    from public.leads l
    where l.id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists interactions_stamp_linha on public.interactions;
create trigger interactions_stamp_linha
  before insert on public.interactions
  for each row execute function public._stamp_linha_da_mensagem();

notify pgrst, 'reload schema';
