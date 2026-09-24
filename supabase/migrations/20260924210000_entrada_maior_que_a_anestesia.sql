-- Entrada maior que a anestesia: o que sobra é da clínica, não some do valor.
--
-- Pedido do Álvaro em 24/set, com print da venda do Thiago Henrique Fernandes: total
-- R$ 30.600, entrada R$ 10.000 paga à clínica, repasse R$ 3.700 e anestesia R$ 2.500. A tela
-- dizia "para a clínica ficam R$ 20.600" e lucro R$ 16.900; o certo é R$ 24.400. "Sempre
-- acontece do paciente pagar um valor maior de entrada."
--
-- A regra de 22/09 (20260922210000) partia de que a entrada É o pagamento do anestesista: o
-- paciente dava R$ 2.500, a anestesia custava R$ 2.500, e tirar a entrada inteira do valor era
-- o mesmo que tirar a anestesia. Quando a entrada passa da anestesia, a sobra é pagamento da
-- cirurgia e continuava saindo do valor, do lucro e do faturamento do mês.
--
-- A regra agora: a entrada paga o anestesista ATÉ o valor da anestesia.
--
--     parte da entrada que é do anestesista = menor entre a entrada e a anestesia
--     valor da clínica  (value_cents)        = total - essa parte
--     anestesia gravada (cost_anesthesia)    = anestesia - essa parte   (o que a clínica ainda paga)
--     lucro                                  = total - anestesia - médico - demais custos
--
-- Com entrada igual à anestesia, que é o caso de sempre, nada muda. Não depende de
-- `deposit_payee`, como a regra de 22/09: se a entrada foi direto para o anestesista e passou da
-- anestesia, a sobra é um acerto a receber dele, não custo da cirurgia.
--
-- Os 13% do médico continuam sobre `value_cents`, que agora é o total menos a anestesia paga
-- pela entrada (antes: menos a entrada inteira). Para entrada igual à anestesia, igual a antes.
--
-- Por que gravar o total: com a entrada maior que a anestesia, valor + entrada deixa de ser o
-- total, e a lista da Central não teria como mostrar o que o paciente paga. Venda antiga fica com
-- `total_cents` nulo e segue a conta antiga (total = valor + entrada): elas vieram da planilha,
-- onde não dá para saber se o valor digitado já tinha a entrada dentro.
--
-- A conta mora no gatilho, e não só no formulário: a anestesia da política vem de uma prévia
-- assíncrona, e salvar antes de ela voltar gravaria o valor com a entrada inteira descontada.

-- ---------------------------------------------------------------------------
-- 1. O total
-- ---------------------------------------------------------------------------
alter table public.clinic_sales add column if not exists total_cents bigint
  check (total_cents is null or total_cents >= 0);

comment on column public.clinic_sales.total_cents is
  'Transplante: o que o paciente paga, com a entrada dentro. Gravado pelo formulário desde 24/09/2026; nulo nas vendas anteriores, em que o total é value_cents + deposit_cents. value_cents = total - a parte da entrada que pagou a anestesia.';

-- ---------------------------------------------------------------------------
-- 2. A parte da entrada que pagou o anestesista
-- ---------------------------------------------------------------------------
-- Sem anestesia conhecida (procedimento que a política não reconhece), vale a regra antiga: a
-- entrada inteira. Hoje nenhuma cirurgia cai aqui, mas "não sei a anestesia" não pode virar
-- "a entrada inteira é da clínica".
create or replace function public.clinic_entrada_da_anestesia(p_entrada bigint, p_anestesia bigint)
returns bigint
language sql
immutable
as $$
  select case
           when p_anestesia is null then greatest(0, coalesce(p_entrada, 0))
           else least(greatest(0, coalesce(p_entrada, 0)), greatest(0, p_anestesia))
         end
$$;

-- Conta pura, mas o padrão da casa é função nova sem EXECUTE para anon (herda de PUBLIC).
revoke all on function public.clinic_entrada_da_anestesia(bigint, bigint) from public, anon;
grant execute on function public.clinic_entrada_da_anestesia(bigint, bigint) to authenticated, service_role;

comment on function public.clinic_entrada_da_anestesia(bigint, bigint) is
  'Quanto da entrada do transplante pagou o anestesista: a entrada até o valor da anestesia. O resto da entrada é pagamento da cirurgia.';

-- ---------------------------------------------------------------------------
-- 3. O gatilho
-- ---------------------------------------------------------------------------
-- Igual ao de 20260922210000 com duas mudanças: com `total_cents` o valor sai do total, e o
-- repasse do médico passa a ser calculado DEPOIS, porque os 13% são sobre esse valor.
--
-- Anestesia digitada à mão: o formulário já manda valor e anestesia descontados (ele sabe o
-- número digitado, o gatilho não), e aqui nada é recalculado.
create or replace function public.clinic_sales_repasse_pela_regra()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_politica bigint;
begin
  if new.kind = 'cirurgia' then
    if not new.cost_anesthesia_manual then
      v_politica := (select a.total_cents
                       from public.clinic_anestesia_cirurgia(
                         new.tenant_id, new.procedure_label, new.sem_raspagem,
                         public._clinic_sale_uf(new.tenant_id, new.srg_surgery_id, new.follicular_units)) a);
      -- A entrada abate o repasse da anestesia: ver o cabeçalho de 20260922210000.
      new.cost_anesthesia_cents := public.clinic_anestesia_da_clinica(v_politica, new.deposit_cents);
      if new.total_cents is not null then
        new.value_cents := greatest(0, new.total_cents
                                       - public.clinic_entrada_da_anestesia(new.deposit_cents, v_politica));
      end if;
    end if;
    if not new.cost_doctor_manual then
      new.cost_doctor_cents := coalesce(
        (select r.total_cents
           from public.clinic_repasse_cirurgia(new.tenant_id, new.attending_doctor, new.performing_doctor, new.value_cents) r),
        0);
    end if;
  else
    if not new.cost_doctor_manual then
      new.cost_doctor_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'medico', new.kind, new.performing_doctor, new.value_cents), 0);
    end if;
    -- Protocolo não tem entrada de anestesista: a regra por pessoa continua inteira.
    if not new.cost_anesthesia_manual then
      new.cost_anesthesia_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'anestesia', new.kind, new.anesthetist, new.value_cents), 0);
    end if;
  end if;
  return new;
end
$function$;

-- Mudar a política de anestesia muda o valor das vendas com total gravado, mesmo quando a
-- anestesia gravada continua zero (entrada maior que a anestesia antiga e a nova). Sem a
-- terceira condição, essas vendas ficariam com o valor da política velha.
create or replace function public._clinic_repasse_reaplicar_cirurgias(p_tenant text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  update public.clinic_sales s
     set updated_at = s.updated_at
   where s.tenant_id = p_tenant
     and s.kind = 'cirurgia'
     and s.status <> 'cancelada'
     and (
       (not s.cost_doctor_manual and s.cost_doctor_cents is distinct from coalesce(
          (select r.total_cents
             from public.clinic_repasse_cirurgia(s.tenant_id, s.attending_doctor, s.performing_doctor, s.value_cents) r), 0))
       or
       (not s.cost_anesthesia_manual and s.cost_anesthesia_cents is distinct from public.clinic_anestesia_da_clinica(
          (select a.total_cents
             from public.clinic_anestesia_cirurgia(s.tenant_id, s.procedure_label, s.sem_raspagem,
                    public._clinic_sale_uf(s.tenant_id, s.srg_surgery_id, s.follicular_units)) a),
          s.deposit_cents))
       or
       (not s.cost_anesthesia_manual and s.total_cents is not null and s.value_cents is distinct from greatest(0,
          s.total_cents - public.clinic_entrada_da_anestesia(s.deposit_cents,
            (select a.total_cents
               from public.clinic_anestesia_cirurgia(s.tenant_id, s.procedure_label, s.sem_raspagem,
                      public._clinic_sale_uf(s.tenant_id, s.srg_surgery_id, s.follicular_units)) a))))
     );
  get diagnostics n = row_count;
  return n;
end
$function$;

-- ---------------------------------------------------------------------------
-- 4. A venda do print
-- ---------------------------------------------------------------------------
-- Thiago Henrique Fernandes, 24/09: total R$ 30.600, entrada R$ 10.000 (clínica), anestesia
-- digitada R$ 2.500. Com a anestesia à mão, o gatilho não mexe no valor: fica gravado aqui.
-- valor = 30.600 - 2.500 = 28.100; anestesia gravada = 2.500 - 2.500 = 0; o repasse (R$ 3.200
-- fixo + R$ 500 de indicação) o gatilho recalcula sobre o valor novo e não muda.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.clinic_sales
     set total_cents = 3060000,
         value_cents = 2810000,
         cost_anesthesia_cents = 0
   where id = '4fdd97ea-59f5-4f18-b31e-2df7d79bd83b'
     and tenant_id = 'instituto-lorena'
     and value_cents = 2060000
     and deposit_cents = 1000000
     and cost_anesthesia_manual;
end
$$;
