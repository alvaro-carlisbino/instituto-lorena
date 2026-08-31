-- A Sofia não sabia dizer "isso a gente não faz".
--
-- 31/08, 11h07: o Valter chegou com "vi um anúncio" e emendou "faz cirurgia de
-- abano de orelha". Quem respondeu foi a Aline, 26 minutos depois, e fechou bem
-- em duas mensagens. Deu certo porque era horário comercial e quem pegou foi
-- gente. Às 23h quem atende é a Sofia, e o prompt de 15.925 caracteres não tinha
-- UMA linha sobre procedimento fora do escopo: nem "não fazemos", nem "não
-- realizamos", nem "outros procedimentos". Sem regra, ela cai no roteiro que
-- existe e joga o menu de 1 a 5 na cara de quem perguntou de orelha, ou pior,
-- promete "vou verificar com a médica" para algo que a clínica nunca fez.
--
-- O volume é pequeno e não justifica mexer em anúncio: 1 lead de orelha em 120
-- dias, sobre 2.860 que escreveram. O que justifica a regra é o risco da noite,
-- não o volume.
--
-- O escopo aqui não é chute: 180 dias de `shosp_appointments` são capilares sem
-- exceção (transplante, protocolo, terapia, lavagem, LED, sobrancelha, consulta
-- clínica capilar). Nada de estética facial ou corporal na agenda.
--
-- A armadilha que quase virou regra errada: em 24/08 alguém pediu "preenchimento
-- na barba" e a resposta certa foi "o preenchimento da barba é feito através do
-- transplante capilar". Se a regra listasse "preenchimento" como fora do escopo,
-- a Sofia passaria a recusar venda real. Por isso quem decide é a REGIÃO, não a
-- palavra.
--
-- Três pontos mudam juntos, senão não adianta ([[crm_agenda_lorena_regra_no_prompt]]):
-- o escopo, a situação especial e o fluxo resumido. Regra que não aparece no
-- fluxo a Sofia não segue.

do $migration$
declare
  p text;
  anchor_medicos   constant text := '## OS MÉDICOS';
  anchor_fora      constant text := '### Mensagem fora do assunto';
  anchor_fluxo     constant text := 'Passo 1: Saudação + menu (1 a 5)';
begin
  select system_prompt into p from crm_ai_configs
   where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  if position('O QUE O INSTITUTO FAZ' in p) > 0 then
    raise notice 'bloco de escopo já existe — nada a fazer';
    return;
  end if;

  -- 1. O escopo, logo antes dos médicos.
  if position(anchor_medicos in p) = 0 then
    raise exception 'âncora "%" sumiu — revisar antes de aplicar', anchor_medicos;
  end if;

  p := replace(p, anchor_medicos, $bloco$## O QUE O INSTITUTO FAZ (E O QUE NÃO FAZ)

O Instituto é especializado em **cabelo, barba, sobrancelha, cílios e couro cabeludo**. É só isso.

**É nosso:**
- Transplante capilar masculino e feminino
- Transplante de sobrancelha, de barba e de cílios
- Consulta clínica capilar (queda, calvície, rarefação, couro cabeludo)
- Protocolos e terapias capilares, lavagem, LED, retornos e pós-operatório

**NÃO é nosso:** qualquer procedimento fora dessas regiões. Orelha, nariz, pálpebra, mandíbula, lipoaspiração, prótese, cirurgia bariátrica, dente, estética facial e corporal em geral. O Instituto não faz, e você não precisa consultar ninguém para ter certeza disso.

**Cuidado com as palavras que enganam:** "preenchimento da barba", "preenchimento das falhas" e "preenchimento das entradas" são **transplante capilar**, e são nossos. Quem decide não é a palavra, é a **região**: se for cabelo, barba, sobrancelha, cílios ou couro cabeludo, é nosso.

Quando pedirem algo que não é nosso, siga "Paciente pede procedimento que o Instituto não faz", em SITUAÇÕES ESPECIAIS.

---

$bloco$ || anchor_medicos);

  -- 2. A situação especial, antes da "mensagem fora do assunto".
  if position(anchor_fora in p) = 0 then
    raise exception 'âncora "%" sumiu — revisar antes de aplicar', anchor_fora;
  end if;

  p := replace(p, anchor_fora, $bloco$### Paciente pede procedimento que o Instituto não faz

Acontece com quem clicou no anúncio sem ler. Não é problema, e não vira negociação.

**Não** mande o menu de 1 a 5. **Não** pergunte cidade e prazo. **Não** encaminhe para a Aline. Responda, ofereça a porta capilar uma vez, e deixe a pessoa seguir:

> Aqui no Instituto o nosso foco é capilar: transplante, barba, sobrancelha e saúde do cabelo. Esse procedimento a gente não faz, não 😊
> Se em algum momento quiser avaliar a parte capilar, é só me chamar!

Se a pessoa disser que não é isso que ela quer, agradeça e encerre. **Não insista.**

**Nunca** diga "vou verificar com a médica", "vou consultar a equipe" nem "acredito que sim". Sobre procedimento fora do capilar a resposta é não, e ela é sua.

**Uma exceção só:** se VOCÊ ficar em dúvida se aquilo é capilar ou não, não invente. Encaminhe para a Aline Fenato normalmente, como em qualquer atendimento.

$bloco$ || anchor_fora);

  -- 3. O fluxo resumido, senão a regra não é lida na hora certa.
  if position(anchor_fluxo in p) = 0 then
    raise exception 'âncora do fluxo resumido sumiu — revisar antes de aplicar';
  end if;

  p := replace(p, anchor_fluxo,
    'Pediu procedimento FORA do capilar? → diz que não fazemos e ENCERRA (sem menu, sem Aline)
  ↓
' || anchor_fluxo);

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  if position('O QUE O INSTITUTO FAZ' in p) = 0
     or position('Paciente pede procedimento que o Instituto não faz' in p) = 0
     or position('Pediu procedimento FORA do capilar' in p) = 0 then
    raise exception 'os três pontos não entraram juntos — abortando';
  end if;

  raise notice 'escopo no prompt: % caracteres', length(p);
end
$migration$;
