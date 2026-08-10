import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

/// Evolução em fotos. O valor está na comparação lado a lado: uma foto isolada
/// não diz nada, duas do mesmo ângulo em marcos diferentes dizem tudo.
class TelaFotos extends StatefulWidget {
  const TelaFotos({super.key});

  @override
  State<TelaFotos> createState() => _TelaFotosState();
}

class _TelaFotosState extends State<TelaFotos> {
  String? _anguloSelecionado;

  @override
  Widget build(BuildContext context) {
    return Carrega<List<FotoPaciente>>(
      buscar: LorenaApi.instance.pacienteFotos,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.photo_camera_outlined,
        titulo: 'Sua evolução começa na próxima visita',
        descricao: 'A equipe fotografa você sempre no mesmo enquadramento, nos marcos do '
            'tratamento. Assim dá para comparar de verdade, e não de memória.',
      ),
      constroi: (context, fotos, _) {
        final porAngulo = <String, List<FotoPaciente>>{};
        for (final f in fotos) {
          porAngulo.putIfAbsent(f.angle, () => []).add(f);
        }
        final angulosDisponiveis = porAngulo.keys.toList()
          ..sort((a, b) => angulos.indexOf(a).compareTo(angulos.indexOf(b)));
        final atual = _anguloSelecionado != null && porAngulo.containsKey(_anguloSelecionado)
            ? _anguloSelecionado!
            : angulosDisponiveis.first;
        final doAngulo = porAngulo[atual]!
          ..sort((a, b) => (a.takenAt ?? DateTime(1900)).compareTo(b.takenAt ?? DateTime(1900)));

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (angulosDisponiveis.length > 1)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final a in angulosDisponiveis)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(anguloRotulos[a] ?? a),
                          selected: a == atual,
                          onSelected: (_) => setState(() => _anguloSelecionado = a),
                        ),
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 16),

            if (doAngulo.length >= 2) ...[
              CartaoSecao(
                titulo: 'ANTES E DEPOIS',
                filho: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _Foto(doAngulo.first, destaque: true)),
                    const SizedBox(width: 12),
                    Expanded(child: _Foto(doAngulo.last, destaque: true)),
                  ],
                ),
              ),
              const SizedBox(height: 24),
            ],

            CartaoSecao(
              titulo: 'LINHA DO TEMPO',
              filho: Column(
                children: [
                  for (final f in doAngulo.reversed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: _Foto(f),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Foto extends StatelessWidget {
  const _Foto(this.foto, {this.destaque = false});
  final FotoPaciente foto;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(
          aspectRatio: 3 / 4,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: FutureBuilder<String>(
              // O bucket é privado; cada abertura pede uma URL assinada curta.
              future: LorenaApi.instance.urlAssinada(foto.storagePath),
              builder: (context, snap) {
                if (!snap.hasData) {
                  return Container(color: cs.surfaceContainerHighest);
                }
                return Image.network(
                  snap.data!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    color: cs.surfaceContainerHighest,
                    child: Icon(Icons.broken_image_outlined, color: cs.outline),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(foto.marcoRotulo,
            style: (destaque ? tt.bodyMedium : tt.bodyLarge)?.copyWith(fontWeight: FontWeight.w700)),
        if (foto.takenAt != null)
          Text(DateFormat('dd/MM/yyyy').format(foto.takenAt!),
              style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
      ],
    );
  }
}
