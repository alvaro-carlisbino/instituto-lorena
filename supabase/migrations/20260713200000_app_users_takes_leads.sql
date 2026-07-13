-- Rodízio de donos de lead: nem todo usuário ativo deve RECEBER lead novo.
-- O pool caía em "todos os app_users ativos" (não há ninguém com role sdr) e
-- 42% dos leads de 30 dias foram parar com financeiro@ e Gerencia — contas que
-- ninguém opera (dor relatada pelo Fabricio 13/jul: "maioria nem agenda").
-- A flag é reversível na tabela; o pool em _shared/crm.ts filtra por ela.

alter table app_users add column if not exists takes_leads boolean not null default true;

update app_users set takes_leads = false
where email in ('financeiro@institutolorena.com.br', 'gerencia@lorenavisentainer.com.br');
