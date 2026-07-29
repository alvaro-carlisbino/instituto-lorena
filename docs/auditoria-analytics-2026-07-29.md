# Auditoria de analytics do CRM
Feita em 29/07/2026 contra o banco de producao (fgyfpmnvlkmyxtucbxbu), somente leitura.
94 agentes, 65 problemas confirmados por verificacao adversarial, 16 alarmes falsos
derrubados, 22 indicadores conferidos e corretos.

NAO VERIFICADOS ADVERSARIALMENTE: 3 achados da /loja-analytics (KPIs, funil e card
"Foi p/ WhatsApp") perderam o verificador por erro de conexao. Os numeros vieram de SQL
direta e batem entre si, mas nao passaram pela etapa de refutacao.

CONTEM NOME DE CLIENTE E PACIENTE. Documento interno.

---

# Auditoria de analytics do CRM: consolidado

## 1. A resposta direta

**Não, os analytics não estão corretos:** das 10 superfícies de números auditadas, 9 mostram pelo menos um indicador materialmente errado hoje, e os piores não erram por arredondamento (o BI da loja mostra 35% do faturamento real, a tela de Metas mostra 4 números de demonstração que nunca foram medidos, e 3 cards do painel principal exibem uma foto da agenda de 09/07 como se fosse de hoje, com "0 faltas" em verde).

---

## 2. As 7 causas raiz (consertam ~30 dos achados)

| # | Causa | Evidência | Quantos indicadores atinge |
|---|---|---|---|
| 1 | **Espelho da Shosp congelado há 19 dias** | `max(synced_at)` em `shosp_appointments` = 2026-07-09 16:15 UTC; 0 linhas sincronizadas em 24h e em 7 dias (2.341 linhas na tabela) | 12, em 3 telas |
| 2 | **Teto de 1.000 linhas do PostgREST** | `GET /v1/projects/fgyfpmnvlkmyxtucbxbu/postgrest` devolve `{"max_rows":1000}`. Todo `.limit(5000)` e `.limit(50000)` do código é ficção: o servidor corta em 1.000, sem erro | 11 |
| 3 | **Fuso: UTC usado como "hoje"** | `toISOString().slice(0,10)` no front e `current_date` no banco (`pg_settings.TimeZone = UTC`, source = configuration file). Entre 21h e meia-noite BRT tudo desliza 1 dia | 8 |
| 4 | **Off-by-one de janela** | `startOfDay(now - days*86400000)` faz "7 dias" varrer 8 datas e "30 dias" varrer 31 | 6 |
| 5 | **Filtros faltando na RPC clássica** | `tenant_analytics_summary` não filtra `deleted_at` em nenhum dos 5 blocos, e o bloco do funil ignora `v_since` (o período selecionado) | 6 |
| 6 | **Fallback de mock quando a tabela está vazia** | `src/services/crmSupabase.ts:532` (e :566, :582): `(data ?? []).length ? data : initialMetrics` | 3 (metricas, /tv, dashboard widgets) |
| 7 | **Agrupamento por texto cru** | `prestador` com caixa diferente, `product_id` com prefixo `kit:`, `path` com querystring, `lost_reason` com caixa diferente | 5 |

Detalhe importante sobre a causa 1: o cron **mente**. `shosp_sync_state.last_appointments_sync_at` está carimbado em 28/07 11:00 BR mesmo sem ter escrito uma linha desde 09/07, porque a guarda em `supabase/functions/_shared/shospSync.ts:502` e `:595` é só `if (!shospIsRateLimited())`, sem checar se houve upsert. O commit 23ea321 (hoje, 11:02) corrigiu o cron dizer que estava tudo bem, não a ingestão voltar.

---

## 3. O que está ERRADO (número na tela diferente do número real)

### Nível 1: erro grande, decisão de dinheiro

**1. /loja-analytics inteira mostra entre 13% e 44% do real**
`src/services/lojaTricopillAnalytics.ts:9, 100, 101`. Pede 50.000 linhas, recebe 1.000, e como a ordenação é `ascending: true` o corte descarta os eventos **mais recentes**.

| Card (30 dias) | Tela | Real | Fonte |
|---|---|---|---|
| Sessões | 470 | 2.958 | `count(distinct session_id)` em `storefront_events`, 30d |
| Viu produto | 36 | 391 | idem, `type='view_item'` |
| Add. carrinho | 33 | 88 | idem |
| Compras | 9 | 23 | 24 eventos, 23 payIds distintos |
| Receita | R$ 4.616,52 | R$ 10.453,92 | idem |
| Aba "Tudo" | 335 sessões, R$ 5.381,90 | 3.197 sessões, R$ 15.423,83 | tabela completa |

A tela de "30 dias" para em **10/07** e a de "Tudo" para em **03/07**, sem nenhum aviso. Efeito colateral: "Tudo" (335 sessões) mostra menos que "30 dias" (470), o que denuncia o bug sem explicar. E o /quiz, que está no ar desde 10/07 com 461 sessões, aparece com **zero** na tabela de páginas.

**2. /metricas e /tv exibem 4 números fabricados**
`metric_configs` tem **0 linhas em produção** (contagem global, service role). `src/services/crmSupabase.ts:532` cai em `src/mocks/crmMock.ts:569`.

| Card | Tela (mock) | Real (30 dias, instituto-lorena) |
|---|---|---|
| Conversão geral | 32% | 1,5% (18 de 1.171 leads com consulta) |
| 1ª resposta | 11 min | mediana 66,4 min, p90 987 min |
| Qualificação IA | 67% | 43,5% (509 de 1.171) |
| Leads por dia | 29 | 39,0 (1.171 em 30 dias) |

As 4 barras saem **verdes**. Pior: os mesmos números aparecem no `/tv` (`src/pages/TvDashboardPage.tsx:99`), numa tela sem campo editável que anuncia "atualização automática a cada 15 segundos". E `src/pages/MetricsPage.tsx:76` usa sempre `valor/meta`, sem direção: para minutos, 11 contra meta de 8 vira **138% em verde** quando o certo é 73%. Com o dado real (61,4 min) a tela diria "768% da meta" em verde, quando é 13%.

**3. /bi-vendas: Faturamento Bling no botão "12 meses" perde 58%**
`supabase/functions/_shared/bling.ts:958` (`maxPages = min(20, opts.maxPages ?? 10)` x 100 por página = teto de 1.000 pedidos).
Tela: **R$ 389.158,87 / 1.000 pedidos**. Real: **R$ 927.310,89 / 2.281 pedidos** (23 páginas, GET read-only na API v3 do Bling). Como o Bling ordena decrescente, as 10 páginas cobrem só 03/03/2026 em diante: o botão diz "12 meses" e mostra 5.

**4. /bi-vendas: PIX e Cartão trocados**
`supabase/functions/crm-tricopill-bi/index.ts:177-178` joga `rede_payments` inteiro no balde "cartão" sem olhar a coluna `method` (que nem é pedida no select, linha 156). A e.Rede processa PIX desde 20/06.

| Card (30 dias) | Tela | Real |
|---|---|---|
| Cartão | R$ 34.822,44, 61 pagos, 5,0x médio | R$ 20.252,34, 31 pagos, 8,9x |
| PIX | R$ 5.226,37, 5 pagos | R$ 19.796,47, 35 pagos |

O total (R$ 40.048,81) está certo, só a divisão está invertida. Os rótulos "(Asaas)" também mentem: o Asaas movimentou **R$ 0,00** no período (último pagamento 23/06).

**5. /relatorio-vendas e /tricopill-relatorios ignoram o Asaas**
`src/services/crmSalesReport.ts:125-136` só consulta `rede_payments` e `pagbank_checkouts`. Junho: tela **R$ 13.203,55 / 30 vendas**, real **R$ 17.457,52 / 37**. Três dias aparecem como "Nenhuma venda paga nesse dia" e recusam exportar CSV:

- 17/06: R$ 594,00 (Andre Cecatto, Bling 26126077289)
- 19/06: R$ 2.453,97 em 4 vendas (Alisson, Pedro, Lais, Bruno)
- 21/06: R$ 612,00 (Daniela Salas, Bling 26172932687)
- 23/06 mostra R$ 199,00 quando foram R$ 793,00

Bug irmão no mesmo arquivo (`:50-51`): `isPaid` devolve true sempre que `paid_at` existe, então 2 linhas com `status='failed'` entram como venda (R$ 1,00 em 13/06 e R$ 333,00 em 16/06). O selo "Receita +171% vs. mês ant." em julho deveria ser **+105%** (`src/services/tricopillReports.ts:88`).

**6. Painel principal (/dashboard): 3 cards leem uma agenda morta**
`src/components/dashboard/DashboardKpiSection.tsx:366, 379, 408`. O componente não lê `synced_at` em lugar nenhum (grep confirma que só `AnalyticsV2Panel.tsx:174` e `ResultadosPage.tsx:516` leem).

| Card | Tela | Realidade |
|---|---|---|
| Consultas agendadas (7d) | 162, "0 faltas • 2 desmarcadas" | Foto de 09/07. Semanas maduras comparáveis: 308 e 330 consultas |
| Faltas + desmarques | 1,2%, tendência **-1,6pp em verde** | Taxa da casa em período liquidado: 10,7% (135 perdas em 1.266 consultas, 01/mai a 09/jul) |
| Conversão lead → consulta | 0,0%, tendência "estável" | Indisponível. Com sync vivo marcava 14,1% (14 de 99, 01 a 08/jul) |

Faltas por semana no espelho: 08/06 = 2,5%, 15/06 = 5,0%, 22/06 = 2,7%, 29/06 = 1,9%, 06/07 = 3,9%, 13/07 = 0,0%, 20/07 = 0,0%, 27/07 = 0,0%. O zero é ausência de dado pintada como desempenho, e a tendência verde recompensa a interrupção das más notícias.

**7. /dashboard no seletor "30 dias": teto silencioso**
`src/services/analytics.ts:214`. O fetch precisa de 1.720 linhas (janela atual + anterior) e recebe 1.000, sem `.order()`. Tela: **409 agendadas**. Real: **1.000** (784 "Agendado" + 216 "Confirmado" em 1.056 compromissos). O sub também mente: "7 faltas • 21 desmarcadas" quando o real é 19 e 37. Como não há `ORDER BY` e o sync faz upsert, o número pode mudar entre dois carregamentos sem nada mudar no banco.

### Nível 2: erro que inverte a leitura

**8. "Novos leads" mostra queda quando houve alta**
`DashboardKpiSection.tsx:388` + `windowFor` (:48-53). Tela: **358, tendência -11% em vermelho**. Comparação honesta de 7 contra 7 dias: **307 contra 282, +9%**. O código compara 21-28/07 (358, 8 dias) contra 13-20/07 (402), e o deslocamento engole 13/07 (97 leads) e 14/07 (74), os dois maiores dias do mês.

**9. "Por SDR / Conv." no Resumo clássico: 94,9% que significa "ninguém digitou motivo de perda"**
`src/pages/AnalyticsPage.tsx:247`. A RPC calcula `(total_leads - lost_leads)/total_leads`, sem tocar em nenhum evento de conversão. Só 60 de 1.224 leads (4,9%) têm `lost_reason`. Conversão real dos mesmos donos: **1,7% / 2,3% / 0,5% / 0% / 0%**. O caso extremo: `financeiro@institutolorena.com.br` aparece com 34 leads e **100% de conversão**, sendo que 17 estão deletados e zero têm consulta. Na mesma página, o painel v2 diz 0,5% para a mesma pessoa.

**10. "Funil de conversão" (clássico) ignora o seletor de período**
`AnalyticsPage.tsx:158`. O bloco `stage_counts` da RPC não usa `v_since`: os botões 7/30/90/365 não movem uma barra (confirmado chamando a RPC com os 4 valores). E não filtra `deleted_at`.

| Etapa | Tela | Correto em 30 dias |
|---|---|---|
| Novo lead | 72 (67 deletados) | 5 |
| Consulta agendada | 167 | 66 |
| Consulta Realizada | 67 | 10 |
| Encerrado | 526 | 120 |

O painel v2, poucos centímetros acima na mesma página, mostra 5 / 66 / 10.

**11. "Parados há mais de 3 dias" lista gente apagada e é estruturalmente incapaz de alertar**
`AnalyticsPage.tsx:205`. Dos 10 nomes, 5 estão deletados (Bruna, Marco, Zilma, Comercial, Vitoria) e 3 estão em "Encerrado" com motivo de perda. Todos mostram "63d" porque **191 leads compartilham o mesmo `stage_entered_at` = 2026-05-26 14:02:00.261532+00**, carimbo do `ALTER TABLE` da migration `20260526200000_sprint1_analytics_lost_reason.sql:33`. Como esse é o valor mais antigo do tenant (0 leads anteriores), o `order by asc limit 10` fica preso nesse bloco para sempre: um lead que travar hoje **nunca** aparece. Universo real acionável: 1.522 leads.

**12. "Total no período / Ativos / Perdidos" conta lead apagado**
`AnalyticsPage.tsx:140`. Tela (30d): **1.224 / 1.164 / 60**. Real: **1.171 / 1.116 / 55**. 7 dias: 317 vs 307. 90 dias: 1.968 vs 1.826. São 53 leads soft-deletados (142 em 90 dias) que o CRM esconde em todas as outras telas. O painel v2 acima mostra 1.171 na mesma página, e o card "Excluídos das métricas" marca 0, o que faz o dono acreditar que o total está limpo.

**13. "(sem SDR)" com 382 leads é a Ingrid**
`AnalyticsPage.tsx:244`. A RPC faz `left join app_users u on u.id = l.owner_id AND u.tenant_id = v_tenant`, e o cadastro da Ingrid está com `tenant_id='tricopill'`. Existem **zero** leads sem dono no período (`count(*) filter (where owner_id is null)` = 0 em 1.224). O painel v2 mostra "Ingrid" corretamente na mesma tela.

**14. /resultados: bot contado como equipe**
`supabase/migrations/20260728220000_crm_funil_comercial.sql:65`. O filtro é `i.author <> 'Assistente IA'`, mas existem também `Sofia (IA)` (template de 1º contato do Lead Ads) e `Assistente IA (follow-up)`.

| Indicador | Tela | Correto |
|---|---|---|
| Equipe: leads respondidos | 411 | 394 |
| Equipe: mediana | 61,4 min | 66,4 min |
| Faixa "Até 5 min" | 51 | 37 |
| Faixa "Sem resposta humana" | 760 | 777 |
| Assistente de IA | 509 | 523 |

**15. /resultados: "Por atendente" mede o tempo de outra pessoa**
Mesma migration, `:142`. A tabela agrupa por `owner_id` (rodízio automático: 397/381/372), mas a coluna "1ª resposta (mediana)" vem de quem realmente respondeu. Dos 129 leads creditados à Ingrid, **105 foram respondidos pela Gerencia, 20 pelo Atendimento, 4 por bot, e 0 por ela**. A Gerencia, que escreveu 344 das 411 primeiras respostas (84%), aparece na tabela com **4 leads**. Os atendentes reais são 2, não 5: gerencia@ (344 leads, 63,1 min) e atendimento@ (50 leads, 88,7 min).

**16. Painel Shosp: 12 médicos onde existem 7**
`src/components/analytics/ShospAgendaMetricsPanel.tsx:87`. A RPC faz `group by prestador` (texto), e a Shosp grava o mesmo profissional em duas grafias com o **mesmo `codigo_prestador`**. Na carga por médico a Lorena aparece com 51 (real 63) e cai para 3º lugar atrás da Rafaely 52 (real 56), quando na verdade é a 2ª mais carregada.

**17. Painel Shosp: taxa de cancelamento 0,4% quando a casa cancela 3,5% a 7,3%**
A RPC olha a janela **futura** (`data >= current_date`), onde consulta ainda não aconteceu quase nunca está cancelada. Últimos 30 dias passados: 37 desmarcados em 1.056 (3,5%), 5,3% somando as 19 faltas. Coorte com sync vivo até a data: **7,3%**. E o filtro nem inclui `Faltou` (50 registros na base, o mais recente 09/07), então no-show não existe em nenhum card desse painel.

**18. Painel Shosp: `current_date` em UTC come o dia de hoje**
7d: 98 na tela, 102 real. 30d: **267 na tela, 288 real** (somem as 21 consultas de hoje). Cancelados: 1 na tela, 2 real (o desmarcado de hoje 10:45 na agenda da própria Lorena). Acontece todo dia entre 21h e meia-noite BRT.

**19. /resultados: "Por que perdemos" com LIMIT sem ORDER BY**
Migration `:188`: `... group by lost_reason limit 10` e o `order by` só no `jsonb_agg` externo. Em 90 dias a tela mostra **10 motivos / 81 leads**; o real é **16 motivos / 145 leads**. Some o 2º, o 3º e o 4º maiores: Apenas curiosidade (25), Distância/localização (20, rachado em duas linhas por caixa alta) e Sem interesse (16). Ficam na tela 4 motivos de 1 lead cada.

**20. /bi-vendas: fechamento do Bling puxa o dia seguinte**
`crm-tricopill-bi/index.ts:91`. Junho: tela **R$ 82.407,58 / 202 pedidos**, real **R$ 78.108,58 / 193**. Os 9 extras (R$ 4.299,00, pedidos 3261 a 3269) são de 01/07 e vão contar de novo em julho. Maio infla R$ 2.320,10, abril R$ 1.006,94.

**21. /bi-vendas: "Recebido (checkout)" conta a mesma venda duas e três vezes**
`crm-tricopill-bi/index.ts:216`. Não há dedup. Junho: tela **R$ 18.402,52 / 39**, real **R$ 17.124,52 / 36**. Botão "90 dias": R$ 54.136,03 / 97 contra R$ 52.858,03 / 94. Casos concretos, ambos em 16/06: a venda de R$ 612,00 do Thyago (link `3fb12d1475cb4144` às 16:50 + confirmação manual às 17:33) e a de R$ 333,00 (3 registros). Só há 2 autorizações reais da Rede naquele dia. As confirmações manuais ainda criaram pedidos duplicados no Bling (#26099452504 e #26099547746).

### Nível 3: erro menor ou latente

**22. /bi-vendas: estoque enxerga 100 de 156 produtos.** `_shared/bling.ts:209` busca `pagina=1` e para. Selo mostra "81 em ruptura", real **114**. Pior: `buildBlingCatalog` grava esses 100 de volta em `tenant_integrations.bling.catalog_cache`, que é compartilhado com a loja do site e com o bot, então abrir o /bi-vendas **encolhe** o catálogo de 156 para 100 até o keepalive do site reescrever.

**23. /bi-vendas: pedidos cancelados contam como faturamento.** `index.ts:286-287`. Julho: tela R$ 90.955,39 / 233, correto R$ 90.657,39 / 231 (os 2 cancelados são o mesmo cliente, R$ 149 cada, reemitidos). A /tricopill-relatorios já exclui, então as duas telas discordam.

**24. /bi-vendas: seletor de período abre com data futura.** `TricopilDashboardPage.tsx:62`. Às 23h de 28/07 o campo "Até" mostra 29/07 e o botão "7 dias" devolve R$ 9.341,31 / 16 pedidos quando o real é R$ 9.540,31 / 17.

**25. /bi-vendas: gráfico "por dia" mistura calendários.** `index.ts:222, 241` usa dia UTC no checkout e dia local no Bling. 5 pagamentos (R$ 2.140,51) caem no dia errado; 30/06 mostra R$ 1.820,00 quando foram R$ 2.019,00.

**26. /analytics v2: campo "Até" com data de amanhã.** `AnalyticsV2Panel.tsx:42`. Depois das 21h o card "Leads" mostra 1.171 quando o correto é 1.176.

**27. /analytics v2: "Conversão por origem" soma 11 e o card acima diz 28.** `AnalyticsV2Panel.tsx:229`. São duas definições de "agendado" na mesma tela, sem legenda. E a coorte é truncada: 6 leads criados na janela já têm consulta marcada para 05/08, 06/08, 07/08, 08/10 e 11/02/2027 e valem zero. O WhatsApp converte **3,3%** (17 de 514), não 2,1%.

**28. /analytics v2: "Compareceram 25" sobe sozinho.** `AnalyticsV2Panel.tsx:201`. A Shosp nunca grava "Atendido" (só Agendado 1.398, Confirmado 775, Desmarcado 118, Faltou 50 na tabela inteira), então o número é 100% inferido por "data passou e não cancelou". Como compara `now()` vivo contra status congelado, o card foi de 11 em 09/07 para 25 em 28/07 sem nenhuma informação nova entrar. Verificados: **11**.

**29. /analytics v2: "Conv. %" do Instagram = 0,0% é "não medido".** 656 leads (56% do volume), 0 com vínculo Shosp. Cobertura geral: 19 de 1.171 (1,62%); das 1.074 consultas do período, só 89 (8,3%) têm `lead_id`. O certo é "-", não 0,0%.

**30. /feedback: avaliação só com comentário é perdida em silêncio.** `supabase/functions/crm-manychat-webhook/index.ts:758`. `survey_responses.score` é `integer NOT NULL`, o insert com `score=null` viola 23502, mas o supabase-js resolve com `{data,error}` em vez de lançar, então o `try/catch` não pega: o código segue, grava a interação na ficha, agradece o cliente e devolve `ok:true`. Já materializou: a avaliação de 11/07 14:58 (nota 8, lead-ef546dca-8fe) está na ficha do lead e não está no painel.

**31. /tricopill-relatorios: "Envios do mês" para cedo.** `crm-shipments-report/index.ts:50-56` dá `break` no 1º pedido de outro mês, mas a lista vem ordenada por `created_at` e a decisão usa `posted_at`. Julho: **31 na tela, 32 real**; frete R$ 923,06 contra R$ 951,72 (falta a etiqueta do Artur Nogueira, criada 29/06 e postada 02/07).

**32. /loja-analytics: rankings com chave errada.** Produtos (`lojaTricopillAnalytics.ts:154`): `view_item` grava `3_meses` e `add_to_cart` grava `kit:3_meses`, então o mesmo kit vira 2 linhas e a coluna "Taxa" fica **0% para todos os kits**, permanentemente. Páginas (`:197`): agrupa com querystring, gerando 2.505 caminhos para 80 páginas reais; "/" mostra 219 sessões quando são 1.912. Timeline (`:173`): bucket em UTC, então hoje aparece um ponto "29/07" com 25 eventos e o 28/07 mostra 30 quando foram 49.

---

## 4. O que está ENGANOSO (a conta bate, a leitura induzida é falsa)

Estes não são "menos graves": vários são os mais perigosos justamente porque nenhuma conferência aritmética os pega.

**1. "Consultas agendadas: 162" (alta).** O número confere com o espelho. O espelho é de 09/07. Nada na tela diz isso, e o /analytics, na mesma base, já mostra "Agenda da Shosp sem sincronizar há 19 dias". Duas telas do mesmo sistema, o mesmo dado morto, só uma conta a verdade. Fonte: `DashboardKpiSection.tsx:366`.

**2. "1ª resposta humana: 10% esperaram mais de 16h26" (alta).** `ResultadosPage.tsx:210`. O `percentile_cont` ignora NULL, então quem nunca foi respondido some do cálculo em vez de ir para o fim da fila. **760 de 1.171 (65%) nunca receberam resposta humana**, e 740 deles já passaram das 16h26. A frase verdadeira é "67% esperaram mais de 16h26". A mediana de 1 h 1 é o percentil ~18 da fila real. A caixa "Equipe" logo abaixo escreve a versão honesta ("10% mais lentos"), o card grande não.

**3. "Onde os leads estão parados" (alta).** Migration `:191-201`. A coorte é "leads criados na janela", então quem está parado há mais tempo é exatamente quem a tela não mostra: **563 leads ativos criados antes, 47,2 dias parados em média, 492 há mais de 30 dias**. "Consulta agendada" aparece com 66 leads / 18,8 dias quando o real é **166 leads / 35,9 dias, 88 deles há mais de 30 dias**. E o gargalo fica mais bonito quanto menor a janela: em "7 dias" o pior caso vira 3,7 dias e duas etapas somem.

**4. "Faturamento Bling" numa tela chamada BI Tricopill (alta).** `TricopilDashboardPage.tsx:271`. O Bling é o ERP da casa inteira. Em julho, **124 dos 233 pedidos (R$ 28.646,90, 31,5%) não têm nenhum item Tricopill**: são shampoo e condicionador de salão vendidos no balcão da clínica. Encostado no card "Recebido (checkout) R$ 40.048,81", isso faz parecer que 60% da receita do Tricopill escapa do checkout. O gap real é 50%, e metade dele é balcão da clínica.

**5. "Taxa de cancelamento 0,4%" (alta).** Janela futura vendida como taxa da casa. Ver item 17 acima.

**6. "Gargalos: Encerrado 16,4d (65 leads)" (média).** `AnalyticsV2Panel.tsx:241`. Etapa terminal listada como gargalo, em barra vermelha, acima do gargalo real (Folow UP 1, 90 leads, 16,2d). Dos 65, **54 já receberam a pesquisa de satisfação de fim de jornada**. O próprio produto trata `fechado` como terminal em 4 lugares (`crm-followup-scheduler/index.ts:193`, `src/lib/followUpNps.ts:13 e :26`, `crm-payment-confirm-watch/index.ts:143`).

**7. "Assistente de IA: 509 leads, mediana imediato" (média).** `ResultadosPage.tsx:360`. **502 das 509** primeiras mensagens são o template fixo de saudação (`buildInitialTriageMessage`, `crmAiAutoReply.ts:482`), que retorna em `:1079` **antes** do lock e antes de qualquer chamada ao modelo. Mediana real do template: 1,6 s (é latência de webhook). IA de verdade: **370 leads, mediana 1,2 min**. Se o z.ai cair inteiro, o card continua dizendo "509 leads, mediana imediato".

**8. "Por que perdemos leads" no Resumo clássico (média).** `AnalyticsPage.tsx:184`. Recorta por data de **criação** do lead, não da perda (a coluna `lost_at` não existe). Com "7 dias" a tela mostra 12 perdas lideradas por "Sem interesse (5)"; a semana real teve **29 perdas lideradas por Distância/localização (12)**. A diferença muda a ação: "Distância" é segmentação de anúncio, "Sem interesse" é criativo.

**9. "Novos leads" com janela desigual (média).** `DashboardKpiSection.tsx:204`. A janela atual termina em `now()` (dia parcial) e a anterior termina em 23:59:59.999 (dia inteiro), então a tendência é estruturalmente pessimista e melhora sozinha ao longo do dia. Em "Hoje" às 09:00 o card mostra **-83%** quando a comparação justa (11 hoje até 09:00 contra 7 ontem até 09:00) dá **+57%**. O mesmo card marca -83%, -56%, -35% e -27% ao longo do dia sem nada mudar.

**10. "Taxa de pagamento" no /bi-vendas (média).** `TricopilDashboardPage.tsx:479`. Numerador = pagos no período, denominador = links criados no período. Numa janela de 1 dia (hoje) a tela mostra **200%**, porque um link de ontem foi pago hoje. Não há clamp. E 6 dos 99 "links" são lançamentos manuais que nunca foram link.

**11. "Entregas (pedidos pagos)" no /bi-vendas (média).** `src/services/tricopillBi.ts:73` filtra por `created_at` do **lead**, não por data de pagamento. Tela: 53 pedidos. Real: 61 leads pagantes. Três dos 8 que faltam têm `delivery_mode` explícito (Gabriela motoboy, Felipe retirada, Loren correios), então cada balde da tabela sai subcontado.

**12. "Abandono no carrinho: 73% (66 de 90 sem comprar)" (média).** `src/pages/LojaTricopillPage.tsx:270`. Subtrai eventos de compra de eventos de item adicionado e chama o resultado de pessoas. Por sessão: **71% (42 de 59 carrinhos)**. A tela vizinha /carrinhos-abandonados diz 48, e as duas se contradizem.

**13. "Entrada de leads por dia" (baixa).** `ResultadosPage.tsx:227`. A última barra é sempre um dia parcial com rótulo igual ao dos outros. Às 9h, 28/07 aparece com 11 ao lado de 27/07 com 63; o dia fechou em 46. E o botão "30 dias" desenha 31 barras.

**14. "Conversão lead → pago" no /bi-vendas (baixa).** `crm-tricopill-bi/index.ts:127`. "Pago" é lido como "está AGORA na etapa Pago", então quem avança para Pós-venda some da conversão. Em 90 dias: tela **42,8% (92 de 215)**, correto **47,4% (99 de 209)**, porque 7 leads estão em Pós-venda e 6 estão deletados. Na mesma tela, a seção "Conversão por etapa" mostra 46% para o mesmo indicador, usando a lógica cumulativa correta.

**15. "Assinaturas: MRR R$ 160,59" (baixa).** `src/services/tricopillReports.ts:47`. `fetchSubsSummary()` não recebe o mês: o bloco fica embaixo do seletor e ignora o recorte. Para maio/2026 o certo é **R$ 0,00 e 0 assinaturas** (a única existe desde 29/06). E o export sai nomeado `assinaturas-2026-05.csv` com o número de hoje dentro.

**16. "Excluídos das métricas: 0" (baixa).** `AnalyticsPage.tsx:151`. A contagem está certa, mas colada num "Total no período" que inclui 53 leads apagados, ela induz a ler que o total está limpo. Em 90 dias o card diz 3 quando só 2 daqueles leads ainda existem.

**17. Seletor de período do /loja-analytics (baixa).** `LojaTricopillPage.tsx:104`. Janela rolante em horas com bucket em dia de calendário: as pontas do gráfico são sempre dias parciais rotulados como dias inteiros.

**18. Rótulo da tela /metricas (média).** `MetricsPage.tsx:86`. Ela é a terceira aba de um grupo cujas outras duas são apuradas contra o banco, com o mesmo visual de card e a mesma palavra "Performance", e nada indica que ali o valor seria digitado à mão nem quando. A coluna `updated_at` existe em `metric_configs` mas nem é lida no SELECT (`crmSupabase.ts:353`), e não há trigger que a atualize.

---

## 5. O que foi conferido e está certo

Confirmado por SQL independente, pode confiar:

**Painel principal (/dashboard)**
- Denominador de "Faltas + desmarques": os 4 status do banco (Agendado 1.398, Confirmado 775, Desmarcado 118, Faltou 50) cobrem 100% das 2.341 linhas, nada é descartado.
- "Saúde da IA": 4 aguardando consultor (RPC `crm_pending_human_handoff(48h)`, 0 no tricopill) e 150 leads em `ai_triaging`.
- "Novos leads por origem": meta_whatsapp 194, meta_instagram 164 na janela 21 a 28/07.
- "Mídia paga por campanha": 164 leads com `attribution.channel='lead_ads'`.
- `fetchLeadIdsWithAppointment` e `fetchLeadIdsWithShospLink`: hoje 508 e 102 linhas, abaixo do teto de 1.000 (mas são bombas armadas, ver item 5.1 abaixo).

**/analytics v2**
- Aviso "Agenda da Shosp sem sincronizar há 19 dias": correto e ativo (`max(synced_at)` = 09/07 16:15 UTC).
- "Leads que entraram no período": 1.171 / 1.116 / 55 confere.

**/resultados (a tela mais confiável do sistema)**
- Alerta vermelho "640 leads (55%) não receberam nenhuma mensagem": correto, e é a leitura honesta da operação. 639 são de `lead_ads`.
- Leads novos 1.171 contra 331 anteriores, +253,8%: correto.
- Perdidos 55 + Ativos 1.116 = 1.171, sem sobra nem dupla contagem.
- "De onde vieram os leads": soma dos perdidos 3+51+1+0 = 55, fecha com o card.
- "Campanhas que mais trouxeram lead": 462 com campanha, 709 sem (60,5%).
- Faixas de tempo até a primeira resposta: 51 + 118 + 79 + 144 + 19 + 760 = 1.171, fecha.
- Bloco "O quanto dá para confiar nestes números": campanha 39,5%, motivo de perda 45,8%, vínculo Shosp 1,6%, último sync. Os quatro conferem.

**/feedback**
- Nota média (10,0 em 30d, 9,7 em 90d), Promotores/Neutros/Detratores, comentários recentes e o teto de leitura: todos corretos. A tela está essencialmente sã, o furo é de ingestão (item 30).

**Acusações do auditor que a verificação DERRUBOU** (ou seja, aqui o sistema está certo e o alarme era falso):
- "Conversão lead → consulta conta consulta anterior ao lead": falso, 0 de 18 casos; os 2 exemplos citados também têm consulta marcada depois.
- "Cobertura do funil real com bug de fuso": falso, o 0,0% é operação real e é o mesmo em 3 convenções de janela diferentes.
- "No-show do painel v2 escondido por dado congelado": falso, o 1 está certo; o motor é a taxa de vínculo de 8,3%, não o congelamento.
- "Taxa de resposta 45,3% engana": falso, os 55% sem mensagem também não foram trabalhados por nenhum outro meio (os 653 leads de lead_ads não saíram da etapa de entrada, o registro de perda é 0,5% contra 9,9% do WhatsApp, e o CRM não tem canal de ligação).
- "NPS sem denominador": falso, o card "Respostas" está colado nele.
- "Desconto concedido está errado": falso, ele mede desconto de cupom e mede certo; a diferença cartão/PIX é tabela de preço, não desconto.
- "Metas misturam polo": falso, há trigger `_stamp_tenant_id` e RLS; e a tabela está vazia de qualquer forma.
- Mais 8 acusações menores derrubadas com o mesmo rigor.

---

## 6. O que não deu para conferir, e por quê

1. **O número real de consultas da última semana.** A fonte da verdade é a API da Shosp e o espelho está parado há 19 dias, então nenhuma consulta ao banco recupera o que se perdeu. A faixa 290 a 330 consultas e 8 a 15 faltas para 21 a 28/07 é **estimativa** pela linha de base da própria clínica (semanas de 29/06 e 06/07 fecharam com 308 e 330; faltas entre 1,9% e 5,0%), não medição. Continua incerto até o sync voltar.

2. **A conversão real por canal (Instagram x WhatsApp).** Impossível medir hoje: 0 dos 656 leads de Instagram têm vínculo Shosp e a cobertura geral é 1,62% (19 de 1.171). O Instagram pode estar convertendo melhor que o WhatsApp e não há como saber. Os 2,1% do WhatsApp também não são a conversão dele, são a fração que o vínculo enxergou.

3. **Comparecimento de verdade.** A Shosp **nunca** grava "Atendido", "Compareceu" ou "Realizado" em nenhum período (só 4 status na tabela inteira). Comparecimento é sempre inferência nesta fonte, mesmo com o sync vivo. Isso não é bug do CRM, é limite do dado.

4. **MRR e assinaturas em meses passados.** `asaas_subscriptions` guarda só `status` e `updated_at`, sem histórico de mudança. "Quantas estavam ativas em maio" não é reconstruível sem criar um log de eventos.

5. **Data real da perda de um lead.** A coluna `lost_at` não existe (`grep` em src/ e supabase/ volta vazio) e `audit_logs` não tem uma única linha com `target_table='leads'`. O melhor proxy é o `stage_entered_at` de quem está em "Encerrado", e ele é confiável só para os leads que não caíram no backfill de 26/05.

6. **Decisões de negócio pendentes que mudam número e que eu não posso tomar:**
   - Se a situação 6 ("Em aberto", 366 pedidos, R$ 152.396,52 em 12 meses) e a 814971 ("Em devolução") devem contar como faturamento no Bling.
   - Se a Ingrid deve ser membro do tenant da clínica (ela é dona de 382 leads da clínica com cadastro em `tricopill`), e se os 372 leads devem ser reatribuídos.
   - O que a etapa "Pós-venda" do Tricopill significa: dos 7 leads lá, só 1 tem cobrança paga vinculada.
   - Que metas colocar em `metric_configs` (a tabela nunca teve uma linha).

7. **Duas coisas que a auditoria tocou e não fechou:**
   - O `bling_sales_list` (`crm-bling/index.ts:696`) tem o mesmo teto de 10 páginas do achado 3. Hoje não estoura porque o recorte é mensal (233 pedidos em julho), mas não foi testado sob volume maior.
   - `src/services/abandonedCarts.ts:10` e `:118` declaram `ROW_LIMIT = 50000` contra o mesmo `max_rows=1000`. Não foi auditado se a tela de carrinhos abandonados já está truncando. Provável que sim, mas continua **não verificado**.

---

## 7. Extra: se for corrigir em ordem

1. **Religar o sync da Shosp** e trocar a guarda de `if (!shospIsRateLimited())` por `if (!shospIsRateLimited() && appts > 0)` em `shospSync.ts:502` e `:595`. Sem isso, 12 indicadores continuam mortos e o cron continua carimbando sucesso.
2. **Matar os tetos de 1.000**: trocar os `.limit(N)` grandes por RPC que agrega no banco (loja, dashboard 30d) ou por `.range()` paginado com `ORDER BY` determinístico. Regra para o CLAUDE.md: neste projeto, `.limit(n)` com n > 1000 é uma mentira.
3. **Tirar o fallback de mock** em `crmSupabase.ts:532, 566, 582`. Tabela vazia = tela vazia. Hoje o `/tv` da clínica exibe números inventados o dia inteiro.
4. **Um helper único de dia local** (`ymdLocal()`) e `(now() at time zone 'America/Sao_Paulo')::date` nas RPCs. O padrão `toISOString().slice(0,10)` aparece em ~20 lugares.
5. **`(days - 1) * 86_400_000` no `windowFor`** e `deleted_at is null` nos 5 blocos de `tenant_analytics_summary`.
6. **Rótulos**: "Conv." do Resumo clássico vira "Em aberto" (ou a tabela sai, já que o v2 faz certo na mesma página), e todo card alimentado por espelho velho mostra "-" com selo de data em vez de número.