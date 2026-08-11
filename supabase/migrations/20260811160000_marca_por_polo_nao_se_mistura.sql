-- Separação total das duas marcas no que o CLIENTE vê.
--
-- O link de pagamento vinha de uma constante global (APP_BASE_URL, default
-- https://instituto-lorena.vercel.app) e do window.location.origin do operador. As 174
-- cobranças do Tricopill saíram no domínio da clínica, com "Instituto Lorena CRM · INTERNO"
-- no título da aba. O inverso vazava no e-mail: o remetente padrão era Tricopill para
-- os dois polos.
--
-- A partir daqui cada polo carrega o próprio domínio, site e remetente em
-- tenants.brand_config, e o código NÃO tem fallback de um polo para o outro.
--
-- `||` mescla: preserva app_name/logo_url/accent_color/primary_color/support_* já gravados.
--
-- ORDEM DE APLICAÇÃO (importante): rode esta migration DEPOIS que pagar.tricopill.com.br e
-- pagar.institutolorenavisentainer.com.br já estiverem respondendo (domínio adicionado no
-- projeto da Vercel + CNAME no DNS). Aplicar antes faz todo link novo apontar para um
-- domínio que não resolve, e aí a venda morre no clique.

update tenants
set brand_config = coalesce(brand_config, '{}'::jsonb) || jsonb_build_object(
      'checkout_base_url', 'https://pagar.tricopill.com.br',
      'site_url',          'https://tricopill.com.br',
      'email_from',        'Tricopill <contato@tricopill.com.br>'
    ),
    updated_at = now()
where id = 'tricopill';

-- Clínica. O domínio é institutolorenaVISENTAINER.com.br: `institutolorena.com.br` NÃO está
-- registrado (consulta no registro.br em 11/ago/26), então apontar para ele deixaria o
-- paciente num link morto. O registrado é institutolorenavisentainer.com.br, de LoviDerm
-- Clínica Médica LTDA, e é ele que serve o app da enfermagem hoje.
--
-- E-mail fica DESLIGADO ('') de propósito: a conta Resend só tem tricopill.com.br
-- verificado, então o único jeito de a clínica mandar e-mail hoje seria assinando como
-- Tricopill — que é exatamente o vazamento que estamos fechando. Quando o domínio da
-- clínica for verificado no Resend, preencher email_from aqui religa o canal, sem deploy.
update tenants
set brand_config = coalesce(brand_config, '{}'::jsonb) || jsonb_build_object(
      'checkout_base_url', 'https://pagar.institutolorenavisentainer.com.br',
      'site_url',          'https://institutolorenavisentainer.com.br',
      'email_from',        ''
    ),
    updated_at = now()
where id = 'instituto-lorena';

-- Trava: polo ativo sem domínio de cobrança é erro de configuração, não "detalhe".
-- Sem isso, um tenant novo nasce mudo e a primeira venda dele sai no domínio errado.
do $$
declare faltando text;
begin
  select string_agg(id, ', ')
    into faltando
  from tenants
  where active
    and coalesce(nullif(trim(brand_config ->> 'checkout_base_url'), ''), '') = '';
  if faltando is not null then
    raise exception 'tenants ativos sem brand_config.checkout_base_url: %', faltando;
  end if;
end $$;
