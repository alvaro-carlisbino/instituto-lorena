import 'package:flutter/material.dart';

/// Conteúdo institucional do app. Fica num arquivo só, em Dart puro, para
/// mudar texto ser uma linha e não uma migration.
///
/// PREÇO DE CONSULTA NÃO ENTRA AQUI DE PROPÓSITO. A clínica já decidiu que
/// valor é conversa com a consultora, não tabela publicada: a Sofia (IA do
/// WhatsApp) também não passa preço, empurra para o humano. Publicar no app
/// contrariaria a regra e criaria expectativa que a clínica não quer.

class Servico {
  const Servico({
    required this.id,
    required this.nome,
    required this.resumo,
    required this.icone,
    required this.paraQuem,
    required this.comoFunciona,
    required this.duracao,
  });

  final String id;
  final String nome;
  final String resumo;
  final IconData icone;
  final String paraQuem;
  final List<String> comoFunciona;
  final String duracao;
}

const servicos = <Servico>[
  Servico(
    id: 'transplante_masculino',
    nome: 'Transplante capilar masculino',
    resumo: 'Recuperação de entradas, coroa e linha frontal com fio próprio.',
    icone: Icons.face_retouching_natural_rounded,
    paraQuem: 'Homens com calvície de padrão masculino, entradas recuadas, '
        'coroa aberta ou falhas por cicatriz.',
    comoFunciona: [
      'Avaliação clínica para entender a causa da queda e a área doadora.',
      'Desenho da linha frontal junto com você, respeitando o seu rosto.',
      'Extração dos folículos da nuca e implante fio a fio nas áreas de falha.',
      'Acompanhamento ao longo dos meses seguintes, com fotos comparativas.',
    ],
    duracao: 'Procedimento de um dia, geralmente entre 6 e 11 horas.',
  ),
  Servico(
    id: 'transplante_feminino',
    nome: 'Transplante capilar feminino',
    resumo: 'Densidade na linha frontal e no topo, sem raspar o cabelo todo.',
    icone: Icons.woman_rounded,
    paraQuem: 'Mulheres com rarefação no topo, testa alta, ou falhas por tração '
        'de penteados e químicas.',
    comoFunciona: [
      'Investigação da causa antes de qualquer procedimento.',
      'Planejamento respeitando o formato do rosto e o cabelo comprido.',
      'Extração e implante fio a fio, com técnica que preserva o volume atual.',
      'Acompanhamento com registro fotográfico padronizado.',
    ],
    duracao: 'Procedimento de um dia, conforme a área a tratar.',
  ),
  Servico(
    id: 'sobrancelha',
    nome: 'Transplante de sobrancelha',
    resumo: 'Reconstrução de falhas e desenho definitivo, com fio próprio.',
    icone: Icons.remove_red_eye_outlined,
    paraQuem: 'Quem tem falhas por excesso de depilação, cicatriz ou queda, e '
        'quer parar de depender de maquiagem e micropigmentação.',
    comoFunciona: [
      'Desenho do formato junto com você antes de começar.',
      'Implante fio a fio respeitando o ângulo natural de cada região.',
      'Orientação de aparo, porque o fio implantado cresce como cabelo.',
    ],
    duracao: 'Algumas horas, no mesmo dia.',
  ),
  Servico(
    id: 'barba',
    nome: 'Transplante de barba',
    resumo: 'Preenchimento de falhas e desenho de contorno.',
    icone: Icons.face_rounded,
    paraQuem: 'Homens com falhas no rosto, barba irregular ou cicatrizes que '
        'impedem o crescimento.',
    comoFunciona: [
      'Avaliação da área doadora e do desenho desejado.',
      'Implante fio a fio, seguindo a direção natural da barba.',
      'Acompanhamento do crescimento nos meses seguintes.',
    ],
    duracao: 'Procedimento de um dia.',
  ),
  Servico(
    id: 'consulta',
    nome: 'Consulta clínica capilar',
    resumo: 'Diagnóstico da queda antes de decidir qualquer tratamento.',
    icone: Icons.medical_information_outlined,
    paraQuem: 'Quem está perdendo cabelo e ainda não sabe o motivo, ou quer '
        'saber se é candidato ao transplante.',
    comoFunciona: [
      'Avaliação médica com exame do couro cabeludo.',
      'Investigação das causas: genética, hormonal, nutricional, estresse.',
      'Plano de tratamento realista, que pode ou não incluir cirurgia.',
    ],
    duracao: 'Presencial em Maringá ou por teleconsulta.',
  ),
  Servico(
    id: 'tratamento',
    nome: 'Tratamentos clínicos',
    resumo: 'Protocolos para frear a queda e fortalecer o que você ainda tem.',
    icone: Icons.science_outlined,
    paraQuem: 'Quem precisa tratar a causa da queda, antes, depois ou no lugar '
        'do transplante.',
    comoFunciona: [
      'Protocolo definido na consulta, conforme o diagnóstico.',
      'Sessões acompanhadas pela equipe, com intervalos planejados.',
      'Reavaliação periódica para ajustar o que não estiver respondendo.',
    ],
    duracao: 'Varia conforme o protocolo indicado.',
  ),
];

class Medico {
  const Medico({required this.nome, required this.atuacao});
  final String nome;
  final String atuacao;
}

const equipe = <Medico>[
  Medico(nome: 'Dra. Lorena Visentainer', atuacao: 'Saúde e restauração capilar'),
  Medico(nome: 'Dr. Matheus Amaral', atuacao: 'Avaliação clínica capilar'),
  Medico(nome: 'Dra. Jaqueline Augusto', atuacao: 'Saúde capilar e atendimento online'),
];

class Clinica {
  static const nome = 'Instituto Lorena Visentainer';
  static const endereco = 'Av. Nóbrega, 814, Zona 4';
  static const cidade = 'Maringá, PR';
  static const estacionamento = 'Estacionamento próprio';
  static const mapsBusca = 'Instituto Lorena Visentainer, Av. Nóbrega 814, Maringá PR';

  static const sobre =
      'Somos uma clínica de Maringá especializada em saúde capilar. Tratamos a '
      'causa da queda antes de falar em cirurgia, e quando o transplante é o '
      'caminho, ele é feito pela nossa própria equipe, no nosso centro cirúrgico.';

  static const diferenciais = <(IconData, String, String)>[
    (
      Icons.biotech_outlined,
      'Diagnóstico antes de tudo',
      'Nem toda queda se resolve com cirurgia. A consulta investiga a causa e o '
          'plano pode ser clínico.',
    ),
    (
      Icons.groups_2_outlined,
      'Equipe própria',
      'O procedimento é feito pela equipe da casa, no nosso centro cirúrgico, '
          'não por terceiros contratados.',
    ),
    (
      Icons.query_stats_rounded,
      'Cada folículo é contado',
      'Extração e implante são registrados por área durante a cirurgia. Depois '
          'você vê esse número no app, não uma estimativa.',
    ),
    (
      Icons.photo_camera_outlined,
      'Acompanhamento com foto',
      'Registro padronizado nos marcos do tratamento, no mesmo enquadramento, '
          'para comparar de verdade.',
    ),
  ];
}

class PerguntaFrequente {
  const PerguntaFrequente(this.pergunta, this.resposta);
  final String pergunta;
  final String resposta;
}

const faq = <PerguntaFrequente>[
  PerguntaFrequente(
    'Quanto custa?',
    'Depende do que a sua avaliação indicar: o número de folículos e o tipo de '
        'procedimento mudam bastante de pessoa para pessoa. Por isso o valor é '
        'passado depois da avaliação, e não por tabela. Chame no WhatsApp que a '
        'consultora te explica as condições.',
  ),
  PerguntaFrequente(
    'O resultado é natural?',
    'O fio implantado é o seu, retirado da própria nuca. O que faz parecer '
        'natural é o desenho da linha e o ângulo de cada implante, e é por isso '
        'que o desenho é feito com você antes de começar.',
  ),
  PerguntaFrequente(
    'Dói?',
    'O procedimento é feito com anestesia local. O desconforto maior costuma ser '
        'a duração do dia, não a dor. Nos dias seguintes a orientação de analgesia '
        'vem por escrito.',
  ),
  PerguntaFrequente(
    'Quando aparece o resultado?',
    'Os fios implantados caem nas primeiras semanas e a raiz permanece. O '
        'crescimento novo costuma dar os primeiros sinais por volta do terceiro '
        'mês, e o resultado fecha entre 12 e 18 meses.',
  ),
  PerguntaFrequente(
    'Preciso raspar a cabeça?',
    'Nem sempre. No caso feminino existe técnica que preserva o cabelo comprido. '
        'Isso é definido na avaliação, conforme a área a tratar.',
  ),
  PerguntaFrequente(
    'Vocês atendem de fora de Maringá?',
    'Sim. A avaliação pode começar por teleconsulta e muita gente vem de outras '
        'cidades para o procedimento. A equipe te orienta sobre o roteiro.',
  ),
];
