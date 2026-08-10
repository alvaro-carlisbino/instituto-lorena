int _i(dynamic v) => v is int ? v : int.tryParse('${v ?? ''}') ?? 0;
String? _s(dynamic v) {
  final s = v?.toString().trim();
  return (s == null || s.isEmpty) ? null : s;
}

DateTime? _d(dynamic v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

/// Uma área do couro cabeludo com o quanto foi implantado nela.
class AreaResultado {
  AreaResultado.fromJson(Map<String, dynamic> j)
      : area = _s(j['area']) ?? '—',
        meta = _i(j['meta']),
        implantados = _i(j['implantados']);

  final String area;
  final int meta;
  final int implantados;
}

/// Uma etapa da cirurgia com o horário em que aconteceu.
class EtapaCirurgia {
  EtapaCirurgia.fromJson(Map<String, dynamic> j)
      : etapa = _s(j['etapa']) ?? '—',
        tipo = _s(j['tipo']) ?? '',
        horario = _d(j['horario']);

  final String etapa;
  final String tipo; // INICIO | CONCLUIDO
  final DateTime? horario;

  static const _rotulos = {
    'PRE-CIRURGICO': 'Pré-cirúrgico',
    'ANESTESIA1': 'Anestesia',
    'PRE_INSICOES': 'Pré-incisões',
    'ANESTESIA2': 'Anestesia (2ª)',
    'EXTRACAO': 'Extração',
    'IMPLANTE': 'Implante',
    'RPA': 'Recuperação',
    'ALTA_ANESTESICA': 'Alta anestésica',
    'ALTA': 'Alta',
  };

  String get rotulo => _rotulos[etapa] ?? etapa;
  bool get concluida => tipo == 'CONCLUIDO';
}

class Cirurgia {
  Cirurgia.fromJson(Map<String, dynamic> j)
      : id = _i(j['id']),
        dia = _d(j['dia']),
        status = _s(j['status']) ?? '',
        meta = _i(j['meta']),
        totalExtraidos = _i(j['total_extraidos']),
        totalImplantados = _i(j['total_implantados']),
        areas = ((j['areas'] as List?) ?? [])
            .map((e) => AreaResultado.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        etapas = ((j['etapas'] as List?) ?? [])
            .map((e) => EtapaCirurgia.fromJson(Map<String, dynamic>.from(e)))
            .toList();

  final int id;
  final DateTime? dia;
  final String status;
  final int meta;
  final int totalExtraidos;
  final int totalImplantados;
  final List<AreaResultado> areas;
  final List<EtapaCirurgia> etapas;

  bool get finalizada => status == 'FINALIZADA';

  /// Quanto tempo o paciente ficou em procedimento, do 1º ao último carimbo.
  Duration? get duracao {
    final comHora = etapas.where((e) => e.horario != null).toList();
    if (comHora.length < 2) return null;
    return comHora.last.horario!.difference(comHora.first.horario!);
  }
}

class Consulta {
  Consulta.fromJson(Map<String, dynamic> j)
      : data = _d(j['data']),
        horario = _s(j['horario']) ?? '',
        servico = _s(j['servico']) ?? 'Consulta',
        prestador = _s(j['prestador']) ?? '',
        status = _s(j['status']) ?? '';

  final DateTime? data;
  final String horario;
  final String servico;
  final String prestador;
  final String status;

  bool get futura => data != null && !data!.isBefore(DateTime.now().subtract(const Duration(days: 1)));
}

/// Marcos da evolução. A ordem aqui é a ordem que aparece na linha do tempo.
enum Marco { preOp, d0, d7, d15, m1, m3, m6, m9, m12, m18 }

const marcoIds = {
  Marco.preOp: 'pre_op',
  Marco.d0: 'd0',
  Marco.d7: 'd7',
  Marco.d15: 'd15',
  Marco.m1: 'm1',
  Marco.m3: 'm3',
  Marco.m6: 'm6',
  Marco.m9: 'm9',
  Marco.m12: 'm12',
  Marco.m18: 'm18',
};

const marcoRotulos = {
  'pre_op': 'Pré-operatório',
  'd0': 'Dia da cirurgia',
  'd7': '7 dias',
  'd15': '15 dias',
  'm1': '1 mês',
  'm3': '3 meses',
  'm6': '6 meses',
  'm9': '9 meses',
  'm12': '12 meses',
  'm18': '18 meses',
};

const angulos = ['frontal', 'topo', 'coroa', 'lateral_d', 'lateral_e', 'nuca', 'hairline'];

const anguloRotulos = {
  'frontal': 'Frontal',
  'topo': 'Topo',
  'coroa': 'Coroa',
  'lateral_d': 'Lateral direita',
  'lateral_e': 'Lateral esquerda',
  'nuca': 'Nuca',
  'hairline': 'Linha frontal',
};

class FotoPaciente {
  FotoPaciente.fromJson(Map<String, dynamic> j)
      : id = _s(j['id']) ?? '',
        storagePath = _s(j['storage_path']) ?? '',
        angle = _s(j['angle']) ?? '',
        milestone = _s(j['milestone']) ?? '',
        takenAt = _d(j['taken_at']),
        visivel = j['visible_to_patient'] == null ? true : j['visible_to_patient'] == true;

  final String id;
  final String storagePath;
  final String angle;
  final String milestone;
  final DateTime? takenAt;
  final bool visivel;

  String get marcoRotulo => marcoRotulos[milestone] ?? milestone;
  String get anguloRotulo => anguloRotulos[angle] ?? angle;
}

class Pedido {
  Pedido.fromJson(Map<String, dynamic> j)
      : id = _s(j['id']) ?? '',
        origem = _s(j['origem']) ?? '',
        criadoEm = _d(j['criado_em']),
        pagoEm = _d(j['pago_em']),
        status = _s(j['status']) ?? '',
        metodo = _s(j['metodo']) ?? '',
        kit = _s(j['kit']),
        valorCentavos = _i(j['valor_centavos']),
        freteCentavos = _i(j['frete_centavos']),
        nfe = _s(j['nfe']);

  final String id;
  final String origem;
  final DateTime? criadoEm;
  final DateTime? pagoEm;
  final String status;
  final String metodo;
  final String? kit;
  final int valorCentavos;
  final int freteCentavos;
  final String? nfe;

  bool get pago => pagoEm != null || status.toLowerCase().contains('paid') || status.toLowerCase() == 'pago';
}

class Assinatura {
  Assinatura.fromJson(Map<String, dynamic> j)
      : id = _s(j['id']) ?? '',
        cadencia = _s(j['cadence']) ?? '',
        status = _s(j['status']) ?? '',
        ciclosPagos = _i(j['paid_cycles']),
        unidadesPorEnvio = _i(j['units_per_shipment']),
        valorMensalCentavos = _i(j['monthly_value_cents']),
        ultimoCicloEnviado = _i(j['last_shipped_cycle']),
        ultimoEnvioEm = _d(j['last_ship_at']),
        minCiclos = _i(j['min_cycles']);

  final String id;
  final String cadencia;
  final String status;
  final int ciclosPagos;
  final int unidadesPorEnvio;
  final int valorMensalCentavos;
  final int ultimoCicloEnviado;
  final DateTime? ultimoEnvioEm;
  final int minCiclos;

  bool get ativa => status.toLowerCase() == 'active' || status.toLowerCase() == 'ativa';
}

class StaffMe {
  StaffMe.fromJson(Map<String, dynamic> j)
      : nome = _s(j['nome']) ?? '',
        email = _s(j['email']) ?? '',
        role = _s(j['role']) ?? '',
        employeeId = _s(j['employee_id']),
        cargo = _s(j['cargo']),
        tenantId = _s(j['tenant_id']) ?? 'instituto-lorena';

  final String nome;
  final String email;
  final String role;
  final String? employeeId;
  final String? cargo;
  final String tenantId;

  /// Sem ficha em hr_employees não há como bater ponto.
  bool get podeBaterPonto => employeeId != null;
}

class Batida {
  Batida.fromJson(Map<String, dynamic> j)
      : id = _s(j['id']) ?? '',
        at = _d(j['at']),
        distanciaM = j['distance_m'] == null ? null : _i(j['distance_m']),
        dentroDaCerca = j['within_fence'] as bool?,
        manual = j['manual'] == true;

  final String id;
  final DateTime? at;
  final int? distanciaM;
  final bool? dentroDaCerca;
  final bool manual;
}

class AgendaItem {
  AgendaItem.fromJson(Map<String, dynamic> j)
      : prontuario = _s(j['prontuario']) ?? '',
        paciente = _s(j['paciente']) ?? _s(j['prontuario']) ?? '—',
        horario = _s(j['horario']) ?? '',
        servico = _s(j['servico']) ?? '',
        prestador = _s(j['prestador']) ?? '',
        status = _s(j['status']) ?? '';

  final String prontuario;
  final String paciente;
  final String horario;
  final String servico;
  final String prestador;
  final String status;
}

class CirurgiaHoje {
  CirurgiaHoje.fromJson(Map<String, dynamic> j)
      : id = _i(j['id']),
        paciente = _s(j['paciente']) ?? '—',
        prontuario = _s(j['prontuario']),
        status = _s(j['status']) ?? '',
        meta = _i(j['meta']),
        sala = _s(j['sala']),
        horaInicio = _d(j['hora_inicio']),
        totalExtraidos = _i(j['total_extraidos']),
        totalImplantados = _i(j['total_implantados']),
        etapaAtual = _s(j['etapa_atual']);

  final int id;
  final String paciente;
  final String? prontuario;
  final String status;
  final int meta;
  final String? sala;
  final DateTime? horaInicio;
  final int totalExtraidos;
  final int totalImplantados;
  final String? etapaAtual;
}

/// Quanto a clínica costuma implantar em cada área, pelos quartis do próprio
/// histórico. Usado pela calculadora: leve = 1º quartil, médio = mediana,
/// avançado = 3º quartil.
class AreaReferencia {
  AreaReferencia.fromJson(Map<String, dynamic> j)
      : area = _s(j['area']) ?? '—',
        ordem = _i(j['ordem']),
        cirurgias = _i(j['cirurgias']),
        leve = _i(j['leve']),
        medio = _i(j['medio']),
        avancado = _i(j['avancado']);

  final String area;
  final int ordem;
  final int cirurgias;
  final int leve;
  final int medio;
  final int avancado;

  int paraNivel(int nivel) => switch (nivel) { 0 => leve, 1 => medio, _ => avancado };
}
