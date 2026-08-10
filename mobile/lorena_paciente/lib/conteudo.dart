import 'package:flutter/material.dart';

/// Conteúdo institucional do app, tirado do site institutolorenavisentainer.com.br.
/// Nada aqui é invenção: método, formação, procedimentos, endereços e contato
/// são os que a clínica já publica.
///
/// PREÇO NÃO ENTRA. A clínica já decidiu que valor é conversa depois da
/// avaliação, e a Sofia (IA do WhatsApp) segue a mesma regra.

class Contato {
  static const whatsapp = '5544991493656';
  static const telefoneVisivel = '(44) 99149-3656';
  static const email = 'atendimento@lorenavisentainer.com.br';
  static const site = 'https://institutolorenavisentainer.com.br';
  static const prazoResposta = 'Respondemos em até 24 horas úteis.';
}

class Unidade {
  const Unidade({required this.cidade, required this.endereco, required this.busca});
  final String cidade;
  final String endereco;
  final String busca;
}

const unidades = <Unidade>[
  Unidade(
    cidade: 'Maringá, PR',
    endereco: 'Av. Nóbrega, 814 — Zona 4, 87014-180',
    busca: 'Instituto Lorena Visentainer, Av. Nóbrega 814, Maringá PR',
  ),
  Unidade(
    cidade: 'Londrina, PR',
    endereco: 'Mesmo padrão de atendimento da unidade de Maringá',
    busca: 'Instituto Lorena Visentainer Londrina',
  ),
];

class Servico {
  const Servico({
    required this.id,
    required this.nome,
    required this.resumo,
    required this.icone,
    required this.texto,
    this.destaques = const [],
  });

  final String id;
  final String nome;
  final String resumo;
  final IconData icone;
  final String texto;
  final List<String> destaques;
}

const servicos = <Servico>[
  Servico(
    id: 'regenerativo',
    nome: 'Transplante Capilar Regenerativo®',
    resumo: 'O método exclusivo da casa: técnica FUE somada a tratamento regenerativo.',
    icone: Icons.auto_awesome_outlined,
    texto:
        'O Transplante Capilar Regenerativo® é um método registrado, desenvolvido '
        'pela Dra. Lorena Visentainer. Ele associa a técnica FUE ao tratamento com '
        'células autólogas ainda no intraoperatório: além dos fios transplantados, os '
        'fios nativos passam por um processo de regeneração e voltam a ser fios '
        'saudáveis. É esse o nosso grande diferencial.',
    destaques: [
      'Megassessão de Transplante Capilar FUE',
      'Terapia regenerativa com células autólogas no intraoperatório',
      'Tratamento também dos fios nativos, não só dos implantados',
    ],
  ),
  Servico(
    id: 'feminino',
    nome: 'Transplante capilar feminino',
    resumo: 'Sem raspagem, com resultados naturais.',
    icone: Icons.woman_outlined,
    texto:
        'Dados da Sociedade Brasileira de Dermatologia indicam que cerca de 50% das '
        'mulheres podem ser afetadas pela alopecia androgenética em algum momento. '
        'Poucas sabem que dá para recuperar os fios acometidos pela calvície com o '
        'Transplante Capilar Regenerativo®, procedimento seguro e de resultado '
        'duradouro. Também pode ser feito por motivo estético, como reduzir o tamanho '
        'da testa.',
    destaques: [
      'Sem raspar o cabelo',
      'Indicado também para redução de testa',
      'Resultados duradouros',
    ],
  ),
  Servico(
    id: 'sobrancelha',
    nome: 'Transplante de sobrancelhas',
    resumo: 'Brow FUE Long Hair, desenhado traço a traço para o seu rosto.',
    icone: Icons.remove_red_eye_outlined,
    texto:
        'Dentro do Instituto temos um centro dedicado à técnica Brow FUE Long Hair: um '
        'encontro entre arte e técnica, personalizado para cada pessoa, levando em '
        'conta cada detalhe e cada traço do rosto. A cicatrização e a recuperação são '
        'rápidas. É indicado para quem está insatisfeito com as sobrancelhas por perda '
        'de pelos, falhas ou formatos irregulares. Feito com anestesia local, e o '
        'resultado é permanente, diferente da micropigmentação.',
    destaques: [
      'Técnica FUE Long Hair',
      'Resultado permanente, ao contrário da micropigmentação',
      'Anestesia local, recuperação rápida',
    ],
  ),
  Servico(
    id: 'barba',
    nome: 'Transplante de barba',
    resumo: 'Para quem sonhou com barba cheia e a genética não cooperou.',
    icone: Icons.face_outlined,
    texto:
        'Além de melhorar a estética facial, o transplante de barba pode ter impacto '
        'significativo na qualidade de vida. Uma barba bem definida confere uma '
        'aparência masculina distinta e ajuda a projetar confiança e maturidade.',
    destaques: [
      'Preenchimento de falhas e cicatrizes',
      'Desenho do contorno junto com você',
    ],
  ),
  Servico(
    id: 'tratamentos',
    nome: 'Tratamentos capilares',
    resumo: 'Eletroporação, terapia regenerativa e laser de baixa frequência.',
    icone: Icons.science_outlined,
    texto:
        'Usamos tecnologias que infundem ativos no couro cabeludo sem agulhas, por '
        'eletroporação, com conforto e eficácia. A terapia regenerativa usa células '
        'autólogas para estimular o crescimento capilar e é indicada para diversos '
        'tipos de calvície. O laser de baixa frequência estimula crescimento e '
        'espessura dos fios, e pode ser usado antes e depois do transplante. A terapia '
        'capilar fortalece, nutre e cuida da saúde do couro cabeludo, combatendo queda, '
        'inflamação e fragilidade dos fios.',
    destaques: [
      'Eletroporação, sem agulhas',
      'Terapia regenerativa com células autólogas',
      'Laser de baixa frequência, pré e pós-transplante',
    ],
  ),
];

class Medico {
  const Medico({required this.nome, required this.registro, required this.atuacao});
  final String nome;
  final String registro;
  final String atuacao;
}

class Dra {
  static const nome = 'Dra. Lorena Visentainer';
  static const registro = 'CRM 33717 | RQE 27798';
  static const resumo =
      'Referência em medicina capilar. Se dedica diariamente à junção de ciência, arte '
      'e medicina para recuperar a autoestima e a qualidade de vida dos seus pacientes '
      'através do Transplante Capilar Regenerativo®.';

  static const formacao = <String>[
    'Medicina pela Universidade Estadual de Londrina (UEL)',
    'Residência em dermatologia e mestrado na UNICAMP',
    'Tricologia pela Universidade de São Paulo (USP)',
    'Membro titular da SBD (Sociedade Brasileira de Dermatologia)',
    'Membro da ISHRS (International Society of Hair Restoration Surgery)',
    'Membro da ABCRC (Associação Brasileira de Cirurgia da Restauração Capilar)',
  ];

  static const ensino = <String>[
    'Fundadora do Hair Academy, pós-graduação para médicos',
    'Palestrante internacional',
  ];

  static const livros = <String>[
    'Primeiro livro de Transplante Capilar FUE do Brasil',
    'Primeiro livro de Transplante de Sobrancelhas do mundo',
    'Primeiro livro de Terapia Regenerativa do Brasil',
  ];
}

class Clinica {
  static const nome = 'Instituto Lorena Visentainer';

  static const missao =
      'Melhorar a qualidade de vida e a autoestima dos nossos pacientes através da '
      'recuperação da saúde capilar, usando o melhor da tecnologia, inovação e ciência.';

  static const sobre =
      'Somos uma clínica totalmente focada e capacitada em tratamentos capilares, com '
      'um método exclusivo: o Transplante Capilar Regenerativo®, desenvolvido pela '
      'diretora clínica Dra. Lorena Visentainer.';

  static const valores = <String>[
    'Gentileza',
    'Proatividade',
    'Responsabilidade',
    'Honestidade',
    'Inovação',
  ];
}

class Depoimento {
  const Depoimento({required this.texto, required this.autor, this.papel});
  final String texto;
  final String autor;
  final String? papel;
}

const depoimentos = <Depoimento>[
  Depoimento(
    texto: 'Melhor tratamento capilar do Brasil. Dra. Lorena maravilhosa.',
    autor: 'Salsicha',
    papel: 'Apresentador',
  ),
  Depoimento(
    texto:
        'Excelente atendimento, aconchegante e acolhedor. Fiz meu procedimento há uma '
        'semana e a recuperação está ótima. Agradeço a todos os profissionais '
        'envolvidos, muito atenciosos, educados e comprometidos.',
    autor: 'Eneida Peixoto',
  ),
  Depoimento(
    texto:
        'A Dra. Lorena Visentainer hoje figura entre os grandes nomes no cenário '
        'nacional de transplante capilar, aliando competência técnica e apurado senso '
        'estético, o que faz com que os resultados sejam extremamente naturais. Sair do '
        'país é desnecessário quando se tem o nível da Dra. Lorena tão perto.',
    autor: 'Rafael Januário Rocha',
  ),
];

class PerguntaFrequente {
  const PerguntaFrequente(this.pergunta, this.resposta);
  final String pergunta;
  final String resposta;
}

const faq = <PerguntaFrequente>[
  PerguntaFrequente(
    'Quanto custa?',
    'Depende do que a sua avaliação indicar: o número de unidades foliculares e o tipo '
        'de procedimento mudam bastante de pessoa para pessoa. Por isso o valor é '
        'passado depois da avaliação, e não por tabela. Chame no WhatsApp que a equipe '
        'te explica as condições.',
  ),
  PerguntaFrequente(
    'Tenho indicação para transplante?',
    'É a pergunta mais comum, e quem responde com precisão é a avaliação. Usamos a '
        'escala de Norwood para classificar a progressão da calvície. Pela calculadora '
        'do app você já tem uma estimativa de quantas unidades foliculares seriam '
        'necessárias no seu caso.',
  ),
  PerguntaFrequente(
    'O que é o Transplante Capilar Regenerativo®?',
    'É um método registrado da clínica: a técnica FUE somada, no intraoperatório, a um '
        'tratamento com células autólogas. Além dos fios transplantados, os fios nativos '
        'passam por regeneração e voltam a ser fios saudáveis.',
  ),
  PerguntaFrequente(
    'Preciso raspar a cabeça?',
    'No transplante feminino, não. É possível fazer sem raspagem, preservando o cabelo '
        'comprido. Nos demais casos isso é definido na avaliação.',
  ),
  PerguntaFrequente(
    'Quando aparece o resultado?',
    'Os fios implantados caem nas primeiras semanas e a raiz permanece. O crescimento '
        'novo costuma dar os primeiros sinais por volta do terceiro mês, e o resultado '
        'fecha entre 12 e 18 meses.',
  ),
  PerguntaFrequente(
    'Vocês atendem fora de Maringá?',
    'Sim. Temos unidade em Londrina, com o mesmo padrão de atendimento, e recebemos '
        'pacientes de todo o país. A equipe te orienta sobre o roteiro.',
  ),
];
