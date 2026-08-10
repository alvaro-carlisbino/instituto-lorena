# Apps Flutter — Instituto Lorena e Tricopill

Data: 10/ago/2026. Autor: Álvaro + Claude.
Status: **Fase 0 (fundação) no ar**. Nenhum app Flutter escrito ainda — ver §7 e §9.

---

## 1. Auditoria de viabilidade (o que realmente existe hoje)

Levantado direto do Supabase `fgyfpmnvlkmyxtucbxbu` e do MySQL `c7lorenaap` (sistema de cirurgia), não de memória.

### 1.1 O que já tem conteúdo de verdade

| Fonte | Volume | Serve pro app? |
|---|---|---|
| `shosp_appointments` | 3.305 agendamentos | Sim — "minhas consultas" |
| `shosp_patients` | 690 pacientes | Sim — é a identidade do paciente |
| `leads` | 2.596 | Sim — dono da conversa/WhatsApp |
| MySQL `cirurgia` | 175 cirurgias, 163 finalizadas (17/nov/25 → 17/jun/27) | **Sim, e é o ouro** |
| MySQL `cirurgia_foliculo_extraido` / `_implantado` | 3.939 / 4.814 linhas | Sim — o resultado numérico |
| `crm_media_items` | 271 mídias de conversa | Parcial (é mídia de chat, não clínica) |
| `tricopill_customers` + `customer_otps` | 15 + 2 | Sim — conta do cliente **já existe** |

A cirurgia rende uma tela de resultado que hoje ninguém entrega. Exemplo real (cirurgia 298, 06/ago/2026): meta 6.000, **6.079 folículos extraídos e implantados**, distribuídos em áreas cadastradas (Hairline, Coroa, Escalpe Médio, Entradas + topetes, Recesso, Segunda área), com etapas carimbadas por horário (PRE-CIRURGICO → ANESTESIA1/2 → EXTRACAO → PRE_INSICOES → IMPLANTE → RPA → ALTA_ANESTESICA → ALTA).

### 1.2 O que está VAZIO — e derruba metade da ideia

| Tabela | Linhas |
|---|---|
| `medical_records` | **0** |
| `clinical_notes` | **0** |
| `lead_treatment_protocols` | **0** |
| `lead_protocol_sessions` | **0** |
| `patient_consents` | **0** |
| `surgery_accounts` | **0** |

As telas existem no CRM, mas ninguém alimenta. Um app que promete "acompanhe seu tratamento" mostraria tela em branco para 100% dos pacientes.

### 1.3 O buraco maior: **não existe uma única foto de paciente**

- Buckets no Supabase Storage: `crm-imports`, `crm-lead-attachments`, `kit-fotos`. Nenhum de foto clínica.
- No MySQL da cirurgia, nenhuma tabela ligada a `cirurgia` tem coluna de imagem (as colunas `arquivo` existem só em `usuario`, `cliente`, `categoria`, `texto`, `rede_social` — é conteúdo do site institucional).

**"O cliente ver suas fotos" não é feature de app. É um processo que ainda não existe na clínica.** Sem alguém fotografando padronizado (mesmo ângulo, mesma luz, D0 / 30d / 90d / 6m / 12m), o app não tem o que mostrar. Isso é pré-requisito, não escopo do app.

### 1.4 Vínculo cirurgia ↔ CRM

`cirurgia.paciente` é `varchar(255)` solto. De 173 nomes distintos, **só 4** trazem o prontuário no texto (`"5480 - pedro antonio guinzani"`). Os outros 169 são nome puro.

Caminho viável: `cirurgia.paciente` → normalizar (minúsculo, sem acento) → casar com `shosp_patients.nome` → `shosp_patients.lead_id`. Amostragem indica taxa alta de casamento (os pacientes de cirurgia são pacientes Shosp), mas **não é 100%** — precisa de uma tela de conferência manual para o resto.

### 1.5 Identidade do paciente — qual chave usar no login

De 690 `shosp_patients`:

| Campo | Preenchido |
|---|---|
| CPF | 676 (98%) |
| e-mail | 658 (95%) |
| celular | 325 (47%) |
| `lead_id` | 190 (28%) |

**CPF é a chave de identidade. O celular não é** — metade não tem. Login por WhatsApp sozinho deixa 53% dos pacientes de fora.

### 1.6 Ambiente

- Flutter/Dart: **não instalado** nesta máquina.
- Xcode 26.6: ok. Android SDK: ok.

---

## 2. Recomendação

### 2.1 Um codebase, três flavors — não dois apps

Dois repositórios Flutter separados significa manter duas vezes: auth, cliente Supabase, design system, push, deploy, revisão de loja, CI. Para um time de um dev, é o erro caro.

```
lorena_apps/                 # 1 repo Flutter
  packages/core/             # auth, supabase, modelos, design system, push
  packages/features/         # agenda, cirurgia, fotos, pedidos, assinatura
  apps/lorena/               # flavor paciente da clínica   (bundle br.com.institutolorena.app)
  apps/tricopill/            # flavor cliente/assinante     (bundle br.com.tricopill.app)
  apps/equipe/               # flavor interno               (bundle br.com.institutolorena.equipe)
```

Nas lojas aparecem como apps distintos, com ícone, nome e cor próprios. Por dentro é um só.

### 2.2 Colaborador NÃO entra no app do cliente

Misturar staff e paciente no mesmo binário é como um bug de RLS vira paciente vendo prontuário alheio. Além disso, o CRM web já é responsivo e cobre quase tudo que o colaborador precisa.

O que **justifica** app nativo pro colaborador (e só isso, no começo):
1. **Ponto com selfie + cerca GPS** — já existe `/ponto` no CRM, mas câmera e localização são muito melhores nativas.
2. **Captura de foto clínica padronizada** — com sobreposição do ângulo anterior pra repetir o enquadramento. É isso que alimenta o app do paciente.
3. Agenda do dia e cirurgia em modo leitura.

Tudo mais o colaborador continua fazendo no CRM web.

### 2.3 Inverter a ordem: clínica primeiro, Tricopill como app de assinante

- **App de e-commerce de um produto só tem adesão baixa.** Ninguém instala app pra comprar suplemento uma vez por mês; isso o site + WhatsApp já fazem melhor.
- O que justifica app no Tricopill é a **assinatura**: lembrete diário da cápsula, ciclo, foto de evolução mensal, rastreio do envio, cupom do clube. É retenção, que é o KPI do clube.
- No Instituto Lorena o app se justifica sozinho: transplante é jornada de 12+ meses, o paciente pagou dezenas de milhares e hoje não tem nenhum lugar pra acompanhar o próprio resultado.

---

## 3. Arquitetura

```
Flutter (3 flavors)
      │  Supabase Auth (OTP) + RLS por paciente
      ▼
Supabase Postgres  ── fonte única do app
      ▲
      ├── Shosp (já sincroniza: agendamentos, pacientes)
      ├── Bling / Melhor Envio / Asaas (já sincronizam: pedidos, rastreio, assinatura)
      └── MySQL c7lorenaap  ── espelho novo (cirurgia, folículos, etapas)
```

Regra dura: **o app nunca fala com o MySQL nem com o Shosp diretamente.** Só Supabase. O MySQL da cirurgia continua sendo a fonte de escrita (o centro cirúrgico não para), e um sync unidirecional espelha pro Supabase — que é exatamente a Fase 1 já decidida em 28/jul.

### Autenticação do paciente

CPF + código de 6 dígitos. Envio por WhatsApp quando há celular (47%), por e-mail no resto (95%). `customer_otps` já existe e serve de base. Nada de senha — paciente esquece, e senha é passivo de segurança.

Identidade: nova tabela `patient_accounts` (`cpf` normalizado → `auth.users.id` → `shosp_patients.prontuario` → `leads.id`). RLS de tudo que o app lê passa por ela.

### LGPD — não é detalhe

Dado de saúde é dado pessoal **sensível**. Antes de qualquer foto ou resultado entrar no app:
- consentimento explícito e registrado (`patient_consents` existe, com 0 linhas — passa a ser obrigatório);
- foto **nunca** em bucket público, só URL assinada de curta duração;
- log de acesso (`medical_records_access_log` já existe);
- política de exclusão a pedido do titular.

---

## 4. Fases

**Fase 0 — Fundação (pré-requisito de tudo) — CONSTRUÍDA EM 10/ago/2026**

| # | Item | Estado |
|---|---|---|
| 1 | Espelho do MySQL nas tabelas `srg_*` + edge `crm-cirurgia-sync` + cron 2/2h | **no ar** |
| 2 | Vínculo `cirurgia.paciente` → `shosp_patients` → `lead_id` | **no ar**, 108/175 automático |
| 3 | `patient_accounts` + `patient_otps` + login CPF (`crm-patient-auth`) | **no ar** |
| 4 | Bucket `paciente-fotos` + `patient_photos` + RLS de storage | **no ar** |
| 5 | *(não planejado)* fechar 20 policies `using (true)` | **no ar** |

Detalhe em §7.

**Fase 1 — App Lorena (paciente)**
Minhas consultas (Shosp) · Minha cirurgia (data, equipe, folículos por área, linha do tempo das etapas) · Minhas fotos (evolução lado a lado) · Pós-operatório (cuidados por dia) · Falar com a clínica (cai no CRM, na conversa que já existe).

**Fase 2 — App Equipe**
Ponto selfie + GPS · Captura de foto clínica com guia de enquadramento · Agenda do dia · Cirurgia em leitura.

**Fase 3 — App Tricopill (assinante)**
Lembrete da cápsula · Meu ciclo e próxima entrega · Rastreio · Minha evolução (foto mensal) · Clube/cupom · Recompra em 1 toque.

Fase 0 é a única que não dá pra pular. Fases 1–3 podem ser reordenadas.

---

## 5. Riscos declarados

| Risco | Peso |
|---|---|
| Não existe foto de paciente hoje — o app da clínica nasce oco sem mudar o processo da clínica | **Alto** |
| 169 de 173 cirurgias sem vínculo estrutural com o CRM; casamento por nome precisa de revisão humana | Médio |
| Revisão de loja (App Store/Play) para app de saúde é mais rigorosa e pede política de privacidade publicada | Médio |
| 53% dos pacientes sem celular cadastrado — OTP só por WhatsApp exclui metade | Médio (resolvido com e-mail) |
| Escopo total (3 apps) é muito maior que qualquer entrega anterior do CRM | Alto — daí o fatiamento |

---

## 6. Credenciais

As credenciais do sistema de cirurgia (FTP e MySQL) foram passadas em chat aberto e **não** foram gravadas neste repositório. Ficaram só em `/private/tmp/.../scratchpad`, fora do git. Recomendação: trocar a senha do MySQL e guardar em secret do Supabase quando o sync entrar no ar.

O acesso ao MySQL foi validado de fora (MariaDB 10.11.14 responde em `sv1.yets.com.br:3306`) — o que significa que **o banco de produção da cirurgia aceita conexão remota da internet**. Vale restringir por IP no cPanel.

---

## 7. O que foi construído em 10/ago/2026

### 7.1 Espelho do centro cirúrgico

`supabase/functions/crm-cirurgia-sync` lê o MySQL `c7lorenaap` e grava nas tabelas `srg_*`. **Full sync sempre** — o banco todo são ~14 mil linhas e sync incremental por watermark introduziria bug silencioso (linha com `dtAlteracao` nulo, hard delete no MySQL) para economizar segundos que não fazem falta. Roda em ~8s, idempotente, chaveado pelo id do MySQL.

Carga inicial conferida contra a origem:

| Tabela | Linhas |
|---|---|
| `srg_surgeries` | 175 |
| `srg_follicles_implanted` | 4.838 |
| `srg_follicles_extracted` | 3.939 |
| `srg_stages` | 2.574 |
| `srg_hours` | 1.923 |
| `srg_surgery_areas` | 1.019 |
| `srg_staff` | 24 |

**Fuso:** os `datetime` do MySQL não têm timezone e o servidor roda em UTC-3 (conferido: `now()`=14:26 vs `utc_timestamp()`=17:26). O sync lê como string via `date_format` e carimba `-03:00` na mão — deixar o driver converter usaria o fuso do processo (UTC no edge) e jogaria toda cirurgia 3h para trás. Validado: a cirurgia de 10/ago marca `07:51:11` no MySQL e `07:51:11 BRT` no Supabase.

Cron `crm-cirurgia-sync-job` de 2 em 2 horas, validado ponta a ponta via `pg_net` (200, `ok:true`).

**Fora do espelho de propósito:** `cirurgia.anamnese` e `cirurgia.observacoes` (texto clínico livre que nada no app usa) e `cliente.email`/`senha` (credenciais do sistema PHP).

### 7.2 Vínculo cirurgia ↔ paciente

`srg_match_patients()` casa por nome normalizado (sem acento, sem pontuação, sem o prefixo de prontuário). **Só grava quando o nome bate em exatamente um paciente.** Nome ambíguo fica pendente — num app de saúde, casar por semelhança é mostrar a cirurgia de um paciente para outro.

Resultado: **108 de 175 casaram sozinhas** (62%), 67 pendentes, 0 ambíguas. Os 67 são os casos clássicos: nome parcial (`Ana Paula Goes Martins` vs `ANA PAULA GOES MARTINS SAES`), erro de digitação (`BILLÓRA`/`BILLÓRIA`, `March`/`MARCHI`), nome genuinamente ambíguo (`Carlos Eduardo` casa com 5 pacientes) e gente que não está no Shosp.

`srg_suggest_patients(surgery_id)` ranqueia candidatos por token para a tela de conferência — testado com `Ana Paula Goes Martins`, trouxe o certo em 1º com score 1.00.

**Achado importante:** das 108 casadas, só **27 chegaram a um `lead_id`**, porque apenas 190 dos 690 `shosp_patients` têm lead. Ou seja: para o app, a âncora de identidade é o **prontuário**, não o lead. O lead é enfeite.

### 7.3 Identidade e login do paciente

- `patient_accounts` (CPF ↔ `auth.users` ↔ prontuário ↔ lead), `patient_otps` (código só como hash).
- Edge `crm-patient-auth`: `request` (CPF → código por WhatsApp, com e-mail de fallback) e `verify` (código → `token_hash` que o app troca por sessão no `verifyOtp`).
- **A resposta do `request` é sempre idêntica**, ache ou não ache o CPF. Confirmar "este CPF existe" num app de clínica capilar entrega de graça a informação de que a pessoa é paciente daqui. Testado: CPF inexistente responde igual e não cria OTP, não cria conta e não envia nada.
- 60s entre envios, 5 tentativas por código, código expira em 10 min, comparação de hash sem vazar tempo.

**O paciente não ganha policy de leitura em nenhuma tabela do CRM.** Ele fala com 4 RPCs `security definer`: `patient_me`, `patient_surgeries`, `patient_appointments`, `patient_photos_list`. Se amanhã alguém abrir uma policy no CRM, o paciente continua sem enxergar nada além disso.

Testado ponta a ponta com sessão simulada: paciente do prontuário 5188 recebe a própria cirurgia (6.079 folículos, quebra pelas 6 áreas somando exatamente 6.079, e as 9 etapas com horário); usuário sem conta de paciente recebe `[]`, 0 consultas, 0 fotos.

### 7.4 Fotos

Bucket **privado** `paciente-fotos` + `patient_photos` (prontuário, ângulo, marco, quem capturou, `visible_to_patient`). Convenção de caminho `<prontuario>/<marco>/<angulo>-<uuid>.jpg`, e a policy de storage compara a pasta raiz com o prontuário do logado. `patient_consents` ganhou `shosp_prontuario` — consentimento por lead não serve, porque só 28% dos pacientes têm lead.

Continua valendo o §1.3: **ainda não existe nenhuma foto**. A estrutura está pronta; a captura entra com o app da equipe.

### 7.5 Correção de segurança não planejada

Auditoria antes de criar login de paciente encontrou **20 policies com `using (true)` para qualquer `authenticated`**. Como policies permissivas são OR, esse `true` engolia o `tenant_isolation` que existia ao lado. As piores: `whatsapp_channel_instances` (token/credencial das linhas), `crm_media_items` (271 mídias de conversa de todos os leads), `crm_conversation_states` (leitura **e escrita**), `lead_task_attachments`, `crm_ai_configs`.

Hoje isso é vazamento entre polos com 5 usuários da casa. Vira grave no minuto em que existir login de paciente, porque paciente também é `authenticated`.

Trocado por `is_staff_user()` (tem vínculo em `tenant_members`). Os 5 usuários atuais somam 9 vínculos — **ninguém perdeu acesso**. Restam 0 policies abertas.

Deixar tenant-estrito (`tenant_id = current_tenant_id()`) resolveria também o vazamento entre polos, mas mexe no comportamento do CRM e não foi feito aqui. Fica como decisão do Álvaro.

---

## 8. Pendências do Álvaro

1. **Trocar a senha do MySQL da cirurgia** (foi passada em chat aberto) e restringir o acesso remoto por IP no cPanel — hoje o banco de produção aceita conexão de qualquer lugar da internet. Depois de trocar: `supabase secrets set CIRURGIA_DB_PASSWORD=<nova>`.
2. **Verificar o domínio da clínica no Resend.** Hoje só `tricopill.com.br` está verificado, então o e-mail com o código de acesso sairia com remetente Tricopill. Com o domínio verificado é só setar `PATIENT_OTP_FROM`.
3. **Decidir sobre os 67 vínculos pendentes** — depende da tela de conferência (próximo passo).

## 9. Próximos passos

1. Tela de conferência do vínculo no CRM (usa `srg_suggest_patients` + `srg_link_patient`), para fechar os 67 pendentes.
2. Instalar Flutter e montar o monorepo com os três flavors.
3. App da equipe primeiro — é a captura de foto que dá conteúdo ao app do paciente (decisão de 10/ago).
