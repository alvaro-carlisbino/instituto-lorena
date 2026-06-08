const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, Header, Footer, PageBreak, TabStopType,
} = require('docx');

const COLOR_PRIMARY = '1F3A5F';
const COLOR_ACCENT  = '3B7EA1';
const COLOR_MUTED   = '6B7280';
const COLOR_TABLE_H = '1F3A5F';
const COLOR_TABLE_R = 'F3F4F6';
const COLOR_BORDER  = 'CBD5E1';
const COLOR_HILITE  = 'EAF3F8';

const thin = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };
const tableW = 9360;

function P(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, ...(opts.run || {}) })];
  return new Paragraph({
    children: runs,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: opts.line ?? 300 },
    alignment: opts.align ?? AlignmentType.LEFT,
    ...(opts.heading ? { heading: opts.heading } : {}),
    ...(opts.numbering ? { numbering: opts.numbering } : {}),
  });
}
function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })],
    spacing: { before: 360, after: 180 },
  });
}
function H1NewPage(text) {
  return new Paragraph({
    pageBreakBefore: true,
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })],
    spacing: { before: 0, after: 180 },
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text })],
    spacing: { before: 280, after: 140 },
  });
}
function bulletP(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, ...(opts.run || {}) })],
    spacing: { after: 60, line: 280 },
  });
}
function headerCell(text, widthDxa) {
  return new TableCell({
    borders: cellBorders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: COLOR_TABLE_H, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
    })],
  });
}
function bodyCell(text, widthDxa, opts = {}) {
  const fill = opts.highlight ? COLOR_HILITE : (opts.alt ? COLOR_TABLE_R : 'FFFFFF');
  let paragraphs;
  if (Array.isArray(text) && text.length > 0 && typeof text[0] === 'object' && 'paragraph' in text[0]) {
    paragraphs = text.map((p) => new Paragraph({
      children: p.paragraph.map((t) => new TextRun({ text: t.text, bold: t.bold, italics: t.italics, size: 20, color: t.color })),
      spacing: { after: 40 },
    }));
  } else {
    const runs = Array.isArray(text)
      ? text.map((t) => new TextRun({ text: t.text, bold: t.bold, italics: t.italics, size: 20, color: t.color }))
      : [new TextRun({ text, size: 20 })];
    paragraphs = [new Paragraph({ children: runs })];
  }
  return new TableCell({
    borders: cellBorders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    children: paragraphs,
  });
}

function table2col(rows, widths) {
  return new Table({
    width: { size: tableW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => {
      if (i === 0) {
        return new TableRow({ children: [headerCell(r[0], widths[0]), headerCell(r[1], widths[1])] });
      }
      const alt = i % 2 === 0;
      const highlight = r[2] === 'highlight';
      return new TableRow({
        children: [
          bodyCell([{ text: r[0], bold: true }], widths[0], { alt, highlight }),
          bodyCell(r[1], widths[1], { alt, highlight }),
        ],
      });
    }),
  });
}
function table3col(rows, widths) {
  return new Table({
    width: { size: tableW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => {
      if (i === 0) {
        return new TableRow({ children: [headerCell(r[0], widths[0]), headerCell(r[1], widths[1]), headerCell(r[2], widths[2])] });
      }
      const alt = i % 2 === 0;
      const highlight = r[3] === 'highlight';
      return new TableRow({
        children: [
          bodyCell([{ text: r[0], bold: true }], widths[0], { alt, highlight }),
          bodyCell(r[1], widths[1], { alt, highlight }),
          bodyCell(r[2], widths[2], { alt, highlight }),
        ],
      });
    }),
  });
}
function table4col(rows, widths) {
  return new Table({
    width: { size: tableW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => {
      if (i === 0) {
        return new TableRow({ children: r.map((c, j) => headerCell(c, widths[j])) });
      }
      const alt = i % 2 === 0;
      return new TableRow({
        children: [
          bodyCell([{ text: r[0], bold: true }], widths[0], { alt }),
          bodyCell(r[1], widths[1], { alt }),
          bodyCell(r[2], widths[2], { alt }),
          bodyCell(r[3], widths[3], { alt }),
        ],
      });
    }),
  });
}

// ==========================================================================
// CAPA
// ==========================================================================
const COVER = [
  new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: '' })] }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: 'PROPOSTA COMERCIAL', size: 28, color: COLOR_ACCENT, bold: true, characterSpacing: 80 })],
    spacing: { after: 80 },
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: 'E-commerce 100% IA Tricopill e expansões do Instituto Lorena', size: 52, bold: true, color: COLOR_PRIMARY })],
    spacing: { after: 160 },
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({
      text: 'Documento técnico-comercial completo: escopo, arquitetura, premissas, critérios de sucesso, decisões pendentes, riscos e investimento.',
      size: 24, color: COLOR_MUTED, italics: true,
    })],
    spacing: { after: 600, line: 340 },
  }),
  new Paragraph({ children: [new TextRun({ text: 'Cliente: ', bold: true, size: 22 }), new TextRun({ text: 'Tricopill / Limitless', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Empresa irmã: ', bold: true, size: 22 }), new TextRun({ text: 'Instituto Lorena Visentainer — Maringá / PR', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Fornecedor: ', bold: true, size: 22 }), new TextRun({ text: 'Álvaro Carlisbino — Desenvolvimento e operação do CRM', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Versão: ', bold: true, size: 22 }), new TextRun({ text: 'v3 — Junho de 2026 (revisão completa com detalhamento técnico)', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Validade: ', bold: true, size: 22 }), new TextRun({ text: '15 dias corridos a partir da data de envio.', size: 22 })], spacing: { after: 600 } }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ==========================================================================
// ÍNDICE (texto simples, não TOC automático para evitar dependências)
// ==========================================================================
const INDICE = [
  H1('Índice'),
  bulletP('1. Sumário executivo'),
  bulletP('2. Contexto e desafios atuais'),
  bulletP('3. Premissas e suposições do projeto'),
  bulletP('4. Escopo detalhado (o que existe, o que será construído, o que fica fora)'),
  bulletP('5. Detalhes técnicos da arquitetura'),
  bulletP('6. Cronograma de implantação'),
  bulletP('7. Critérios de sucesso e metas mensuráveis'),
  bulletP('8. Decisões pendentes antes do go-live (com recomendações)'),
  bulletP('9. Riscos identificados e mitigações'),
  bulletP('10. Modelo comercial e investimento'),
  bulletP('11. Próximos passos e garantias'),
  bulletP('12. Aceite'),
  bulletP('13. Glossário de termos técnicos'),
];

// ==========================================================================
// 1. SUMÁRIO EXECUTIVO
// ==========================================================================
const SUMARIO_EXECUTIVO = [
  H1NewPage('1. Sumário executivo'),
  P('A Tricopill (linha de produtos capilares operada conjuntamente com o Instituto Lorena Visentainer e o spa da Ingrid) hoje vende seus produtos principalmente via WhatsApp, com atendimento manual em cada etapa: descoberta, recomendação, cobrança e baixa de estoque. Esta proposta transforma essa operação em um e-commerce 100% conduzido por inteligência artificial dentro do mesmo CRM já em produção no Instituto.'),
  P('O vendedor de IA atende o cliente do primeiro "oi" até a entrega: identifica a necessidade, recomenda produto, faz cross-sell e upsell quando faz sentido, monta o carrinho, calcula frete, gera link de pagamento, confirma a compra, dispara o pedido no Bling, acompanha o rastreio e ainda volta sozinho para reposição quando o cliente está prestes a acabar o produto. O atendimento humano permanece disponível por solicitação, mas deixa de ser o caminho principal — passa a ser exceção.'),
  P('A proposta também contempla três novas automações para o Instituto Lorena que foram alinhadas em conjunto: cobrança automática de cirurgia 10 dias antes do procedimento, disparos de aniversário e datas comemorativas, e um sistema de indicação com cashback rastreável.'),
  P('O escopo aproveita a infraestrutura já paga e operacional do CRM do Instituto, reduzindo significativamente o tempo de implantação em comparação a construir do zero ou contratar uma plataforma de e-commerce convencional. O cronograma é de 8 semanas em 6 sprints, com investimento de R$ 52.000 de setup único e R$ 4.800 de mensalidade após go-live.'),
];

// ==========================================================================
// 2. CONTEXTO
// ==========================================================================
const CONTEXTO_DESAFIO = [
  H1NewPage('2. Contexto e desafios atuais'),
  H2('2.1. Operação Tricopill hoje'),
  bulletP('Vendas de produtos capilares são feitas via WhatsApp, com cotação, separação, cobrança e baixa de estoque executadas manualmente por uma única pessoa.'),
  bulletP('Sem integração entre WhatsApp e Bling: cada venda exige digitação dupla e a baixa de estoque é feita duas vezes.'),
  bulletP('Cobrança feita por envio manual de Pix ou link, sem confirmação automática. A equipe precisa monitorar para liberar o pedido.'),
  bulletP('Não há reposição proativa: o cliente que comprou um shampoo de 60ml e provavelmente vai precisar de outro em 30 dias só volta quando lembra sozinho.'),
  bulletP('Cotações que não fecham simplesmente desaparecem: ninguém volta no cliente que pediu o produto, perguntou o preço e sumiu.'),

  H2('2.2. Operação Instituto Lorena que entra junto'),
  bulletP('Cobrança de cirurgias futuras é manual e tardia: pacientes recebem a cobrança próximo ao procedimento, gerando estresse no fluxo de caixa e atritos pontuais.'),
  bulletP('Datas relevantes do paciente (aniversário, retornos sazonais) não são aproveitadas para relacionamento e oferta.'),
  bulletP('Indicações boca a boca acontecem, mas não há rastreio nem recompensa para incentivar — cada paciente satisfeito poderia trazer dois, mas não traz porque não há mecanismo.'),

  H2('2.3. O que esta proposta NÃO se propõe a resolver'),
  P('Para que o escopo fique claro e a entrega seja realista, esta proposta não substitui sistemas que já estão em outras frentes paralelas:'),
  bulletP('Conciliação bancária, contas a pagar, DDA, gestão fiscal e entrada de notas fiscais de fornecedor (XML): permanecem sob responsabilidade do TOTVS RP Saúde, que já está em processo de implantação.'),
  bulletP('Site institucional e e-commerce convencional do Tricopill: continua como está, fora deste escopo. A IA conduz a venda pelo WhatsApp e Instagram, em paralelo ao site.'),
  bulletP('Maquininhas físicas de cartão e gestão fiscal pesada: também ficam fora do escopo do CRM.'),
];

// ==========================================================================
// 3. PREMISSAS E SUPOSIÇÕES
// ==========================================================================
const PREMISSAS = [
  H1NewPage('3. Premissas e suposições do projeto'),
  P('Esta seção registra explicitamente o que estamos assumindo como verdadeiro. Se qualquer premissa abaixo não se confirmar, o escopo, prazo ou investimento podem ser afetados. Vale revisar antes do aceite.'),

  H2('3.1. Infraestrutura compartilhada'),
  bulletP('A infraestrutura Supabase Pro do Instituto continua ativa durante toda a implantação e operação do projeto Tricopill. Banco, edge functions e storage são compartilhados sem custo adicional para a Tricopill.'),
  bulletP('O CRM do Instituto continua em produção sem interrupção. As entregas Tricopill são incrementais e não exigem janela de manutenção.'),
  bulletP('Backups, monitoramento, atualizações de segurança e versionamento já existentes do CRM aplicam-se automaticamente à operação Tricopill.'),

  H2('3.2. Outras frentes em andamento'),
  bulletP('O TOTVS RP Saúde será implantado pelo cliente em paralelo a este projeto. As frentes financeira, fiscal e de estoque hospitalar permanecem com o TOTVS e não serão duplicadas no CRM.'),
  bulletP('O site convencional do Tricopill permanece como está. Não há integração planejada com o site nesta proposta.'),

  H2('3.3. Equipe e atendimento'),
  bulletP('A Tricopill designará ao menos uma pessoa para atendimento humano quando o cliente solicitar override (sugestão: Ingrid). A IA só funciona como camada principal se houver fallback humano disponível.'),
  bulletP('A persona vendedora da IA Tricopill será definida em sessão de uma hora com Ingrid no início da Sprint 2.'),
  bulletP('Treinamento da equipe Tricopill (Ingrid e equipe operacional) está incluído no escopo da Sprint 6.'),

  H2('3.4. Volume estimado de operação'),
  bulletP('Volume inicial estimado: 100 a 300 pedidos por mês na Tricopill. A mensalidade dimensionada nesta proposta cobre este volume com folga.'),
  bulletP('Volume mensal acima de 800 pedidos: gatilho automático para revisão da mensalidade, justificado pelo crescimento proporcional do custo de IA.'),

  H2('3.5. Contas e credenciais de terceiros'),
  bulletP('Conta ManyChat existente com plano pago (no mínimo Starter). Para envio nativo de mídia, plano Pro será exigido (USD 15/mês adicional, pago pela Tricopill).'),
  bulletP('W-API já está em uso por Aline e Ingrid. Sem previsão de novas linhas neste projeto.'),
  bulletP('Conta Bling ativa com plano que permite acesso à API REST e configuração de webhook. Esta verificação será feita no kickoff da Sprint 1.'),
  bulletP('Conta em gateway de pagamento será criada ou ajustada pelo cliente até o início da Sprint 3.'),
  bulletP('Service account do Google com acesso de leitura à agenda das cirurgias do Instituto será configurada antes da Sprint 6.'),

  H2('3.6. Início e dependências críticas'),
  bulletP('Aceite formal da proposta e pagamento da primeira parcela do setup destravam o início da Sprint 1.'),
  bulletP('Atrasos em qualquer dependência de terceiros (Bling, gateway, ManyChat, Google) deslocam o cronograma proporcionalmente, com aviso prévio.'),
  bulletP('Decisões pendentes (gateway, persona, cashback, lista de produtos) têm recomendações default registradas na seção 8 desta proposta. Se o cliente não decidir até as datas indicadas, seguimos com as recomendações.'),
];

// ==========================================================================
// 4. ESCOPO
// ==========================================================================
function buildReuseTable() {
  const widths = [3360, 6000];
  const rows = [
    ['Módulo', 'O que ele faz e já está em produção'],
    ['Atendimento WhatsApp', 'Envio e recebimento de mensagens em tempo real com Evolution, Cloud API e W-API. Mesmas linhas operacionais já em uso (Aline, Ingrid, Dandara).'],
    ['Atendimento Instagram', 'Recebimento e envio de DMs com integração ManyChat. Roteamento automático e captura de leads.'],
    ['Núcleo de IA (Sofia)', 'Infraestrutura de IA já operacional, com prompt por instância, gestão de tokens, fallback entre provedores (OpenAI e Z.ai) e logs de conversa. Pronta para receber uma persona de vendedor Tricopill.'],
    ['Anti-banimento WhatsApp', 'Detecção automática de opt-out, bloqueio de envio para quem pediu parar, override humano auditado.'],
    ['Janela 24h e HUMAN_AGENT', 'Tratamento automático da janela de 24 horas da Meta. Fallback HUMAN_AGENT para estender o atendimento Instagram até 7 dias.'],
    ['Pipeline e kanban', 'Funil visual com etapas customizáveis, lead score, tags e filtros. Pronto para receber um pipeline próprio de e-commerce Tricopill.'],
    ['Ficha unificada do cliente', 'Histórico completo de interações por canal (WhatsApp + Instagram) na mesma timeline.'],
    ['Disparo NPS', 'Pesquisa de satisfação automática, captura de resposta e relatório.'],
    ['Analytics e dashboard', 'Funil, motivos de perda, métricas por SDR, tempo médio de resposta, ROI por canal. Pronto para receber a visão Tricopill.'],
    ['App instalável (PWA)', 'A equipe instala como aplicativo no celular e desktop, sem dependência de loja.'],
    ['Prontuário médico append-only', 'Registro com consentimento LGPD para o Instituto, com audit log de acesso.'],
    ['Multi-canal por linha', 'Cada linha (Dandara, Aline, Ingrid) tem instância isolada. A IA do Tricopill entra como nova persona sem interferir nas demais.'],
    ['Infraestrutura Supabase', 'Banco PostgreSQL, autenticação, edge functions e storage compartilhados pelo Tricopill sem custo adicional.'],
  ];
  return table2col(rows, widths);
}
function buildBuildTable() {
  const widths = [3360, 6000];
  const rows = [
    ['O que vai ser construído', 'Descrição'],
    ['Catálogo Tricopill no CRM', 'Cadastro completo dos produtos (nome, foto, descrição comercial, preço, estoque atual) com sincronização automática a partir do Bling.'],
    ['Vendedor IA conversacional ponta-a-ponta', 'Persona dedicada do Tricopill (diferente da Sofia do Instituto) que cumprimenta, descobre a necessidade do cliente, recomenda produto, conduz a venda, fecha o pedido e mantém o tom de venda em vez de tom clínico.'],
    ['Recomendação inteligente e cross-sell', 'A IA conhece o catálogo, sugere combinações ("quem leva o shampoo X normalmente leva o tônico Y") e adapta a oferta ao contexto da conversa.'],
    ['Carrinho conversacional e cálculo de frete', 'Montagem do pedido na própria conversa, confirmação de endereço, cálculo do frete por faixa de CEP, totalização final antes do pagamento.'],
    ['Gateway de pagamento por link', 'Geração automática de link Pix e cartão (Pagar.me recomendado — ver seção 8) entregue na conversa pela IA. Suporte a parcelamento.'],
    ['Confirmação automática de pagamento', 'Webhook do gateway atualiza o pedido no CRM, dispara a próxima etapa e libera as mensagens transacionais sem intervenção humana.'],
    ['Integração completa com Bling', 'Criação automática do pedido, baixa de estoque, emissão de nota fiscal, captura do código de rastreio, sincronização bidirecional dos produtos.'],
    ['Mensagens transacionais e rastreio', 'Disparo automático de "pedido recebido", "pagamento confirmado", "pedido em separação", "código de rastreio é X", "produto entregue, gostou?".'],
    ['Recomendação por histórico de compras', 'A IA lembra o que cada cliente já comprou, evita oferecer o mesmo item duas vezes seguidas, e sugere novos produtos coerentes com o padrão dele.'],
    ['Reposição automática inteligente', 'A IA estima quando o cliente provavelmente vai acabar o produto e volta sozinha oferecendo a recompra na hora certa, sem ser invasiva.'],
    ['Carrinho abandonado', 'Quando o cliente cotou mas não pagou em 24 horas, a IA volta sozinha com um lembrete e, se necessário, um cupom para destravar a venda. Tudo respeitando a janela 24h da Meta.'],
    ['Pesquisa pós-venda + relatório de mercado', 'A IA coleta sinais valiosos após a compra ("como conheceu?", "o que esperava?") e devolve em relatório no dashboard para ajustar campanhas e mix de produtos.'],
    ['Override humano sob demanda', 'Quando o cliente pede atendimento humano, a IA desliga e a conversa cai automaticamente para a Ingrid ou a pessoa responsável.'],
    ['Relatório Tricopill no dashboard', 'Nova seção no painel de analytics com vendas por dia, ticket médio, produtos mais vendidos, taxa de conversão de mensagem para venda, abandono de carrinho e clientes mais recorrentes.'],
    ['Cobrança automática de cirurgia (Instituto)', 'Bot lê a agenda Google das cirurgias e dispara, 10 dias antes, lembrete de pagamento com link. Se não pagar em 3 dias, envia o segundo lembrete. Não escreve na agenda em momento algum; apenas leitura.'],
    ['Aniversário e datas comemorativas (Instituto)', 'Disparo automático no aniversário do paciente, com mensagem personalizada, e em datas sazonais relevantes (Dia das Mães, Black Friday capilar, fim de ano). Segmentação por interesse.'],
    ['Indicação com cashback rastreável (Instituto)', 'Sistema que gera link único para cada paciente indicar amigos. Quando o indicado fecha, o paciente recebe crédito automático para usar em consultas ou produtos.'],
    ['Onboarding e treinamento da equipe', 'Sessões com Ingrid e equipe Tricopill para uso do novo fluxo, manual rápido em PDF e suporte assistido nas primeiras duas semanas pós go-live.'],
  ];
  return table2col(rows, widths);
}
function buildOutOfScopeTable() {
  const widths = [3360, 6000];
  const rows = [
    ['Fora do escopo', 'Onde resolve'],
    ['Conciliação bancária e DDA', 'TOTVS RP Saúde (já em implantação)'],
    ['Contas a pagar e a receber', 'TOTVS RP Saúde'],
    ['Entrada de nota fiscal de fornecedor (XML)', 'TOTVS RP Saúde'],
    ['Gestão de estoque do hospital (consumíveis cirúrgicos)', 'TOTVS RP Saúde'],
    ['Site institucional e e-commerce convencional Tricopill', 'Plataforma de site atual permanece'],
    ['Maquininha física de cartão', 'Rede e Inter permanecem como estão'],
    ['Emissão de NF-e do Instituto (serviços médicos)', 'TOTVS RP Saúde'],
    ['Licitação e cotação de pedidos de compra', 'TOTVS RP Saúde'],
  ];
  return table2col(rows, widths);
}

const ESCOPO = [
  H1NewPage('4. Escopo detalhado'),
  P('O escopo está dividido em três blocos: (a) o que já está pronto e operacional no CRM do Instituto e será reaproveitado sem custo adicional, (b) o que precisa ser construído especificamente para esta proposta, e (c) o que fica fora deste projeto.'),

  H2('4.1. O que já existe e será reaproveitado'),
  P('Estes módulos estão em produção e em uso pela equipe do Instituto Lorena hoje. Reaproveitá-los significa que o vendedor IA da Tricopill entra no ar muito mais rápido e mais barato do que se fosse construído do zero ou em uma plataforma terceirizada.'),
  buildReuseTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 240 } }),

  H2('4.2. O que será construído neste projeto'),
  P('Funcionalidades específicas do e-commerce 100% IA da Tricopill e das três expansões alinhadas para o Instituto.'),
  buildBuildTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 240 } }),

  H2('4.3. O que está fora do escopo'),
  P('Itens que ficam sob responsabilidade de outras frentes do negócio, registrados aqui para evitar dúvidas posteriores.'),
  buildOutOfScopeTable(),
];

// ==========================================================================
// 5. DETALHES TÉCNICOS DA ARQUITETURA
// ==========================================================================
const ARQUITETURA = [
  H1NewPage('5. Detalhes técnicos da arquitetura'),
  P('Esta seção descreve, em linguagem acessível mas explícita, como a solução funciona por baixo. Útil para o cliente entender o que está sendo construído, e para o time técnico do TOTVS ou de qualquer integração futura ter o ponto de partida.'),

  H2('5.1. Stack já em produção'),
  bulletP('Backend: Supabase com PostgreSQL como banco principal, Edge Functions em Deno (serverless), Auth nativo e Storage para mídia.'),
  bulletP('Frontend: React 19 + Vite + Tailwind CSS 4, instalável como PWA (aplicativo) no celular e desktop.'),
  bulletP('IA: OpenAI como provedor padrão, Z.ai como fallback configurável por instância. Seleção automática conforme custo e latência.'),
  bulletP('WhatsApp: três provedores conviventes — Evolution API (não oficial), WhatsApp Cloud API (oficial Meta) e W-API. Cada linha escolhe o seu.'),
  bulletP('Instagram: Meta Graph API com ManyChat como camada de roteamento de fluxos.'),
  bulletP('Hospedagem: Netlify para o frontend, Supabase para backend, Stripe para billing.'),

  H2('5.2. Fluxo do vendedor IA Tricopill (passo a passo)'),
  bulletP('Cliente envia mensagem no WhatsApp ou Instagram. O webhook recebe e cria ou recupera o lead Tricopill no CRM.'),
  bulletP('A IA Tricopill (persona dedicada, separada da Sofia do Instituto) detecta intenção: queixa capilar, interesse em produto, pedido de recomendação, dúvida operacional ou pedido de atendimento humano.'),
  bulletP('Se for venda: a IA consulta o catálogo Tricopill (sincronizado com Bling), propõe produto principal e, quando faz sentido, um cross-sell.'),
  bulletP('Cliente confirma: a IA pede endereço, valida CEP, calcula frete por faixa.'),
  bulletP('A IA totaliza o pedido e gera link de pagamento via gateway (Pagar.me recomendado). O link aparece na conversa.'),
  bulletP('Cliente paga: o webhook do gateway atualiza o pedido no CRM e dispara a integração Bling (cria pedido, baixa estoque, emite NF, captura rastreio).'),
  bulletP('Mensagens transacionais são disparadas automaticamente: "pedido recebido", "pagamento confirmado", "em separação", "código de rastreio é X", "entregue?".'),
  bulletP('Pós-venda: a IA coleta sinais de mercado ("como nos achou?") e armazena no dashboard.'),
  bulletP('Reposição automática: um cron diário identifica clientes próximos do "acabar produto" baseado em tempo médio de uso por tamanho de embalagem. A IA volta sozinha oferecendo recompra.'),

  H2('5.3. Fluxo da cobrança automática de cirurgia (Instituto)'),
  bulletP('Cron diário lê a agenda Google do Instituto (somente leitura, via service account autorizada).'),
  bulletP('Para cada evento "cirurgia" com data D+10, cria uma task de cobrança no CRM, vinculada ao paciente.'),
  bulletP('O bot WhatsApp consulta o valor da cirurgia (campo customizado no paciente) e dispara mensagem com link de pagamento (mesmo gateway da Tricopill).'),
  bulletP('Se o paciente não pagar em 3 dias, dispara o segundo lembrete automaticamente.'),
  bulletP('Pagamento confirmado: webhook do gateway fecha a task e atualiza o prontuário do paciente.'),
  bulletP('Se passar de D-3 sem pagamento, alerta visual aparece no dashboard da equipe para intervenção humana.'),

  H2('5.4. Fluxo de indicação com cashback'),
  bulletP('Cada paciente do Instituto recebe um link único de indicação, gerado uma vez e ativo permanentemente.'),
  bulletP('Quando alguém entra pelo link, o CRM cria um lead com referência ao paciente indicador (campo "referred_by").'),
  bulletP('Se o indicado fecha consulta ou compra, o CRM credita cashback automaticamente no paciente original.'),
  bulletP('O saldo de cashback é gerenciado em tabela própria com validade configurável (recomendação default: 90 dias).'),
  bulletP('Na próxima interação do paciente, a IA Sofia avisa o saldo disponível e oferece uso.'),
  bulletP('Todas as operações são transacionais (sem race condition) e auditáveis.'),

  H2('5.5. Segurança, LGPD e auditoria'),
  bulletP('RLS (Row-Level Security) do Supabase garante que cada conversa só seja vista por usuários autorizados, por tenant e por linha.'),
  bulletP('Audit log de acessos ao prontuário já existe no CRM e cobre a operação Tricopill automaticamente.'),
  bulletP('Consentimento LGPD coletado no primeiro contato e armazenado em "patient_consents". Sem consentimento, sem disparo automático.'),
  bulletP('Opt-out automatizado: detecção de "não me mande mais", "pare", "sair" → bloqueio permanente do lead com override humano apenas via auditoria.'),
  bulletP('Anti-banimento WhatsApp: janela de 24h da Meta é respeitada; HUMAN_AGENT entra como fallback automático no Instagram.'),
  bulletP('Cashback gerenciado com transações atômicas no Postgres, garantindo que não há duplo crédito por concorrência.'),
  bulletP('Credenciais de terceiros (Bling, gateway, Google) armazenadas em Supabase Secrets, nunca no código nem no banco aberto.'),
];

// ==========================================================================
// 6. CRONOGRAMA
// ==========================================================================
function buildSprintsTable() {
  const widths = [1080, 2280, 6000];
  const rows = [
    ['Sprint', 'Duração', 'Entregas'],
    ['1', '1 semana', 'Catálogo Tricopill no CRM. Sincronização inicial com Bling (leitura de produtos e estoque). Pipeline e-commerce dedicado. Verificação do plano Bling e configuração do webhook.'],
    ['2', '2 semanas', 'Vendedor IA conversacional Tricopill (persona, prompt dedicado, fluxo de descoberta, recomendação, cross-sell). Override humano sob demanda. Sessão de definição de persona com Ingrid.'],
    ['3', '2 semanas', 'Carrinho conversacional, cálculo de frete, geração de link de pagamento, webhook de confirmação, integração completa com Bling (pedido, NF, baixa estoque, rastreio).'],
    ['4', '1 semana', 'Mensagens transacionais automatizadas, recomendação por histórico de compras, reposição automática inteligente, carrinho abandonado.'],
    ['5', '1 semana', 'Pesquisa pós-venda + relatório de mercado, dashboard Tricopill expandido com vendas, ticket médio, abandono de carrinho e clientes recorrentes.'],
    ['6', '1 semana', 'Expansões Instituto: cobrança automática de cirurgia 10 dias antes, aniversário e datas comemorativas, indicação com cashback rastreável. Treinamento, manual e go-live monitorado.'],
    ['Total', '8 semanas', 'E-commerce 100% IA Tricopill em operação completa, do primeiro contato à entrega, mais três frentes adicionais do Instituto entregues.'],
  ];
  return table3col(rows, widths);
}

const CRONOGRAMA = [
  H1NewPage('6. Cronograma de implantação'),
  P('Estimativa de 8 semanas corridas a partir da assinatura da proposta e do pagamento da primeira parcela do setup. Sprints semanais com demonstração ao final de cada uma para validação conjunta.'),
  buildSprintsTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
  P([
    new TextRun({ text: 'Observação: ', bold: true }),
    new TextRun({ text: 'as datas exatas dependem da disponibilidade das integrações de terceiros (token do Bling, conta no gateway de pagamento, acesso à agenda Google das cirurgias, conta ManyChat com plano Pro quando necessário). Atrasos em qualquer um destes itens deslocam o cronograma proporcionalmente.' }),
  ]),
];

// ==========================================================================
// 7. CRITÉRIOS DE SUCESSO E METAS
// ==========================================================================
function buildMetricsTable() {
  const widths = [4000, 2400, 2960];
  const rows = [
    ['Métrica', 'Meta após 90 dias', 'Como medimos'],
    ['Taxa de resposta da IA Tricopill sem intervenção humana', '≥ 95%', 'Razão entre conversas totalmente automatizadas e conversas com handoff humano.'],
    ['Conversão de cotação em venda', '≥ 25%', 'Número de pedidos pagos sobre número de cotações geradas pela IA.'],
    ['Tempo médio de resposta da IA', '≤ 8 segundos', 'Logs de timestamp entre mensagem do cliente e resposta da IA.'],
    ['Carrinhos abandonados recuperados', '≥ 15%', 'Pedidos fechados após acionamento automático do fluxo de carrinho abandonado.'],
    ['Reposições automáticas convertidas', '≥ 30% dos disparos', 'Compras feitas dentro de 7 dias após disparo de reposição automática.'],
    ['NPS Tricopill ≥ 8 (notas 8, 9 ou 10)', '≥ 70% das respostas', 'Pesquisa pós-venda automática.'],
    ['Cobranças de cirurgia pagas até D-3 (Instituto)', '≥ 80%', 'Tasks de cobrança Instituto fechadas antes de D-3.'],
    ['Indicações convertidas por paciente indicador (Instituto)', '≥ 0,5 em 6 meses', 'Conversões fechadas vindas de links de indicação ativos.'],
  ];
  return table3col(rows, widths);
}

const METAS = [
  H1NewPage('7. Critérios de sucesso e metas mensuráveis'),
  P('Esta seção define como o sucesso do projeto será medido. As metas abaixo são compromissos de operação após o go-live e ferramentas para o cliente acompanhar o retorno do investimento.'),
  buildMetricsTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
  P([
    new TextRun({ text: 'Como será acompanhado: ', bold: true }),
    new TextRun({ text: 'todas estas métricas ficam visíveis no dashboard de analytics, acessível a qualquer momento pelo cliente. Relatórios mensais consolidados serão entregues por e-mail ou WhatsApp nos primeiros 6 meses pós go-live. Se alguma meta ficar abaixo do alvo por 60 dias consecutivos, abrimos plano de ajuste sem custo adicional.' }),
  ]),
];

// ==========================================================================
// 8. DECISÕES PENDENTES
// ==========================================================================
function buildDecisionsTable() {
  const widths = [2160, 4800, 2400];
  const rows = [
    ['Decisão', 'Opções e análise', 'Recomendação do fornecedor'],
    [
      'Gateway de pagamento',
      'Pagar.me (Stone): taxa Pix ~0,99%, cartão ~3,49% à vista, API estável, webhook confiável.\nInterPag: taxa Pix ~0,79%, cartão ~3,99% à vista, integrado ao banco Inter (que vocês já usam).\nStripe: taxa cartão ~3,99%, melhor para vendas internacionais, dashboard sofisticado.',
      'Pagar.me. Melhor relação taxa/estabilidade no Brasil para PME, API madura, suporte em português, integração com Bling já validada em outros projetos.',
    ],
    [
      'Nome da persona vendedora IA Tricopill',
      '"Bia": nome curto, feminino, fácil de lembrar, tom amigável-vendedor.\n"Camila": nome com mais peso, transmite confiança.\n"Helô": nome mais descontraído, perfil jovem.\nA persona será sempre claramente identificada como IA na primeira mensagem (transparência LGPD).',
      '"Bia". Funciona bem com público feminino majoritário do Tricopill, soa próximo sem ser infantil, e diferencia bem da Sofia (que segue exclusiva do Instituto, tom clínico).',
    ],
    [
      'Regulamento do cashback',
      'Percentual do cashback (3%, 5%, 10% da primeira compra do indicado).\nValidade do crédito (30, 60, 90 dias).\nMínimo de uso (R$ 10, R$ 20, R$ 50).\nLimite de cashback por paciente (acumulável ou cap mensal).',
      '5% da primeira compra ou consulta do indicado, válido por 90 dias, mínimo de R$ 20 para uso, sem cap. Equilibra custo de aquisição e incentivo real.',
    ],
    [
      'Volume estimado de pedidos/mês (Tricopill)',
      'Define o dimensionamento de tokens da IA e o gatilho de revisão da mensalidade.\nEstimativas: 100 (conservador), 200 (médio), 500 (otimista).',
      'Começar com estimativa de 200 pedidos/mês para dimensionamento. Revisar com dados reais após 60 dias de operação.',
    ],
    [
      'Lista inicial de produtos no catálogo',
      'Catálogo completo (todos os produtos): mais trabalho de cadastro, melhor cobertura.\nTop 20 mais vendidos: implantação rápida, foco no que gera receita.\nTop 50: meio-termo razoável.',
      'Top 20 produtos mais vendidos para a Sprint 1, expansão progressiva. A IA aprende com os 20 e o restante entra em lotes a partir da Sprint 4.',
    ],
  ];
  return table3col(rows, widths);
}

const DECISOES = [
  H1NewPage('8. Decisões pendentes antes do go-live'),
  P('Esta seção documenta as decisões que precisam ser tomadas pelo cliente para o projeto avançar, com análise das opções e recomendação explícita do fornecedor. Se o cliente não decidir até a Sprint onde a decisão é necessária, seguimos com a recomendação registrada para não bloquear o cronograma.'),
  buildDecisionsTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
  P([
    new TextRun({ text: 'Como confirmar uma decisão: ', bold: true }),
    new TextRun({ text: 'basta confirmação por escrito (e-mail, WhatsApp ou anotação em ata da reunião de kickoff). Não há necessidade de aditivo contratual para confirmar decisões dentro do escopo desta proposta.' }),
  ]),
];

// ==========================================================================
// 9. RISCOS E MITIGAÇÕES
// ==========================================================================
function buildRisksTable() {
  const widths = [3000, 1300, 1300, 3760];
  const rows = [
    ['Risco', 'Probabilidade', 'Impacto', 'Mitigação'],
    ['API do Bling com endpoints inconsistentes ou mudança não anunciada', 'Média', 'Alto', 'Sprint 3 dedicada à integração com retry + fila + monitoramento. Plano B: importação manual em CSV até regularização.'],
    ['Mudanças na política de janela 24h da Meta', 'Alta', 'Médio', 'HUMAN_AGENT já implementado, monitoramento mensal de policy updates. Em última instância, atendimento humano absorve.'],
    ['Estouro de quota de tokens da IA em pico de venda', 'Média', 'Médio', 'Fallback automático OpenAI ↔ Z.ai já configurado. Alerta no dashboard quando uso atinge 80% do limite mensal.'],
    ['Carrinho abandonado vira spam e gera ban no WhatsApp', 'Baixa', 'Alto', 'Anti-banimento em produção. Cap de 1 mensagem de carrinho abandonado por 24h por lead. Opt-out automático.'],
    ['Fraude no programa de cashback (auto-indicação, multi-conta)', 'Média', 'Médio', 'Cashback só credita após primeira compra confirmada e paga. Registro de IP/dispositivo do indicado. Auditoria manual de casos suspeitos.'],
    ['Cliente não decide gateway até Sprint 3', 'Média', 'Médio', 'Default Pagar.me já registrado. Sprint 1 e 2 podem rodar sem essa decisão.'],
    ['Equipe Tricopill resiste à mudança operacional', 'Baixa', 'Alto', 'Onboarding com Ingrid já na Sprint 1, antes do go-live. Suporte direto via WhatsApp nas duas primeiras semanas.'],
    ['Gargalo de atendimento humano quando IA repassa muitos casos simultaneamente', 'Baixa', 'Médio', 'Métrica de "% repasse humano" acompanhada semanalmente. Se > 10%, ajuste de prompt e treinamento adicional.'],
    ['Indisponibilidade do Supabase ou do gateway', 'Baixa', 'Alto', 'SLA do Supabase é 99,9%. Em caso de fora do ar, mensagens entram em fila e são processadas quando o serviço volta. Operação humana via override segue funcionando.'],
  ];
  return table4col(rows, widths);
}

const RISCOS = [
  H1NewPage('9. Riscos identificados e mitigações'),
  P('Lista de riscos conhecidos com a estratégia de mitigação para cada um. Esta seção é viva: novos riscos identificados durante a implantação são incorporados sem necessidade de aditivo.'),
  buildRisksTable(),
];

// ==========================================================================
// 10. MODELO COMERCIAL
// ==========================================================================
function buildPricingTable() {
  const widths = [3600, 5760];
  const rows = [
    ['Item', 'Valor'],
    ['Setup único (implantação completa do escopo descrito)', 'R$ 52.000,00 em até 3x sem juros, com 50% no início e o restante distribuído nas entregas das sprints 3 e 6.'],
    ['Mensalidade após go-live', 'R$ 4.800,00 por mês, com primeiro mês cobrado 30 dias após o go-live.'],
  ];
  return table2col(rows, widths);
}
function buildIncludedTable() {
  const widths = [3000, 6360];
  const rows = [
    ['Componente', 'O que cobre'],
    ['Suporte técnico', 'Horário comercial (8h-18h em dia útil), SLA de retorno em até 4 horas úteis para problemas críticos com operação parada. Canal de suporte direto via WhatsApp + e-mail.'],
    ['Manutenção corretiva', 'Correção de bugs identificados após o go-live, sem custo adicional, sem limite.'],
    ['Pequenos ajustes', 'Novos campos, novas tags, ajustes em mensagens automáticas, novos fluxos simples (até 4h de trabalho por mês).'],
    ['Infraestrutura Supabase', 'Banco PostgreSQL, edge functions e storage compartilhados com a operação do Instituto, sem custo adicional para a Tricopill.'],
    ['Tokens de IA', 'Custos da OpenAI ou Z.ai dentro do volume típico esperado (até 800 pedidos/mês). Acima disso, revisão.'],
    ['Atualizações de segurança e melhorias do CRM', 'Aplicadas automaticamente. A Tricopill se beneficia de qualquer melhoria desenvolvida para o Instituto.'],
  ];
  return table2col(rows, widths);
}
function buildExcludedTable() {
  const widths = [3000, 6360];
  const rows = [
    ['Custo de terceiro (pago direto)', 'Faixa de valor'],
    ['Taxas do gateway de pagamento (Pagar.me, InterPag ou Stripe)', '1,99% a 3,99% por transação, pago no faturamento do gateway.'],
    ['Mensalidade do Bling', 'Mantida no plano que a Tricopill já tem.'],
    ['Plano ManyChat Pro (quando necessário para mídia nativa)', 'USD 15/mês.'],
    ['Plano W-API', 'Custo atual mantido por linha. Sem previsão de nova linha neste projeto.'],
    ['Gateway de SMS de fallback (se contratado no futuro)', 'Variável conforme provedor escolhido.'],
  ];
  return table2col(rows, widths);
}

const COMERCIAL = [
  H1NewPage('10. Modelo comercial e investimento'),
  P('O modelo escolhido é setup único somado a mensalidade fixa, sem fee por venda. O investimento principal é desenvolvimento e integração; a mensalidade cobre manutenção, suporte, custos de IA e infraestrutura compartilhada.'),
  buildPricingTable(),

  H2('10.1. O que está incluído na mensalidade'),
  buildIncludedTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),

  H2('10.2. O que NÃO está incluído (custos de terceiros)'),
  P('Os itens abaixo são pagos pela Tricopill diretamente aos respectivos provedores, fora desta proposta.'),
  buildExcludedTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),

  H2('10.3. O que motiva ajuste futuro da mensalidade'),
  bulletP('Volume mensal de vendas superior a 800 pedidos no Tricopill: revisão da mensalidade para cobrir o custo proporcional da IA, que cresce com o número de conversas completas.'),
  bulletP('Solicitação de nova funcionalidade fora do escopo desta proposta: orçada à parte como projeto adicional.'),
  bulletP('Mudança de gateway de pagamento depois de implantado: reorçada em horas avulsas conforme o esforço de integração.'),
  bulletP('Adição de novas linhas de produto ou novas marcas que precisem de persona de IA separada.'),

  H2('10.4. Como o investimento se justifica'),
  bulletP('Setup R$ 52.000: equivale a aproximadamente 320 horas de desenvolvimento sênior em escopo de IA pesada e integrações de terceiros. Está no meio da faixa de mercado de agências e software houses para projetos comparáveis.'),
  bulletP('Mensalidade R$ 4.800: cobre suporte técnico real, manutenção contínua, atualizações de segurança, custos de IA (que aumentam linearmente com o volume), infraestrutura Supabase compartilhada e ajustes contínuos de prompt e fluxo.'),
  bulletP('Comparação prática: uma plataforma de e-commerce convencional com IA básica plus integração Bling custaria R$ 1.500 a 3.000 por mês de SaaS, mais R$ 30 a 80 mil de implementação personalizada, sem o nível de personalização e integração nativa que este projeto entrega.'),
];

// ==========================================================================
// 11. PRÓXIMOS PASSOS
// ==========================================================================
const PROXIMOS_PASSOS = [
  H1NewPage('11. Próximos passos e garantias'),
  H2('11.1. Para começarmos a Sprint 1'),
  bulletP('Aceite formal desta proposta (assinatura ao final do documento ou confirmação por e-mail).'),
  bulletP('Pagamento da primeira parcela do setup (50% = R$ 26.000).'),
  bulletP('Acesso ao painel do Bling (usuário com permissão de leitura e escrita).'),
  bulletP('Confirmação ou ajuste das decisões pendentes registradas na seção 8 (ou ciência das recomendações default).'),
  bulletP('Lista atualizada dos produtos Tricopill com preços, fotos e descrições comerciais (planilha CSV ou Excel resolve).'),
  bulletP('Agendamento da sessão de definição de persona vendedora (1h com Ingrid) para o início da Sprint 2.'),
  bulletP('Compartilhamento da agenda Google das cirurgias do Instituto com a conta de serviço do CRM (sem permissão de escrita) — pode ser feito até a Sprint 6.'),
  bulletP('Definição do regulamento do programa de indicação (ou aceite da recomendação default) — pode ser feito até a Sprint 6.'),

  H2('11.2. Garantias'),
  bulletP('Operação atual do Instituto Lorena continua funcionando sem interrupções durante toda a implantação Tricopill.'),
  bulletP('Caso uma sprint não entregue o combinado dentro do prazo, a sprint seguinte tem seu prazo absorvendo a diferença sem custo adicional.'),
  bulletP('Em qualquer momento dos primeiros 30 dias após o go-live, ajustes de qualquer item entregue são absorvidos pela mensalidade sem aviso prévio.'),
  bulletP('Em caso de queda da operação do vendedor IA por bug nosso (não por problema de terceiros), atendimento humano via override é garantido como plano B imediato.'),
  bulletP('Se alguma métrica da seção 7 ficar abaixo da meta por 60 dias consecutivos, abrimos plano de ajuste sem custo adicional.'),

  H2('11.3. Confidencialidade'),
  P('Esta proposta e todas as informações de operação trocadas durante o projeto são confidenciais e de uso exclusivo das partes. Acessos a sistemas de terceiros (Bling, Google, Meta, gateway de pagamento) ficam sob credenciais próprias da Tricopill e podem ser revogados a qualquer momento.'),

  H2('11.4. Encerramento do contrato'),
  bulletP('A Tricopill pode encerrar a relação contínua (mensalidade) a qualquer momento com 30 dias de aviso prévio.'),
  bulletP('Em caso de encerramento, todo o código construído fica disponível para a Tricopill em um repositório Git próprio, sem custo adicional.'),
  bulletP('Dados operacionais (clientes, pedidos, histórico) são exportados em formato CSV/JSON em até 7 dias úteis.'),
  bulletP('A Tricopill assume responsabilidade pela operação a partir da data de encerramento; o fornecedor não é mais responsável por bugs, ajustes ou disponibilidade.'),
];

// ==========================================================================
// 12. ACEITE
// ==========================================================================
const ACEITE = [
  H1NewPage('12. Aceite'),
  P('Declaramos ciência e aceite das condições descritas nesta proposta comercial, incluindo escopo, cronograma, premissas, riscos, decisões pendentes (com ciência das recomendações default) e investimento.'),
  new Paragraph({ spacing: { before: 720 }, children: [new TextRun({ text: '' })] }),
  P([new TextRun({ text: '_________________________________________', size: 22 })]),
  P([new TextRun({ text: 'Tricopill / Limitless — Responsável', bold: true, size: 22 })]),
  P([new TextRun({ text: 'Nome:', size: 22 }), new TextRun({ text: '   ____________________________________', size: 22 })]),
  P([new TextRun({ text: 'CPF / CNPJ:', size: 22 }), new TextRun({ text: '   _______________________________', size: 22 })]),
  P([new TextRun({ text: 'Data:', size: 22 }), new TextRun({ text: '   ____ / ____ / ________', size: 22 })]),
  new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '' })] }),
  P([new TextRun({ text: '_________________________________________', size: 22 })]),
  P([new TextRun({ text: 'Álvaro Carlisbino — Fornecedor', bold: true, size: 22 })]),
  P([new TextRun({ text: 'Data:', size: 22 }), new TextRun({ text: '   ____ / ____ / ________', size: 22 })]),
];

// ==========================================================================
// 13. GLOSSÁRIO
// ==========================================================================
function buildGlossaryTable() {
  const widths = [2400, 6960];
  const rows = [
    ['Termo', 'Significado'],
    ['CRM', 'Sistema de gestão de relacionamento com o cliente. No nosso caso, a plataforma já em produção no Instituto Lorena, que será expandida para atender a Tricopill.'],
    ['IA / Inteligência Artificial', 'Modelos de linguagem (OpenAI GPT, Z.ai) usados como cérebro do vendedor automatizado, capazes de entender mensagens em texto e gerar respostas em contexto.'],
    ['Persona', 'Identidade da IA, com nome, tom de voz e regras de comportamento. A Sofia é a persona do Instituto (tom clínico). A persona vendedora da Tricopill será definida em sessão com Ingrid.'],
    ['ManyChat', 'Plataforma intermediária que conecta o Instagram da Meta ao nosso CRM. Permite roteamento de fluxos e respostas automáticas. Já está em uso no Instituto.'],
    ['Evolution / W-API / Cloud API', 'Os três provedores diferentes de WhatsApp que o CRM suporta. Evolution é não oficial (mais barato), Cloud API é oficial da Meta (mais estável), W-API é alternativa nacional já em uso por Aline e Ingrid.'],
    ['HUMAN_AGENT', 'Tag da Meta que estende a janela de mensagem direta no Instagram para 7 dias quando o atendimento é claramente humano. Já implementada no CRM.'],
    ['Janela 24h', 'Política da Meta que só permite mensagens diretas (DM) ativas em até 24h após a última mensagem do cliente. Fora dela, exige HUMAN_AGENT ou outro tag específico.'],
    ['Bling', 'ERP de varejo brasileiro. A Tricopill já usa para controle de estoque, NF e rastreio. Esta proposta integra o CRM ao Bling via API REST.'],
    ['Gateway de pagamento', 'Serviço que processa pagamento por link, separado do banco. Pagar.me, InterPag e Stripe são as três opções avaliadas (ver seção 8).'],
    ['Pix', 'Sistema brasileiro de pagamento instantâneo. Suportado nativamente por todos os gateways considerados.'],
    ['NPS', 'Net Promoter Score, índice de satisfação do cliente medido por uma única pergunta ("de 0 a 10, quanto recomendaria?"). Notas 9-10 são promotores, 7-8 neutros, 0-6 detratores.'],
    ['Opt-out', 'Solicitação explícita do cliente para parar de receber mensagens. Detectado automaticamente pelo CRM e bloqueio é aplicado de forma permanente.'],
    ['SLA', 'Service Level Agreement, acordo de tempo de resposta. Esta proposta usa SLA de 4 horas úteis para problemas críticos.'],
    ['PWA', 'Progressive Web App, aplicativo que pode ser instalado no celular ou desktop diretamente do navegador, sem passar por loja. Já implementado no CRM do Instituto.'],
    ['Supabase', 'Plataforma de backend que combina PostgreSQL, autenticação, edge functions (serverless) e storage. Hospeda toda a operação do CRM.'],
    ['RLS', 'Row-Level Security, mecanismo do PostgreSQL que protege cada linha do banco por usuário. Garante que uma conversa não seja vista por quem não deveria.'],
    ['Edge Function', 'Pequeno programa que roda no servidor sob demanda. No nosso caso, em Deno (TypeScript). Usado para processar webhooks, integrações e tarefas em segundo plano.'],
    ['Webhook', 'Endpoint HTTP que recebe notificação automática de eventos (pagamento confirmado, mensagem recebida, etc.). É como o sistema externo nos avisa sobre algo.'],
    ['Cross-sell / Upsell', 'Cross-sell é sugerir produto complementar ("quem leva X também leva Y"). Upsell é sugerir versão maior ou premium ("por R$ 10 a mais, leva o tamanho família").'],
    ['Cashback', 'Devolução de parte do valor pago como crédito. Neste projeto, usado como recompensa por indicação convertida.'],
    ['Cron / Cron job', 'Tarefa que roda automaticamente em horário programado (diário, semanal, etc.). Usado para reposição automática, cobrança de cirurgia e disparos de aniversário.'],
    ['Service account', 'Conta especial usada por sistemas (não por pessoas) para acessar serviços de terceiros. No caso, usada para ler a agenda Google das cirurgias.'],
    ['Override humano', 'Quando a IA detecta que o cliente quer falar com pessoa e desliga, repassando a conversa para a equipe humana.'],
    ['Token', 'Unidade de medida do uso de IA. Cada palavra processada equivale a aproximadamente 1,3 tokens. O custo da IA é proporcional ao número de tokens consumidos.'],
  ];
  return table2col(rows, widths);
}

const GLOSSARIO = [
  H1NewPage('13. Glossário de termos técnicos'),
  P('Lista de termos usados ao longo desta proposta. Útil para qualquer pessoa do time da Tricopill ou do TOTVS que precise ler o documento sem precisar perguntar significados.'),
  buildGlossaryTable(),
];

// ==========================================================================
// DOCUMENT
// ==========================================================================
const doc = new Document({
  creator: 'Álvaro Carlisbino',
  title: 'Proposta E-commerce 100% IA Tricopill — Instituto Lorena',
  description: 'Proposta comercial completa de e-commerce 100% IA para a Tricopill e expansões do Instituto Lorena, com detalhamento técnico, premissas, métricas, decisões pendentes, riscos, modelo comercial e glossário.',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: COLOR_PRIMARY },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: COLOR_ACCENT },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 240 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Proposta E-commerce IA Tricopill — Instituto Lorena Visentainer (v3)', size: 18, color: COLOR_MUTED })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'Álvaro Carlisbino — Junho/2026', size: 18, color: COLOR_MUTED }),
            new TextRun({ text: '\tPágina ', size: 18, color: COLOR_MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: COLOR_MUTED }),
            new TextRun({ text: ' de ', size: 18, color: COLOR_MUTED }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: COLOR_MUTED }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
        })],
      }),
    },
    children: [
      ...COVER,
      ...INDICE,
      ...SUMARIO_EXECUTIVO,
      ...CONTEXTO_DESAFIO,
      ...PREMISSAS,
      ...ESCOPO,
      ...ARQUITETURA,
      ...CRONOGRAMA,
      ...METAS,
      ...DECISOES,
      ...RISCOS,
      ...COMERCIAL,
      ...PROXIMOS_PASSOS,
      ...ACEITE,
      ...GLOSSARIO,
    ],
  }],
});

const outDocx = path.resolve(process.env.HOME, 'Downloads/Proposta_Tricopill_Instituto_Lorena_v3.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outDocx, buffer);
  console.log('OK:', outDocx);
});
