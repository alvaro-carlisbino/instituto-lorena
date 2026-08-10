import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

/// Erro que a tela pode mostrar direto para o usuário.
class ApiErro implements Exception {
  ApiErro(this.codigo, [this.mensagem]);
  final String codigo;
  final String? mensagem;

  @override
  String toString() => mensagem ?? _humano[codigo] ?? 'Algo deu errado. Tente de novo.';

  static const _humano = {
    'cpf_invalido': 'CPF inválido. Confira os 11 dígitos.',
    'telefone_invalido': 'Telefone inválido. Use DDD + número.',
    'codigo_invalido': 'Código incorreto.',
    'codigo_expirado': 'O código expirou. Peça um novo.',
    'tentativas_excedidas': 'Muitas tentativas. Peça um código novo.',
    'cliente_nao_encontrado': 'Não encontramos esse número no nosso cadastro.',
    'envio_falhou': 'Não conseguimos enviar o código agora.',
    'sem_conexao': 'Sem conexão. Verifique a internet.',
    'sem_permissao': 'Você não tem acesso a esta função.',
    'selfie_obrigatoria': 'A selfie é obrigatória para bater o ponto.',
    'usuario sem ficha de colaborador': 'Seu usuário ainda não tem ficha de colaborador. Fale com a gestão.',
  };
}

/// Ponte única com o Supabase. Todo app usa esta classe; nenhuma tela fala
/// direto com o cliente do Supabase.
class LorenaApi {
  LorenaApi._();
  static final instance = LorenaApi._();

  static Future<void> init() async {
    await Supabase.initialize(
      url: SupabaseConfig.url,
      publishableKey: SupabaseConfig.anonKey,
    );
  }

  SupabaseClient get _db => Supabase.instance.client;
  Session? get sessao => _db.auth.currentSession;
  bool get logado => sessao != null;
  Stream<AuthState> get mudancasDeAuth => _db.auth.onAuthStateChange;

  Future<void> sair() => _db.auth.signOut();

  // ------------------------------------------------------------- edge helper
  Future<Map<String, dynamic>> _edge(String fn, Map<String, dynamic> body) async {
    late http.Response r;
    try {
      r = await http
          .post(
            Uri.parse(SupabaseConfig.fn(fn)),
            headers: {
              'Content-Type': 'application/json',
              'apikey': SupabaseConfig.anonKey,
              'Authorization': 'Bearer ${sessao?.accessToken ?? SupabaseConfig.anonKey}',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));
    } catch (_) {
      throw ApiErro('sem_conexao');
    }
    Map<String, dynamic> j;
    try {
      j = jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiErro('resposta_invalida', 'Resposta inesperada do servidor.');
    }
    if (j['ok'] != true) throw ApiErro('${j['error'] ?? 'falhou'}');
    return j;
  }

  /// Troca o token de uso único devolvido pelas edges de login por uma sessão.
  Future<void> _abrirSessao(Map<String, dynamic> resp) async {
    final tokenHash = resp['token_hash']?.toString();
    if (tokenHash == null || tokenHash.isEmpty) throw ApiErro('sessao_falhou');
    await _db.auth.verifyOTP(tokenHash: tokenHash, type: OtpType.magiclink);
  }

  // =========================================================== PACIENTE
  /// Pede o código. A resposta é sempre a mesma, exista o CPF ou não — de
  /// propósito: confirmar "este CPF é paciente daqui" é dado de saúde.
  Future<void> pacienteSolicitarCodigo(String cpf) async {
    await _edge('crm-patient-auth', {'action': 'request', 'cpf': cpf});
  }

  Future<void> pacienteEntrar(String cpf, String codigo) async {
    final r = await _edge('crm-patient-auth', {'action': 'verify', 'cpf': cpf, 'code': codigo});
    await _abrirSessao(r);
  }

  Future<Map<String, dynamic>?> pacienteEu() async {
    final r = await _db.rpc('patient_me');
    final l = (r as List?) ?? [];
    return l.isEmpty ? null : Map<String, dynamic>.from(l.first);
  }

  Future<List<Cirurgia>> pacienteCirurgias() async {
    final r = await _db.rpc('patient_surgeries');
    final l = (r is String ? jsonDecode(r) : r) as List? ?? [];
    return l.map((e) => Cirurgia.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<List<Consulta>> pacienteConsultas() async {
    final r = await _db.rpc('patient_appointments');
    return ((r as List?) ?? [])
        .map((e) => Consulta.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<List<FotoPaciente>> pacienteFotos() async {
    final r = await _db.rpc('patient_photos_list');
    return ((r as List?) ?? [])
        .map((e) => FotoPaciente.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// O bucket é privado: a imagem só abre por URL assinada de vida curta.
  Future<String> urlAssinada(String path, {int segundos = 900}) =>
      _db.storage.from('paciente-fotos').createSignedUrl(path, segundos);

  // =========================================================== TRICOPILL
  Future<String?> clienteSolicitarCodigo(String telefone) async {
    final r = await _edge('crm-tricopill-auth', {'action': 'request', 'phone': telefone});
    return r['masked']?.toString();
  }

  Future<void> clienteEntrar(String telefone, String codigo) async {
    final r = await _edge('crm-tricopill-auth', {'action': 'verify', 'phone': telefone, 'code': codigo});
    await _abrirSessao(r);
  }

  Future<Map<String, dynamic>?> clienteEu() async {
    final r = await _db.rpc('customer_me');
    final l = (r as List?) ?? [];
    return l.isEmpty ? null : Map<String, dynamic>.from(l.first);
  }

  Future<List<Pedido>> clientePedidos() async {
    final r = await _db.rpc('customer_orders');
    final l = (r is String ? jsonDecode(r) : r) as List? ?? [];
    return l.map((e) => Pedido.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<Assinatura?> clienteAssinatura() async {
    final r = await _db.rpc('customer_subscription');
    final j = r is String ? jsonDecode(r) : r;
    if (j == null) return null;
    return Assinatura.fromJson(Map<String, dynamic>.from(j as Map));
  }

  // =========================================================== EQUIPE
  Future<void> equipeEntrar(String email, String senha) async {
    try {
      await _db.auth.signInWithPassword(email: email.trim(), password: senha);
    } on AuthException catch (e) {
      throw ApiErro('login_falhou', e.message.contains('Invalid')
          ? 'E-mail ou senha incorretos.'
          : e.message);
    }
  }

  Future<StaffMe?> equipeEu() async {
    final r = await _db.rpc('staff_me');
    final l = (r as List?) ?? [];
    return l.isEmpty ? null : StaffMe.fromJson(Map<String, dynamic>.from(l.first));
  }

  Future<List<Batida>> equipeBatidasHoje() async {
    final r = await _db.rpc('staff_punches_today');
    return ((r as List?) ?? []).map((e) => Batida.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  /// A cerca é conferida no servidor. Se estourar, vem `fora_da_cerca:<metros>`.
  Future<Batida> equipeBaterPonto({
    required double lat,
    required double lng,
    String? selfiePath,
    String? nota,
  }) async {
    try {
      final r = await _db.rpc('staff_punch', params: {
        'p_lat': lat,
        'p_lng': lng,
        'p_selfie_path': selfiePath,
        'p_note': nota,
      });
      final l = (r as List?) ?? [];
      if (l.isEmpty) throw ApiErro('ponto_falhou', 'Não foi possível registrar o ponto.');
      return Batida.fromJson(Map<String, dynamic>.from(l.first));
    } on PostgrestException catch (e) {
      final m = e.message;
      if (m.contains('fora_da_cerca')) {
        final metros = RegExp(r'fora_da_cerca:(\d+)').firstMatch(m)?.group(1);
        throw ApiErro('fora_da_cerca',
            'Você está ${metros ?? '?'} m do local. Chegue mais perto para bater o ponto.');
      }
      if (m.contains('selfie_obrigatoria')) throw ApiErro('selfie_obrigatoria');
      if (m.contains('ficha de colaborador')) throw ApiErro('usuario sem ficha de colaborador');
      throw ApiErro('ponto_falhou', m);
    }
  }

  Future<Uint8List?> baixarSelfie(String path) async {
    try {
      return await _db.storage.from('crm-lead-attachments').download(path);
    } catch (_) {
      return null;
    }
  }

  Future<String> equipeEnviarSelfie(Uint8List bytes, String nomeArquivo) async {
    final path = 'ponto/${DateTime.now().millisecondsSinceEpoch}-$nomeArquivo';
    await _db.storage.from('crm-lead-attachments').uploadBinary(
          path,
          bytes,
          fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: true),
        );
    return path;
  }

  Future<List<AgendaItem>> equipeAgendaHoje() async {
    final r = await _db.rpc('staff_agenda_hoje');
    return ((r as List?) ?? []).map((e) => AgendaItem.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<List<CirurgiaHoje>> equipeCirurgiasHoje() async {
    final r = await _db.rpc('staff_cirurgia_hoje');
    final l = (r is String ? jsonDecode(r) : r) as List? ?? [];
    return l.map((e) => CirurgiaHoje.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<List<Map<String, dynamic>>> equipeBuscarPaciente(String termo) async {
    final r = await _db.rpc('search_shosp_patients', params: {'q': termo});
    return ((r as List?) ?? []).map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<List<FotoPaciente>> equipeFotosDoPaciente(String prontuario) async {
    final r = await _db.rpc('staff_patient_photos', params: {'p_prontuario': prontuario});
    return ((r as List?) ?? [])
        .map((e) => FotoPaciente.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  /// Sobe a foto e registra. O caminho começa com o prontuário porque é assim
  /// que a policy do storage sabe de quem é a foto.
  Future<String> equipeEnviarFotoClinica({
    required String prontuario,
    required String marco,
    required String angulo,
    required Uint8List bytes,
    int? cirurgiaId,
  }) async {
    final path = '$prontuario/$marco/$angulo-${DateTime.now().millisecondsSinceEpoch}.jpg';
    await _db.storage.from('paciente-fotos').uploadBinary(
          path,
          bytes,
          fileOptions: const FileOptions(contentType: 'image/jpeg', upsert: true),
        );
    await _db.rpc('staff_photo_register', params: {
      'p_prontuario': prontuario,
      'p_storage_path': path,
      'p_angle': angulo,
      'p_milestone': marco,
      'p_surgery_id': cirurgiaId,
    });
    return path;
  }
}
