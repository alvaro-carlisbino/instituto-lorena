-- Banco automático: 3 rodadas por dia viraram uma por hora.
--
-- Com o sync consertado (pede a atualização ANTES de ler, ver
-- 20260810193000_banco_saldo_fresco_e_fatura.sql), a idade do saldo na tela passou a ser
-- exatamente o intervalo entre rodadas. Em 3x/dia isso é até 7h de atraso — o dono abre a
-- tela de manhã e vê o saldo de ontem à noite, com a pastilha vermelha dizendo que é velho.
-- Honesto, mas ainda inútil.
--
-- Uma por hora é o teto útil: o provedor limita /connections/sync a 1x/hora por conexão,
-- então pedir mais que isso não traz dado novo, só gasta chamada. Rodada recusada pelo teto
-- não é erro: a edge lê o que há e o carimbo do provedor continua contando a verdade.
--
-- Alteramos o job em vez de recriar de propósito: o x-cron-secret está embutido no command
-- e recriar exigiria repetir o secret aqui dentro do repositório.
do $$
declare
  j record;
begin
  select jobid into j from cron.job where jobname = 'crm-banco-mcp-sync-job';
  if found then
    -- :07 para não cair junto com os jobs de hora cheia.
    perform cron.alter_job(job_id := j.jobid, schedule := '7 * * * *');
  end if;
end$$;
