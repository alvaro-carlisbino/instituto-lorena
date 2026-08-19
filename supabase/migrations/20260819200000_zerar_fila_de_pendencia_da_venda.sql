-- ─────────────────────────────────────────────────────────────────────────────
-- Zerar a fila de pendência da venda: "sem data" e "sem paciente"
--
-- As duas filas da Central de Vendas atravessam o mês de propósito: venda que
-- fechou em janeiro e nunca ganhou data continua cobrando hoje. O efeito colateral
-- é que elas nasceram cheias do que veio da planilha — em 19/08/2026 eram 9 sem
-- data e 71 sem paciente, sendo 64 destas de cirurgia JÁ REALIZADA, onde vincular
-- cadastro não muda mais nada: não há card para andar nem lembrete para sair.
--
-- Fila que nasce com 71 itens velhos não é fila, é papel de parede: ninguém abre.
-- A Aline pediu para zerar e "começar a partir de agora".
--
-- Zerar aqui NÃO apaga venda nem esvazia campo. A venda continua inteira, com
-- valor, data de fechamento, status e histórico — ela só sai da fila de cobrança,
-- e fica registrado quem dispensou e quando. Quem entrar sem data ou sem paciente
-- a partir de agora aparece normalmente, porque a dispensa é por linha e não uma
-- data de corte que engole o futuro junto.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clinic_sales
  add column if not exists no_date_dismissed_at    timestamptz,
  add column if not exists no_date_dismissed_by    uuid,
  add column if not exists no_patient_dismissed_at timestamptz,
  add column if not exists no_patient_dismissed_by uuid;

comment on column public.clinic_sales.no_date_dismissed_at is
  'Quando a venda foi dispensada da fila "sem data". Null = a fila ainda cobra. Não mexe em scheduled_at: a venda segue sem data marcada.';
comment on column public.clinic_sales.no_patient_dismissed_at is
  'Quando a venda foi dispensada da fila "sem paciente". Null = a fila ainda cobra. Não mexe em lead_id: a venda segue sem cadastro vinculado.';

-- A dispensa vale para a pendência que existe hoje. Quando a pendência se resolve,
-- o carimbo cai — assim, se alguém tirar a data depois (remarcação que volta para
-- "a definir"), a venda reaparece na fila em vez de ficar dispensada para sempre
-- por uma decisão tomada meses antes, sobre outra situação.
create or replace function public.clinic_sales_reabre_pendencia()
returns trigger language plpgsql as $$
begin
  if new.scheduled_at is not null and old.scheduled_at is null then
    new.no_date_dismissed_at := null;
    new.no_date_dismissed_by := null;
  end if;
  if new.lead_id is not null and old.lead_id is null then
    new.no_patient_dismissed_at := null;
    new.no_patient_dismissed_by := null;
  end if;
  return new;
end $$;

drop trigger if exists clinic_sales_reabre_pendencia on public.clinic_sales;
create trigger clinic_sales_reabre_pendencia before update on public.clinic_sales
  for each row execute function public.clinic_sales_reabre_pendencia();

-- Sem policy nova: a dispensa é UPDATE em clinic_sales e cai na policy de tenant
-- que já existe ("clinic_sales tenant update"). Coluna nova em tabela com RLS
-- ligada não abre porta nenhuma.
