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
const COLOR_OK      = '0F8A4F';
const COLOR_TABLE_H = '1F3A5F';
const COLOR_TABLE_R = 'F3F4F6';
const COLOR_BORDER  = 'CBD5E1';

const thin = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };
const tableW = 9360;

function P(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, ...(opts.run || {}) })];
  return new Paragraph({
    children: runs,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: opts.line ?? 300 },
    alignment: opts.align ?? AlignmentType.LEFT,
  });
}
function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, children: [new TextRun({ text })],
    spacing: { before: 360, after: 180 },
  });
}
function H1NewPage(text) {
  return new Paragraph({
    pageBreakBefore: true, heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })], spacing: { before: 0, after: 180 },
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, children: [new TextRun({ text })],
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
    borders: cellBorders, width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: COLOR_TABLE_H, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })] })],
  });
}
function bodyCell(text, widthDxa, opts = {}) {
  const fill = opts.alt ? COLOR_TABLE_R : 'FFFFFF';
  const runs = Array.isArray(text)
    ? text.map((t) => new TextRun({ text: t.text, bold: t.bold, italics: t.italics, size: 20, color: t.color }))
    : [new TextRun({ text, size: 20 })];
  return new TableCell({
    borders: cellBorders, width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    children: [new Paragraph({ children: runs })],
  });
}
function table2col(rows, widths) {
  return new Table({
    width: { size: tableW, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => {
      if (i === 0) return new TableRow({ children: [headerCell(r[0], widths[0]), headerCell(r[1], widths[1])] });
      const alt = i % 2 === 0;
      return new TableRow({
        children: [
          bodyCell([{ text: r[0], bold: true }], widths[0], { alt }),
          bodyCell(r[1], widths[1], { alt }),
        ],
      });
    }),
  });
}
function table3col(rows, widths) {
  return new Table({
    width: { size: tableW, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => {
      if (i === 0) return new TableRow({ children: [headerCell(r[0], widths[0]), headerCell(r[1], widths[1]), headerCell(r[2], widths[2])] });
      const alt = i % 2 === 0;
      return new TableRow({
        children: [
          bodyCell([{ text: r[0], bold: true }], widths[0], { alt }),
          bodyCell(r[1], widths[1], { alt }),
          bodyCell([{ text: r[2], color: r[2] === 'Em produção' ? COLOR_OK : undefined, bold: r[2] === 'Em produção' }], widths[2], { alt }),
        ],
      });
    }),
  });
}

// ========================================================================
// CAPA
// ========================================================================
const COVER = [
  new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: '' })] }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: 'RELATÓRIO TÉCNICO-OPERACIONAL', size: 28, color: COLOR_ACCENT, bold: true, characterSpacing: 80 })],
    spacing: { after: 80 },
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: 'CRM Instituto Lorena Visentainer', size: 56, bold: true, color: COLOR_PRIMARY })],
    spacing: { after: 160 },
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({
      text: 'Estado atual do sistema, módulos em produção, métricas de operação e histórico de entregas. Documento técnico-comercial para apresentação a terceiros.',
      size: 24, color: COLOR_MUTED, italics: true,
    })],
    spacing: { after: 600, line: 340 },
  }),
  new Paragraph({ children: [new TextRun({ text: 'Cliente: ', bold: true, size: 22 }), new TextRun({ text: 'Instituto Lorena Visentainer — Clínica de transplante e tratamentos capilares, Maringá / PR', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Fornecedor: ', bold: true, size: 22 }), new TextRun({ text: 'Álvaro Carlisbino — Desenvolvimento e operação do CRM', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Período de operação: ', bold: true, size: 22 }), new TextRun({ text: 'Implantação iniciada em abril de 2026, em operação contínua desde então.', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Data deste relatório: ', bold: true, size: 22 }), new TextRun({ text: 'Junho de 2026', size: 22 })], spacing: { after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: 'Audiência: ', bold: true, size: 22 }), new TextRun({ text: 'Decisores que avaliam expansão do sistema para empresas associadas (Tricopill/Limitless).', size: 22 })], spacing: { after: 600 } }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ========================================================================
// ÍNDICE
// ========================================================================
const INDICE = [
  H1('Índice'),
  bulletP('1. Sumário executivo'),
  bulletP('2. Visão geral da operação'),
  bulletP('3. Módulos em produção'),
  bulletP('4. Stack técnico'),
  bulletP('5. Linha do tempo das entregas'),
  bulletP('6. Segurança, LGPD e auditoria'),
  bulletP('7. Operação contínua e disponibilidade'),
  bulletP('8. O que vem a seguir'),
];

// ========================================================================
// 1. SUMÁRIO EXECUTIVO
// ========================================================================
const SUMARIO = [
  H1NewPage('1. Sumário executivo'),
  P('O CRM do Instituto Lorena Visentainer é um sistema sob medida, desenvolvido do zero entre abril e junho de 2026 para substituir o atendimento manual via planilhas e aplicativos de mensagem soltos por uma operação centralizada, com IA, multi-canal e analytics.'),
  P('O sistema está em produção contínua desde abril, sendo usado todos os dias pela equipe de atendimento da clínica (gerência, consultoras Dandara, Aline e Ingrid) para receber pacientes pelos canais WhatsApp e Instagram, qualificar leads via IA (a assistente Sofia), agendar consultas, conduzir o funil de venda do procedimento e fazer follow-up.'),
  P('Diferente de SaaS de prateleira (RD Station, Pipedrive, Kommo), este CRM foi construído para o vocabulário e o fluxo específicos da clínica capilar: campos como "tipo de consulta", "médico responsável", "faixa de investimento da cirurgia"; pipelines separados para transplante masculino, feminino e tratamentos clínicos; integração nativa com WhatsApp (três provedores conviventes), Instagram via ManyChat, agenda, prontuário médico com LGPD e NPS pós-procedimento.'),
  P('A entrega segue ritmo de release por sprint (até 6 sprints fechadas no período), com 44 migrations de banco, 20 funções de servidor e 27 telas de aplicativo entregues. O sistema é instalável como aplicativo (PWA) tanto em celular quanto em desktop, sem dependência de loja.'),
  P('Este relatório descreve em detalhe o que está em produção hoje. É a base para discutir a expansão da plataforma para a empresa irmã Tricopill / Limitless, cuja proposta comercial específica é documento separado.'),
];

// ========================================================================
// 2. VISÃO GERAL
// ========================================================================
const VISAO_GERAL = [
  H1NewPage('2. Visão geral da operação'),

  H2('2.1. Cliente e operação'),
  bulletP('Instituto Lorena Visentainer — clínica especializada em transplante e tratamentos capilares, sediada em Maringá / PR.'),
  bulletP('Operação de atendimento ao paciente concentrada em WhatsApp e Instagram, com fluxo: lead chega → IA Sofia atende e qualifica → handoff para consultora humana → agendamento → consulta → procedimento → pós-procedimento → NPS.'),
  bulletP('A equipe administrativa usa o CRM como ferramenta principal de trabalho diário, substituindo planilhas Excel e aplicativos de mensagem soltos.'),

  H2('2.2. Equipe que usa o sistema hoje'),
  bulletP('Gerência: visão completa de todos os canais e leads, configurações, métricas e relatórios.'),
  bulletP('Consultora Dandara: atendimento humano principal do WhatsApp do Instituto.'),
  bulletP('Consultoras Aline e Ingrid: linhas WhatsApp dedicadas, com instâncias W-API próprias.'),
  bulletP('IA Sofia: assistente automatizada que atende inicialmente e qualifica antes do handoff humano.'),
  bulletP('Cada consultora tem seu próprio painel, com filtro de leads atribuídos, métricas individuais e separação clara de instância (mensagem de uma linha não cai na caixa da outra).'),

  H2('2.3. Canais de atendimento ativos'),
  bulletP('WhatsApp via Evolution API (provedor não oficial, baixo custo) — linhas legadas do Instituto.'),
  bulletP('WhatsApp via WhatsApp Cloud API (provedor oficial Meta) — para linhas que precisam do selo de verificação ou volume alto.'),
  bulletP('WhatsApp via W-API (provedor nacional alternativo) — usado por Aline e Ingrid desde junho/2026.'),
  bulletP('Instagram via ManyChat — entrada de leads pelo perfil oficial do Instituto, com roteamento automatizado.'),
  bulletP('Os três provedores convivem no mesmo sistema; o CRM decide automaticamente qual usar para cada lead com base na linha vinculada.'),

  H2('2.4. Status'),
  bulletP('Em produção contínua desde abril de 2026 (aproximadamente 7 semanas no momento deste relatório).'),
  bulletP('Mais de 60 releases já entregues (sprints fechadas, fixes operacionais, melhorias de UI/UX).'),
  bulletP('Última correção crítica em 8 de junho de 2026 (atualização do fluxo de janela 24h da Meta e correção de mesclagem de leads homônimos).'),
];

// ========================================================================
// 3. MÓDULOS EM PRODUÇÃO
// ========================================================================
function buildModulesTable() {
  const widths = [2520, 4920, 1920];
  const rows = [
    ['Módulo', 'O que faz', 'Status'],
    ['Inbox multi-canal', 'Caixa de entrada unificada com WhatsApp e Instagram na mesma tela. Cada conversa mostra timeline completa, badges de canal, tempo de espera e indicação de IA vs humano.', 'Em produção'],
    ['Modo de atendimento', 'Alternância "Humano / IA / Misto" por conversa. Handoff humano desliga a IA automaticamente. Configuração persiste por lead.', 'Em produção'],
    ['IA Sofia', 'Assistente conversacional com persona específica do Instituto Lorena. Responde em até 24h fora do horário comercial, qualifica leads, propõe agendamento e repassa para humano quando solicitado.', 'Em produção'],
    ['Roteamento por linha', 'Cada consultora (Dandara, Aline, Ingrid) tem sua própria instância WhatsApp. Mensagens de uma linha nunca caem na caixa da outra. Configurável em /conexoes-whatsapp.', 'Em produção'],
    ['Pipeline e Kanban', 'Funil visual com drag-and-drop, etapas customizáveis, lead score por regras, tags e filtros. Três pipelines configurados (transplante masculino, feminino e tratamentos clínicos).', 'Em produção'],
    ['Ficha unificada do lead', 'Histórico completo de interações (WhatsApp + Instagram + notas internas) na mesma timeline. Campos customizáveis: tipo de consulta, médico, gênero, faixa de investimento.', 'Em produção'],
    ['Anti-banimento WhatsApp', 'Detecção automática de pedidos de opt-out ("não me mande mais"). Bloqueio de envio para quem pediu parar. Override humano com auditoria registrada.', 'Em produção'],
    ['Janela 24h e HUMAN_AGENT', 'Tratamento automático da janela de 24 horas da Meta. Fallback HUMAN_AGENT estende para 7 dias quando o cliente iniciou a conversa. Toast amigável quando bloqueia.', 'Em produção'],
    ['Mídia ManyChat nativa', 'Envio e recebimento de áudios e imagens via ManyChat sem precisar concatenar URL no texto. Renderiza nativamente no chat do paciente.', 'Em produção'],
    ['Follow-up automático', 'Cadência de mensagens para leads parados há mais de 1h sem resposta. Respeita janela 24h. Configurável por etapa do pipeline.', 'Em produção'],
    ['Disparo NPS automático', 'Pesquisa de satisfação enviada automaticamente após o procedimento. Captura resposta do paciente, classifica em promotor/neutro/detrator e gera relatório.', 'Em produção'],
    ['Analytics e dashboards', 'Dashboard com funil, motivos de perda, métricas por SDR, tempo médio de resposta, ROI por canal. Filtros por período, canal e consultora.', 'Em produção'],
    ['Prontuário médico append-only', 'Registro consentido pela LGPD, sem possibilidade de edição/exclusão (apenas adição), audit log de acesso. Criptografia opcional com chave por tenant.', 'Em produção'],
    ['Agenda médica integrada', 'Visualização e cadastro de consultas, vinculação ao paciente e ao médico, lembretes automáticos via WhatsApp.', 'Em produção'],
    ['Tarefas operacionais', 'Gestão de tasks por lead (ligar, enviar foto, confirmar pagamento, etc.) com prazo, responsável e notificação no app.', 'Em produção'],
    ['Aplicativo instalável (PWA)', 'Instalação como aplicativo nativo no celular e desktop, sem passar por App Store ou Play Store. Funciona offline para visualização.', 'Em produção'],
    ['Notificações em tempo real', 'Inbox e leads atualizam ao vivo (Realtime do Supabase). Quando um handoff é solicitado, todas as consultoras conectadas recebem aviso imediato.', 'Em produção'],
    ['Mesclagem de leads', 'Quando o mesmo paciente aparece em dois canais, é possível mesclar manualmente os dois leads em um só, preservando todo o histórico.', 'Em produção'],
    ['Configuração de IA por instância', 'Cada linha WhatsApp pode ter prompt customizado. Permite ajustar tom e abordagem de cada consultora separadamente.', 'Em produção'],
    ['Painel administrativo', 'Gestão de usuários, permissões por perfil (gerência/consultor/admin), convites por e-mail e provisionamento automático.', 'Em produção'],
    ['Auditoria completa', 'Log de todas as ações sensíveis: envio para paciente em opt-out (com motivo), exclusão de leads, acessos a prontuário, mudanças de configuração.', 'Em produção'],
    ['Importação de leads (CSV)', 'Upload de planilha de leads históricos com mapeamento de colunas e validação. Bucket de storage dedicado.', 'Em produção'],
    ['Painel de TV', 'Modo de exibição em televisor para acompanhamento da equipe em tempo real (atendimentos abertos, leads quentes, NPS recente).', 'Em produção'],
    ['Comando rápido (Cmd+K)', 'Paleta de comandos estilo Linear / Notion para navegação rápida por todo o sistema sem usar menu.', 'Em produção'],
    ['Histórico de conversas', 'Página dedicada com busca textual em todas as conversas históricas, filtros e exportação.', 'Em produção'],
    ['Métricas de atendimento', 'Tempo médio de resposta da IA, tempo médio de resposta humano, taxa de conversão por etapa, leads perdidos por motivo.', 'Em produção'],
    ['Detecção de longa espera', 'Conversas sem resposta há mais de X minutos sobem para topo da inbox com badge visual de alerta.', 'Em produção'],
    ['Modo "Sofia" em saudação dinâmica', 'A IA varia a saudação conforme horário do dia e nome do paciente, evitando padrão robotizado.', 'Em produção'],
  ];
  return table3col(rows, widths);
}

const MODULOS = [
  H1NewPage('3. Módulos em produção'),
  P('Cada item abaixo é um módulo entregue, testado e em uso pela equipe do Instituto Lorena no momento deste relatório. A tabela cobre as três camadas: atendimento (front), inteligência (IA + automação) e operação (admin, segurança, infraestrutura).'),
  buildModulesTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
  P([
    new TextRun({ text: 'Sobre o ritmo de entrega: ', bold: true }),
    new TextRun({ text: 'todos os módulos acima foram entregues entre abril e junho de 2026 (em pouco mais de 7 semanas). O ritmo se mantém estável, com correções e melhorias entregues semanalmente. O cliente acompanha cada entrega em tempo real pelo aplicativo instalado.' }),
  ]),
];

// ========================================================================
// 4. STACK TÉCNICO
// ========================================================================
function buildStackTable() {
  const widths = [2400, 3160, 3800];
  const rows = [
    ['Camada', 'Tecnologia', 'Por que esta escolha'],
    ['Banco de dados', 'PostgreSQL no Supabase', 'Banco relacional mais robusto do mercado livre, com proteção por linha (RLS) nativa, replicação automática e backups gerenciados.'],
    ['Servidor', 'Supabase Edge Functions (Deno)', 'Funções serverless de baixa latência, sem custo fixo de servidor parado. Escalam automaticamente conforme o volume.'],
    ['Autenticação', 'Supabase Auth', 'Login por e-mail e senha, recuperação de senha, e gestão de sessão com tokens JWT padrão da indústria.'],
    ['Frontend', 'React 19 + Vite + Tailwind CSS 4', 'Stack moderna mais usada no mercado, com excelente desempenho, fácil manutenção e milhares de desenvolvedores aptos a continuar o projeto se necessário.'],
    ['Aplicativo (PWA)', 'Service Worker zero-dependency', 'Aplicativo instalável sem dependência de loja. Cache inteligente para uso offline básico.'],
    ['IA / LLM', 'OpenAI (padrão) + Z.ai (fallback)', 'Dois provedores de inteligência artificial configurados em fallback automático. Se um cai ou estoura quota, o outro assume sem interrupção.'],
    ['WhatsApp', 'Evolution + WhatsApp Cloud API + W-API', 'Três provedores conviventes. Cada linha escolhe o seu. Tolerância a falha de provedor: se um cai, os outros continuam funcionando.'],
    ['Instagram', 'Meta Graph + ManyChat', 'Roteamento de fluxos via ManyChat, envio e recebimento de mensagens via Meta Graph API oficial.'],
    ['Hospedagem frontend', 'Netlify', 'Plataforma de hospedagem de aplicativos web com deploy automático e CDN global, gratuita até limites generosos.'],
    ['Hospedagem backend', 'Supabase Pro', 'Plano com SLA de 99,9%, backups diários, monitoramento e suporte.'],
    ['Pagamentos (base implementada)', 'Stripe', 'Base de billing já implementada, com webhook HMAC SHA256 e gate de assinatura. Ativável a qualquer momento.'],
    ['Repositório', 'GitHub privado', 'Versionamento completo do código, com histórico de cada alteração e capacidade de reverter em segundos se necessário.'],
  ];
  return table3col(rows, widths);
}

const STACK = [
  H1NewPage('4. Stack técnico'),
  P('Resumo das tecnologias usadas no CRM, com justificativa em linguagem acessível. Todas são padrão de mercado, com comunidade ativa e fácil contratação de desenvolvedores em caso de mudança de fornecedor.'),
  buildStackTable(),
  new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 200 } }),
  P([
    new TextRun({ text: 'Por que essa stack importa: ', bold: true }),
    new TextRun({ text: 'a escolha foi por tecnologias maduras, gratuitas ou de baixo custo, com comunidade grande e sem amarração proprietária. O Instituto pode, a qualquer momento, contratar outro desenvolvedor para dar continuidade — todo o código fica em repositório próprio do cliente quando solicitado.' }),
  ]),
];

// ========================================================================
// 5. LINHA DO TEMPO
// ========================================================================
function buildTimelineTable() {
  const widths = [1800, 2200, 5360];
  const rows = [
    ['Mês', 'Marco principal', 'O que foi entregue'],
    ['Abril 2026', 'Fundação do CRM', 'Bootstrap do projeto com Supabase, autenticação, CRM configurável (pipelines, etapas, tags), gestão de usuários e permissões, importação de leads. Primeiros pipelines Lorena (três funis).'],
    ['Maio 2026', 'Multi-canal + IA Sofia', 'Integração WhatsApp Evolution + WhatsApp Cloud API + ManyChat para Instagram. IA Sofia em produção com fallback OpenAI/Z.ai. Roteamento por linha. Inbox em tempo real. Mídia ManyChat (áudio + imagem) nativa. Saudação dinâmica.'],
    ['Maio 2026 (2ª metade)', 'NPS, follow-up, longa espera', 'Disparo NPS automático com captura de resposta. Follow-up para leads parados. Detecção de longa espera. Refactor de campos do lead e score por regras. Fusão de leads cross-channel.'],
    ['Maio 2026 (final)', 'Sprints 1 a 6 simultâneas', 'Analytics dashboard + lost_reason. PWA instalável. Billing Stripe (base). Prontuário médico append-only com LGPD. Onboarding wizard. Multi-tenant ativo com integrações por tenant.'],
    ['Início de Junho 2026', 'Sprint 5 (anti-banimento) + W-API', 'Opt-out automático WhatsApp e Instagram com override humano auditado. Conexão da W-API para linhas Aline e Ingrid. Polish da UI de Stripe Checkout.'],
    ['08 Junho 2026', 'Correções operacionais críticas', 'Correção do fluxo de janela 24h da Meta no Instagram (fallback automático HUMAN_AGENT). Remoção da mesclagem automática de leads por nome (evita confusão entre homônimos). Validação de corpo da resposta da W-API.'],
  ];
  return table3col(rows, widths);
}

const TIMELINE = [
  H1NewPage('5. Linha do tempo das entregas'),
  P('Resumo cronológico dos marcos de entrega entre abril e junho de 2026. Cada mês representa um conjunto significativo de funcionalidades em produção.'),
  buildTimelineTable(),
];

// ========================================================================
// 6. SEGURANÇA, LGPD E AUDITORIA
// ========================================================================
const SEGURANCA = [
  H1NewPage('6. Segurança, LGPD e auditoria'),
  P('O CRM lida com dados sensíveis (pacientes, conversas privadas, prontuários médicos), portanto a segurança e o cumprimento da LGPD são tratados como requisitos não negociáveis. Esta seção descreve as proteções em produção hoje.'),

  H2('6.1. Proteção a nível de banco'),
  bulletP('Row-Level Security (RLS) ativo em todas as 35+ tabelas sensíveis. Cada usuário só vê os dados aos quais foi explicitamente autorizado.'),
  bulletP('Credenciais de terceiros (tokens do WhatsApp, ManyChat, Bling, OpenAI) ficam em "secrets" gerenciados pela infraestrutura, nunca no código nem no banco aberto.'),
  bulletP('Backups automáticos diários do banco, com retenção mínima de 7 dias no plano atual.'),

  H2('6.2. LGPD'),
  bulletP('Coleta de consentimento explícito no primeiro contato com o paciente, armazenado em tabela dedicada "patient_consents" com data, IP e versão do termo aceito.'),
  bulletP('Opt-out automatizado: o paciente pode pedir para parar a qualquer momento e o CRM bloqueia novos envios na hora. Override humano permitido, mas com auditoria registrada (operador assume risco).'),
  bulletP('Prontuário médico append-only: registros médicos não podem ser editados ou excluídos, apenas adicionados. Cumpre a exigência regulatória de não-alteração de prontuário.'),
  bulletP('Audit log de acessos ao prontuário: cada vez que alguém abre o prontuário de um paciente, fica registrado quem, quando e por qual motivo declarou.'),

  H2('6.3. Anti-banimento de plataforma'),
  bulletP('Detecção automática de palavras-chave de opt-out ("pare", "não me mande", "sair", "stop"). Bloqueio imediato.'),
  bulletP('Respeito automático à janela de 24 horas da Meta no Instagram e WhatsApp via ManyChat. Fora dela, fallback HUMAN_AGENT (estende para 7 dias).'),
  bulletP('Limite horário de envios por linha para evitar comportamento de spam que dispara banimento da Meta. Configurável por linha.'),

  H2('6.4. Continuidade de negócio'),
  bulletP('Falha em um provedor de WhatsApp não derruba o sistema: as linhas dos outros provedores continuam funcionando.'),
  bulletP('Falha em um provedor de IA: o outro assume automaticamente (OpenAI → Z.ai ou vice-versa).'),
  bulletP('Falha do Supabase (raro, SLA de 99,9%): mensagens entram em fila e são processadas quando o serviço volta. Atendimento humano segue funcionando via WhatsApp Web.'),
];

// ========================================================================
// 7. OPERAÇÃO CONTÍNUA
// ========================================================================
const OPERACAO = [
  H1NewPage('7. Operação contínua e disponibilidade'),

  H2('7.1. Suporte e SLA'),
  bulletP('Suporte direto via WhatsApp e e-mail, em horário comercial (8h-18h em dia útil).'),
  bulletP('SLA de retorno em até 4 horas úteis para problemas críticos com operação parada.'),
  bulletP('Correção de bugs sem custo adicional, sem limite de chamados.'),
  bulletP('Pequenos ajustes (novos campos, novas tags, novos fluxos simples) absorvidos pela operação contínua, até 4 horas de trabalho por mês.'),

  H2('7.2. Releases e atualizações'),
  bulletP('Frequência média de releases nos últimos 60 dias: aproximadamente um a cada 1-2 dias úteis.'),
  bulletP('Atualizações de segurança aplicadas automaticamente, sem janela de manutenção exigida.'),
  bulletP('Cada release passa por validação local antes de subir para produção. Reversão possível em segundos via histórico do Git.'),

  H2('7.3. Histórico recente de operação'),
  bulletP('Última correção crítica: 08 de junho de 2026 (3 fixes operacionais simultâneos: janela 24h, homônimos, silent-drop W-API).'),
  bulletP('Última feature: 03 de junho de 2026 (conexão de W-API como provider alternativo para Aline e Ingrid).'),
  bulletP('Última UI completada: 26 de maio de 2026 (Sprint 3 Stripe Checkout + PWA banner de instalação).'),
  bulletP('Nenhuma queda significativa relatada pela equipe operacional no período de operação.'),
];

// ========================================================================
// 8. O QUE VEM A SEGUIR
// ========================================================================
const PROXIMO = [
  H1NewPage('8. O que vem a seguir'),
  P('Este relatório acompanha a proposta comercial v3 para a Tricopill (documento separado). Quando aprovada, a sequência prevista é:'),

  H2('8.1. Expansão para Tricopill (proposta v3)'),
  bulletP('Construção do vendedor de IA conversacional 100% autônomo para a Tricopill, com persona dedicada (separada da Sofia).'),
  bulletP('Integração completa com Bling (catálogo, pedido, NF, estoque, rastreio).'),
  bulletP('Gateway de pagamento por link (Pagar.me, InterPag ou Stripe).'),
  bulletP('Recomendação por histórico de compras, reposição automática inteligente, carrinho abandonado e pesquisa pós-venda.'),
  bulletP('Cronograma estimado: 8 semanas em 6 sprints.'),

  H2('8.2. Expansões internas do Instituto (junto com Tricopill)'),
  bulletP('Cobrança automática de cirurgia 10 dias antes do procedimento, com leitura da agenda Google.'),
  bulletP('Disparos automáticos de aniversário e datas comemorativas (Dia das Mães, Black Friday capilar, etc.).'),
  bulletP('Sistema de indicação com cashback rastreável dentro do CRM, sem planilha à parte.'),

  H2('8.3. O que continua igual'),
  bulletP('A operação atual do Instituto Lorena continua funcionando sem interrupções durante toda a implantação Tricopill.'),
  bulletP('Mesma equipe de atendimento, mesma forma de uso. As novas features aparecem como adições, não substituições.'),
  bulletP('Mesma infraestrutura compartilhada (banco, IA, WhatsApp, Instagram) — sem custo adicional para o Instituto pela operação Tricopill.'),

  H2('8.4. Como avançar'),
  bulletP('Leitura da proposta comercial v3 da Tricopill (documento separado).'),
  bulletP('Alinhamento das decisões pendentes registradas na proposta (gateway, persona, cashback, lista de produtos).'),
  bulletP('Aceite e pagamento da primeira parcela do setup destravam o início da Sprint 1.'),
];

// ========================================================================
// DOCUMENT
// ========================================================================
const doc = new Document({
  creator: 'Álvaro Carlisbino',
  title: 'Relatório CRM Instituto Lorena Visentainer — Estado atual',
  description: 'Relatório técnico-operacional do CRM em produção no Instituto Lorena Visentainer, com módulos, stack, segurança e linha do tempo de entregas.',
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
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 240 } } },
      }],
    }],
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
          children: [new TextRun({ text: 'Relatório CRM Instituto Lorena Visentainer — Estado atual (Jun/2026)', size: 18, color: COLOR_MUTED })],
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
      ...COVER, ...INDICE, ...SUMARIO, ...VISAO_GERAL,
      ...MODULOS, ...STACK, ...TIMELINE, ...SEGURANCA, ...OPERACAO, ...PROXIMO,
    ],
  }],
});

const outDocx = path.resolve(process.env.HOME, 'Downloads/Relatorio_CRM_Instituto_Lorena_Estado_Atual.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outDocx, buffer);
  console.log('OK:', outDocx);
});
