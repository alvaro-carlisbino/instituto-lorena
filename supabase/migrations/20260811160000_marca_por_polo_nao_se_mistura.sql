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

-- Clínica. Fica no domínio do CRM (instituto-lorena.vercel.app) por enquanto: é feio, mas
-- é DELA — o requisito é não misturar as marcas, e nenhum link da clínica sai em domínio
-- Tricopill. O subdomínio bonito (pagar.institutolorenavisentainer.com.br) exige apontar
-- um domínio novo para o projeto do CRM na Vercel; quando existir, trocar aqui resolve,
-- sem deploy. Atenção: `institutolorena.com.br` NÃO está registrado (registro.br,
-- 11/ago/26) — o domínio da clínica é institutolorenavisentainer.com.br, de LoviDerm
-- Clínica Médica LTDA.
--
-- Diferente do Tricopill, a clínica NÃO tem site próprio com checkout: o link dela cai na
-- tela /pagar/:id do próprio CRM, que agora carrega a marca da clínica.
--
-- E-mail fica DESLIGADO ('') de propósito: a conta Resend só tem tricopill.com.br
-- verificado, então o único jeito de a clínica mandar e-mail hoje seria assinando como
-- Tricopill — que é exatamente o vazamento que estamos fechando. Quando o domínio da
-- clínica for verificado no Resend, preencher email_from aqui religa o canal, sem deploy.
update tenants
set brand_config = coalesce(brand_config, '{}'::jsonb) || jsonb_build_object(
      'checkout_base_url', 'https://instituto-lorena.vercel.app',
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
