-- Busca ⌘K com escopo de polo, para o CRM de endereço único.
--
-- `crm_buscar_pacientes` varre TODOS os polos de que a pessoa é membro
-- (`crm_meus_tenants`), o que era certo enquanto um login servia os dois negócios pelo
-- seletor de workspace. Com um endereço por polo, o CRM da clínica não pode achar cliente
-- do Tricopill nem na busca: seria a mistura entrando pela porta dos fundos.
--
-- Envelope em vez de reescrita: a função original tem 9,7 mil caracteres e redigitá-la
-- numa migração é como se perde um `revoke` ou um filtro de tenant sem ninguém ver.
create or replace function public.crm_buscar_pacientes_no_polo(
  p_termo text,
  p_limit integer default 20,
  p_polo text default null
)
returns table (
  tipo text, ref text, lead_id text, nome text, telefone text, prontuario text, cpf text,
  achado_por text, consultas integer, cirurgias integer, exames integer, vendas integer,
  ultimo_contato timestamp with time zone, polo text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Pede folga ao buscador interno: o LIMIT dele corre ANTES deste filtro, então sem a
  -- folga uma busca no polo A poderia voltar vazia só porque os primeiros achados eram
  -- todos do polo B.
  select * from public.crm_buscar_pacientes(p_termo, greatest(coalesce(p_limit, 20), 1) * 4) f
  where p_polo is null or f.polo = p_polo
  limit greatest(coalesce(p_limit, 20), 1);
$$;

-- SECURITY DEFINER nasce executável por PUBLIC, e PUBLIC inclui `anon`: sem isto, gente
-- deslogada busca paciente por nome e CPF. Mesma trava da função que este envelope chama.
revoke all on function public.crm_buscar_pacientes_no_polo(text, integer, text) from public, anon;
grant execute on function public.crm_buscar_pacientes_no_polo(text, integer, text) to authenticated, service_role;
