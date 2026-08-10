import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_captura.dart';

/// Captura de foto clínica. É esta tela que dá conteúdo ao app do paciente:
/// hoje não existe nenhuma foto de paciente em lugar nenhum do sistema.
class TelaFotosEquipe extends StatefulWidget {
  const TelaFotosEquipe({super.key});

  @override
  State<TelaFotosEquipe> createState() => _TelaFotosEquipeState();
}

class _TelaFotosEquipeState extends State<TelaFotosEquipe> {
  final _busca = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _resultados = [];
  bool _buscando = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _busca.dispose();
    super.dispose();
  }

  void _aoDigitar(String v) {
    _debounce?.cancel();
    if (v.trim().length < 3) {
      setState(() => _resultados = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _buscando = true);
      try {
        final r = await LorenaApi.instance.equipeBuscarPaciente(v.trim());
        if (mounted) setState(() => _resultados = r);
      } catch (e) {
        if (mounted) mostraErro(context, e);
      } finally {
        if (mounted) setState(() => _buscando = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: TextField(
            controller: _busca,
            onChanged: _aoDigitar,
            decoration: InputDecoration(
              hintText: 'Buscar paciente pelo nome',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _buscando
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : null,
            ),
          ),
        ),
        Expanded(
          child: _resultados.isEmpty
              ? MensagemVazia(
                  icone: Icons.person_search_outlined,
                  titulo: _busca.text.trim().length < 3
                      ? 'Busque o paciente'
                      : 'Nenhum paciente encontrado',
                  descricao: _busca.text.trim().length < 3
                      ? 'Digite pelo menos 3 letras do nome. A busca ignora acento e maiúscula.'
                      : 'Confira o nome. O cadastro vem da Shosp.',
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
                  itemCount: _resultados.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = _resultados[i];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: cs.primaryContainer,
                        child: Text(
                          (p['nome']?.toString() ?? '?').characters.first.toUpperCase(),
                          style: TextStyle(color: cs.onPrimaryContainer, fontWeight: FontWeight.w700),
                        ),
                      ),
                      title: Text(p['nome']?.toString() ?? '—',
                          style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                      subtitle: Text('Prontuário ${p['prontuario']}'),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => TelaFotosPaciente(
                            prontuario: p['prontuario'].toString(),
                            nome: p['nome']?.toString() ?? '',
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class TelaFotosPaciente extends StatefulWidget {
  const TelaFotosPaciente({super.key, required this.prontuario, required this.nome});
  final String prontuario;
  final String nome;

  @override
  State<TelaFotosPaciente> createState() => _TelaFotosPacienteState();
}

class _TelaFotosPacienteState extends State<TelaFotosPaciente> {
  Key _chave = UniqueKey();

  /// Guardado aqui, e não num FutureBuilder no build: um FutureBuilder no FAB
  /// dispararia uma consulta nova a cada rebuild da tela.
  List<FotoPaciente> _fotos = const [];

  Future<void> _capturar(List<FotoPaciente> existentes) async {
    final escolha = await showModalBottomSheet<(String, String)>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const _EscolhaMarcoAngulo(),
    );
    if (escolha == null || !mounted) return;
    final (marco, angulo) = escolha;

    // Fantasma: a última foto do MESMO ângulo. É o que faz o próximo registro
    // ser comparável com o anterior.
    String? fantasma;
    final anteriores = existentes.where((f) => f.angle == angulo).toList()
      ..sort((a, b) => (b.takenAt ?? DateTime(1900)).compareTo(a.takenAt ?? DateTime(1900)));
    if (anteriores.isNotEmpty) {
      try {
        fantasma = await LorenaApi.instance.urlAssinada(anteriores.first.storagePath);
      } catch (_) {/* sem fantasma é só menos ajuda, não é erro */}
    }

    if (!mounted) return;
    final foto = await Navigator.of(context).push<XFile>(
      MaterialPageRoute(
        builder: (_) => TelaCaptura(
          titulo: '${anguloRotulos[angulo]} · ${marcoRotulos[marco]}',
          instrucao: fantasma == null
              ? 'Enquadre dentro da moldura e mantenha a mesma distância nas próximas visitas.'
              : 'Alinhe com a foto anterior sobreposta. Use o controle para clarear ou escurecer.',
          fantasmaUrl: fantasma,
        ),
      ),
    );
    if (foto == null || !mounted) return;

    try {
      final bytes = await foto.readAsBytes();
      await LorenaApi.instance.equipeEnviarFotoClinica(
        prontuario: widget.prontuario,
        marco: marco,
        angulo: angulo,
        bytes: bytes,
      );
      if (!mounted) return;
      mostraOk(context, 'Foto registrada.');
      setState(() => _chave = UniqueKey());
    } catch (e) {
      if (mounted) mostraErro(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.nome.isEmpty ? 'Paciente' : widget.nome),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Prontuário ${widget.prontuario}',
                  style: Theme.of(context).textTheme.bodySmall),
            ),
          ),
        ),
      ),
      body: Carrega<List<FotoPaciente>>(
        key: _chave,
        buscar: () async {
          final l = await LorenaApi.instance.equipeFotosDoPaciente(widget.prontuario);
          _fotos = l;
          return l;
        },
        constroi: (context, fotos, _) {
          final cs = Theme.of(context).colorScheme;
          final tt = Theme.of(context).textTheme;
          if (fotos.isEmpty) {
            return ListView(children: const [
              MensagemVazia(
                icone: Icons.photo_camera_outlined,
                titulo: 'Nenhuma foto ainda',
                descricao: 'Toque no botão para registrar a primeira. Ela vira a referência '
                    'de enquadramento das próximas.',
              ),
            ]);
          }
          final porMarco = <String, List<FotoPaciente>>{};
          for (final f in fotos) {
            porMarco.putIfAbsent(f.milestone, () => []).add(f);
          }
          final marcos = porMarco.keys.toList()
            ..sort((a, b) => marcoRotulos.keys.toList().indexOf(a)
                .compareTo(marcoRotulos.keys.toList().indexOf(b)));

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              for (final m in marcos) ...[
                CartaoSecao(
                  titulo: (marcoRotulos[m] ?? m).toUpperCase(),
                  filho: Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final f in porMarco[m]!)
                        SizedBox(
                          width: 96,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: AspectRatio(
                                  aspectRatio: 3 / 4,
                                  child: FutureBuilder<String>(
                                    future: LorenaApi.instance.urlAssinada(f.storagePath),
                                    builder: (_, snap) => snap.hasData
                                        ? Image.network(snap.data!, fit: BoxFit.cover)
                                        : Container(color: cs.surfaceContainerHighest),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(f.anguloRotulo, style: tt.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                              if (f.takenAt != null)
                                Text(DateFormat('dd/MM/yy').format(f.takenAt!),
                                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _capturar(_fotos),
        icon: const Icon(Icons.photo_camera_rounded),
        label: const Text('Nova foto'),
      ),
    );
  }
}

class _EscolhaMarcoAngulo extends StatefulWidget {
  const _EscolhaMarcoAngulo();

  @override
  State<_EscolhaMarcoAngulo> createState() => _EscolhaMarcoAnguloState();
}

class _EscolhaMarcoAnguloState extends State<_EscolhaMarcoAngulo> {
  String _marco = 'pre_op';
  String _angulo = 'frontal';

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Momento do tratamento', style: tt.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                for (final e in marcoRotulos.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: _marco == e.key,
                    onSelected: (_) => setState(() => _marco = e.key),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            Text('Ângulo', style: tt.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                for (final a in angulos)
                  ChoiceChip(
                    label: Text(anguloRotulos[a] ?? a),
                    selected: _angulo == a,
                    onSelected: (_) => setState(() => _angulo = a),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => Navigator.pop(context, (_marco, _angulo)),
              icon: const Icon(Icons.photo_camera_rounded),
              label: const Text('Abrir câmera'),
            ),
          ],
        ),
      ),
    );
  }
}
