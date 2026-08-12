-- A atendente da clínica abriu a ficha e não viu a compra que a paciente estava reclamando.
--
-- 12/ago: paciente consultou na clínica pelo ManyChat (lead 'instituto-lorena'), comprou no site
-- do Tricopill na mesma tarde (lead 'tricopill', criado do zero pelo checkout) e no dia da entrega
-- perguntou no WhatsApp da CLÍNICA "não veio nota fiscal?" e "as embalagens vieram abertas". A
-- atendente abriu a ficha, não achou pedido, nem rastreio, nem nota — e não tinha como achar: o
-- pedido mora em OUTRO lead, de OUTRO polo, e todas as seções do 360 casam por `lead_id` único.
--
-- Esta função responde uma pergunta só: "o que ESTA pessoa comprou, em qualquer polo?". Ela é
-- SÓ LEITURA e não mexe em tenant_id de nada. Kanban, /leads e financeiro continuam por polo de
-- propósito; o que faltava era a atendente ENXERGAR, não o dinheiro mudar de lado. Por isso cada
-- linha volta etiquetada com o polo dono (tenant_id + polo_nome): sem etiqueta, uma lista que
-- mistura clínica e vendas é o primeiro passo para alguém somar os dois no faturamento.
--
-- COMO A IDENTIDADE É DERIVADA (e por que não dá para simplificar):
--
--   telefone — chave é DDD + últimos 8 dígitos, não o telefone inteiro. O checkout do site grava
--     sem o 55 (44999990000) e o WhatsApp grava com (554499990000); os últimos 8 dígitos aguentam
--     o ±55 e o ±9º dígito de uma vez, que é o mesmo truque de crm_fone_final e de brPhoneVariants.
--     O DDD entra junto porque só os 8 últimos casam 78 pares de leads na base e 3 desses são DDD
--     diferente, ou seja, gente diferente.
--
--   telefone sintético é DESCARTADO. O ManyChat não manda telefone real e o CRM inventa um
--     no lugar (começa com 888001); são 319 leads assim. Os 8 últimos dígitos de um número
--     inventado são tão bons quanto qualquer outro para colidir — sem este corte, 2 pares de
--     pacientes sem relação nenhuma passariam a ver a compra um do outro. É exatamente o caso
--     deste incidente: o lead do ManyChat É sintético, e é por isso que nenhuma busca por
--     telefone jamais o alcançaria.
--
--   CPF — só dígitos, e de todos os lugares onde ele foi parar: cadastro do lead, customer_doc dos
--     três gateways e ficha do Shosp. Exige 11 (ou 14) dígitos: pedaço de CPF casa com estranho.
--
--   e-mail — e este não é enfeite: no incidente o lead do ManyChat não tinha telefone utilizável
--     nem CPF, e o e-mail foi a ÚNICA ponte entre a paciente da clínica e a compradora do site.
--     Uma versão "só telefone e CPF" desta função não teria resolvido o caso que a motivou.
--
-- Um salto só: as chaves saem do lead que a atendente tem aberto. Não expande em cadeia (chave do
-- irmão vira chave nova), porque telefone repetido existe — há na base um par de leads com o mesmo
-- número e nomes de pessoas diferentes — e propagar isso funde prontuário de quem não é a mesma
-- pessoa. Casar demais aqui é pior do que casar de menos: no limite mostra a compra do vizinho.
--
-- E o CPF DESMENTE o telefone e o e-mail. Telefone e e-mail são chaves fracas: linha de casal,
-- número reciclado, celular da recepção, e-mail de consultório usado por duas pessoas (na base há
-- um e-mail em dois leads de gente diferente). Quando os DOIS lados têm CPF gravado e os CPFs são
-- diferentes, não é a mesma pessoa — e aí o casamento por telefone/e-mail é descartado, tanto no
-- lead irmão quanto no pagamento avulso. Sem isso a ficha de uma pessoa exibe a compra paga de
-- outra, com valor, itens e rastreio, e a atendente responde sobre um pedido que não é do cliente
-- dela. CPF ausente não desmente nada: quem não tem CPF gravado continua casando pela chave fraca,
-- e por isso a tela também mostra o NOME do comprador quando ele difere do nome da ficha.
--
-- SEGURANÇA. Esta função é cross-tenant DE PROPÓSITO, então a RLS de rede_payments (que é
-- `tenant_id = current_tenant_id()`, sem escape) não filtra nada aqui — o SECURITY DEFINER passa
-- por cima dela. Isso quer dizer que as travas ABAIXO são as únicas que existem:
--
--   1) is_staff_user() no corpo, e ela LEVANTA EXCEÇÃO em vez de devolver vazio. Vazio aqui tem
--      significado — "esta pessoa não comprou em outro polo" — e uma falha de permissão não pode
--      ser indistinguível de uma resposta legítima. Sem sessão, auth.uid() é null e is_staff_user()
--      devolve false (não null), então anon bate na trava.
--   2) revoke de public/anon no fim do arquivo. A chave anon vai no bundle do site e é pública por
--      definição; RPC SECURITY DEFINER nasce executável por PUBLIC. Foi assim que
--      crm_buscar_pacientes vazou nome + CPF de paciente (ver 20260811012038). Esta aqui devolve
--      CPF, telefone, endereço de entrega e valor de compra — seria um vazamento pior.
--   3) o escopo é crm_meus_tenants(), o mesmo conjunto do seletor de workspace, e não "todo tenant".
--      Não é restrição de fachada: hoje 4 dos 5 usuários são membros dos dois polos e enxergam o
--      caso inteiro, mas o usuário só-Tricopill continua sem ver dado de clínica, e um polo futuro
--      não passa a ser legível de graça. O lead-semente passa pelo mesmo filtro, senão bastaria
--      passar um lead_id de outro polo para usar esta função como oráculo de CPF alheio.

-- Chave de telefone que aguenta os formatos que a casa realmente grava.
--
-- crm_fone_final já corta os 8 últimos dígitos e é o equivalente SQL do brPhoneVariants. Esta
-- aqui é ela com dois cuidados a mais, exigidos pelo incidente:
--   - devolve NULL para telefone sintético do ManyChat (começa com 888), que não identifica
--     ninguém e cujos 8 dígitos finais colidem como os de qualquer outro número;
--   - carrega o DDD junto, tirando o DDI 55 quando ele existe, para que 44999990000 (site, sem 55)
--     e 554499990000 (WhatsApp, com 55) deem a MESMA chave sem que dois números de DDDs
--     diferentes que terminam igual passem por um só.
-- Devolve NULL também para o que não dá para afirmar (menos de 10 dígitos): NULL não casa com
-- NULL em `=`, então lixo simplesmente não encontra par.
create or replace function public.crm_fone_chave(p_fone text)
returns text
language sql
immutable
as $function$
  select case
    when length(z.d) < 10 then null
    when left(z.d, 3) = '888' then null
    else coalesce(case when length(z.n) in (10, 11) then left(z.n, 2) end, '??') || right(z.d, 8)
  end
  from (
    select a.d, case when length(a.d) in (12, 13) and left(a.d, 2) = '55' then substr(a.d, 3) else a.d end as n
    from (select regexp_replace(coalesce(p_fone, ''), '\D', '', 'g') as d) a
  ) z;
$function$;

revoke all on function public.crm_fone_chave(text) from public, anon;
grant execute on function public.crm_fone_chave(text) to authenticated, service_role;

create or replace function public.crm_compras_da_pessoa(p_lead_id text, p_limit integer default 50)
returns table (
  origem text,
  pagamento_id text,
  tenant_id text,
  polo_nome text,
  lead_id text,
  mesmo_lead boolean,
  casou_por text,
  cliente_nome text,
  descricao text,
  kit text,
  itens jsonb,
  valor_centavos integer,
  frete_centavos integer,
  desconto_centavos integer,
  parcelas integer,
  status text,
  metodo text,
  origin text,
  criado_em timestamptz,
  pago_em timestamptz,
  rastreio_codigo text,
  rastreio_servico text,
  rastreio_status text,
  rastreio_atualizado_em text,
  nfe_numero text,
  nfe_status text,
  pedido_bling text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
#variable_conflict use_column
begin
  -- Trava única e explícita: sem RLS por baixo, é isto ou nada. Levanta em vez de devolver vazio
  -- porque vazio aqui é uma resposta de negócio válida.
  if not public.is_staff_user() then
    raise exception 'crm_compras_da_pessoa: restrito a usuário de equipe'
      using errcode = '42501';
  end if;

  return query
  with meus as (
    select t from public.crm_meus_tenants() t
  ),
  -- O lead que a atendente tem aberto. Passa pelo filtro de polo igual a todo o resto: se não é
  -- um polo do usuário, a semente vem vazia e a função inteira devolve zero linha.
  semente as (
    select l.id, l.tenant_id, l.phone, l.custom_fields
    from public.leads l
    where l.id = p_lead_id
      and l.deleted_at is null
      and l.tenant_id in (select t from meus)
  ),
  chave_fone as (
    select distinct k.chave
    from semente s,
    lateral (select public.crm_fone_chave(s.phone) as chave) k
    where k.chave is not null
  ),
  chave_cpf as (
    select distinct c.cpf from (
      select regexp_replace(coalesce(s.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g') as cpf
      from semente s
      union all
      select regexp_replace(coalesce(rp.customer_doc, ''), '\D', '', 'g')
      from public.rede_payments rp, semente s where rp.lead_id = s.id
      union all
      select regexp_replace(coalesce(ap.customer_doc, ''), '\D', '', 'g')
      from public.asaas_payments ap, semente s where ap.lead_id = s.id
      union all
      select regexp_replace(coalesce(pc.customer_doc, ''), '\D', '', 'g')
      from public.pagbank_checkouts pc, semente s where pc.lead_id = s.id
      union all
      select regexp_replace(coalesce(sp.cpf, ''), '\D', '', 'g')
      from public.shosp_patients sp, semente s where sp.lead_id = s.id
    ) c
    where length(c.cpf) in (11, 14)
  ),
  chave_email as (
    select distinct e.email from (
      select lower(trim(coalesce(s.custom_fields->>'email', ''))) as email from semente s
      union all
      select lower(trim(coalesce(s.custom_fields->'cadastro'->>'email', ''))) from semente s
      union all
      select lower(trim(coalesce(sp.email, '')))
      from public.shosp_patients sp, semente s where sp.lead_id = s.id
    ) e
    where position('@' in e.email) > 0 and length(e.email) >= 5
  ),
  -- Os leads que são a MESMA pessoa. `peso` só escolhe qual motivo mostrar quando um lead casa
  -- por mais de uma chave: identificador forte (CPF) vence e-mail, que vence telefone.
  irmaos as (
    select distinct on (z.lid) z.lid, z.motivo from (
      select s.id as lid, 'mesmo lead'::text as motivo, 0 as peso from semente s
      union all
      select l.id, 'CPF', 1
      from public.leads l, chave_cpf k
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g') = k.cpf
      union all
      select l.id, 'CPF', 1
      from public.shosp_patients sp
      join public.leads l
        on l.id = sp.lead_id and l.deleted_at is null and l.tenant_id in (select t from meus)
      , chave_cpf k
      where regexp_replace(coalesce(sp.cpf, ''), '\D', '', 'g') = k.cpf
      union all
      select l.id, 'e-mail', 2
      from public.leads l, chave_email k
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and (lower(trim(coalesce(l.custom_fields->>'email', ''))) = k.email
          or lower(trim(coalesce(l.custom_fields->'cadastro'->>'email', ''))) = k.email)
        -- CPF conhecido dos dois lados e diferente = gente diferente com a chave fraca em comum.
        and (
          not exists (select 1 from chave_cpf)
          or length(regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g')) not in (11, 14)
          or exists (
            select 1 from chave_cpf kc
            where kc.cpf = regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g')
          )
        )
      union all
      select l.id, 'telefone', 3
      from public.leads l, chave_fone k
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and public.crm_fone_chave(l.phone) = k.chave
        -- Mesma trava do e-mail: a chave de telefone é DDD + 8 dígitos e colapsa o 9º dígito.
        and (
          not exists (select 1 from chave_cpf)
          or length(regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g')) not in (11, 14)
          or exists (
            select 1 from chave_cpf kc
            where kc.cpf = regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g')
          )
        )
    ) z
    where z.lid is not null
    order by z.lid, z.peso
  ),
  -- Os três gateways num formato só. asaas_payments não tem itens nem NF-e e pagbank_checkouts
  -- não tem nem método (é sempre PIX): as colunas que não existem vêm nulas em vez de a linha
  -- sumir, senão a compra some da ficha por detalhe de tabela.
  compras as (
    select 'rede_payments'::text as origem, rp.id::text as pagamento_id, rp.tenant_id, rp.lead_id,
           rp.customer_name, rp.description, rp.kit, rp.items, rp.amount_cents, rp.freight_cents,
           rp.discount_cents, rp.installments, rp.status, rp.method, rp.origin,
           rp.created_at, rp.paid_at, rp.customer_doc, rp.phone,
           rp.nfe_numero, rp.nfe_status, rp.bling_order_id
    from public.rede_payments rp
    where rp.tenant_id in (select t from meus)
    union all
    select 'asaas_payments', ap.id::text, ap.tenant_id, ap.lead_id,
           ap.customer_name, ap.description, ap.kit, null::jsonb, ap.amount_cents, ap.freight_cents,
           ap.discount_cents, ap.installments, ap.status, ap.method, ap.origin,
           ap.created_at, ap.paid_at, ap.customer_doc, ap.phone,
           null::text, null::text, ap.bling_order_id
    from public.asaas_payments ap
    where ap.tenant_id in (select t from meus)
    union all
    select 'pagbank_checkouts', pc.checkout_id::text, pc.tenant_id, pc.lead_id,
           pc.customer_name, null::text, pc.kit, null::jsonb, pc.amount_cents, null::integer,
           pc.discount_cents, null::integer, pc.status, 'pix'::text, null::text,
           pc.created_at, pc.paid_at, pc.customer_doc, pc.phone,
           null::text, null::text, pc.bling_order_id
    from public.pagbank_checkouts pc
    where pc.tenant_id in (select t from meus)
  ),
  -- `ordem_no_lead` = 1 é a compra mais recente daquele lead. Serve só para o rastreio (ver o
  -- comentário no select): uma passada de janela, em vez de um exists por linha devolvida.
  compras_ord as (
    select cc.*,
           row_number() over (
             partition by cc.lead_id
             order by coalesce(cc.paid_at, cc.created_at) desc nulls last, cc.pagamento_id desc
           ) as ordem_no_lead
    from compras cc
  )
  select c.origem,
         c.pagamento_id,
         c.tenant_id,
         (select tn.name from public.tenants tn where tn.id = c.tenant_id) as polo_nome,
         c.lead_id,
         (c.lead_id is not distinct from p_lead_id) as mesmo_lead,
         z.casou_por,
         c.customer_name,
         c.description,
         c.kit,
         c.items,
         c.amount_cents,
         c.freight_cents,
         c.discount_cents,
         c.installments,
         c.status,
         c.method,
         c.origin,
         c.created_at,
         c.paid_at,
         -- Rastreio sai do lead DONO do pedido, não do lead que a atendente abriu: são leads
         -- diferentes por definição aqui, e ler a entrega do lead errado mostra o endereço de
         -- outra compra.
         --
         -- E `custom_fields->'entrega'` é UM objeto por lead, sobrescrito a cada envio: ele
         -- descreve a ÚLTIMA remessa, não "a remessa deste pedido". Carimbado em todas as compras
         -- do mesmo lead, o pedido de junho apareceria com o código de agosto e a atendente
         -- mandaria o cliente rastrear a encomenda errada. Por isso só a compra mais recente do
         -- lead leva rastreio; nas anteriores vem vazio, que é a verdade disponível — o CRM não
         -- guarda rastreio por pedido.
         nullif(case when c.ordem_no_lead = 1 then dono.custom_fields->'entrega'->>'tracking' end, ''),
         nullif(case when c.ordem_no_lead = 1 then dono.custom_fields->'entrega'->>'service' end, ''),
         nullif(case when c.ordem_no_lead = 1 then dono.custom_fields->'entrega'->>'status' end, ''),
         nullif(case when c.ordem_no_lead = 1 then dono.custom_fields->'entrega'->>'tracking_updated_at' end, ''),
         c.nfe_numero,
         -- nfe_status volta cru, junto do número, porque NULL aqui é "não sabemos", não "saiu
         -- nota". A base tem 226 rascunhos COM número e nenhuma nota autorizada; mostrar só o
         -- número faz a atendente responder "a nota saiu" para pedido que a SEFAZ nunca viu.
         c.nfe_status,
         c.bling_order_id
  from compras_ord c
  join lateral (
    -- Um motivo por compra, o mais forte. Casar pelo lead irmão é o caminho normal; CPF e
    -- telefone no próprio pagamento cobrem o pedido cujo lead_id é nulo ou sintético ('site-…').
    select w.casou_por from (
      select 'lead'::text as casou_por, 0 as peso
      where exists (select 1 from irmaos i where i.lid = c.lead_id)
      union all
      select 'CPF do pagamento', 1
      where exists (
        select 1 from chave_cpf k
        where regexp_replace(coalesce(c.customer_doc, ''), '\D', '', 'g') = k.cpf
      )
      union all
      select 'telefone do pagamento', 2
      where exists (
        select 1 from chave_fone k where public.crm_fone_chave(c.phone) = k.chave
      )
      -- O pagamento carrega o CPF de quem pagou. Se ele existe e não é nenhum dos CPFs da pessoa
      -- aberta, o telefone bateu por acaso (linha compartilhada) e a compra não é dela.
      and (
        not exists (select 1 from chave_cpf)
        or length(regexp_replace(coalesce(c.customer_doc, ''), '\D', '', 'g')) not in (11, 14)
        or exists (
          select 1 from chave_cpf kc
          where kc.cpf = regexp_replace(coalesce(c.customer_doc, ''), '\D', '', 'g')
        )
      )
    ) w
    order by w.peso
    limit 1
  ) z on true
  -- O polo do pagamento e o do lead dono nem sempre são o mesmo (há pagamento de produto pendurado
  -- em lead da clínica). Sem este filtro, quem é membro de um polo só leria o endereço de entrega
  -- de um lead do outro pela porta dos fundos.
  left join public.leads dono
    on dono.id = c.lead_id and dono.tenant_id in (select t from meus)
  order by coalesce(c.paid_at, c.created_at) desc nulls last, c.pagamento_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

comment on function public.crm_compras_da_pessoa(text, integer) is
  'Compras da mesma pessoa em qualquer polo do usuário, a partir de um lead. Só leitura; etiqueta o polo dono de cada compra.';

revoke all on function public.crm_compras_da_pessoa(text, integer) from public, anon;
grant execute on function public.crm_compras_da_pessoa(text, integer) to authenticated, service_role;
