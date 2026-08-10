import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';

/// Carrega algo do servidor e cuida sozinho dos três estados: carregando, erro
/// (com "tentar de novo") e vazio. Toda tela dos apps passa por aqui, então o
/// tratamento de falha é o mesmo em todo lugar.
class Carrega<T> extends StatefulWidget {
  const Carrega({
    super.key,
    required this.buscar,
    required this.constroi,
    this.vazio,
    this.temConteudo,
  });

  final Future<T> Function() buscar;
  final Widget Function(BuildContext, T, Future<void> Function()) constroi;
  final Widget? vazio;
  final bool Function(T)? temConteudo;

  @override
  State<Carrega<T>> createState() => _CarregaState<T>();
}

class _CarregaState<T> extends State<Carrega<T>> {
  late Future<T> _f;

  @override
  void initState() {
    super.initState();
    _f = widget.buscar();
  }

  Future<void> _recarregar() async {
    setState(() => _f = widget.buscar());
    await _f.catchError((_) => null as T);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _f,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: Padding(
            padding: EdgeInsets.all(48),
            child: CircularProgressIndicator(),
          ));
        }
        if (snap.hasError) {
          return MensagemVazia(
            icone: Icons.cloud_off_rounded,
            titulo: 'Não deu para carregar',
            descricao: '${snap.error}',
            acao: FilledButton.tonal(onPressed: _recarregar, child: const Text('Tentar de novo')),
          );
        }
        final dados = snap.data as T;
        final vazio = widget.temConteudo != null && !widget.temConteudo!(dados);
        if (vazio && widget.vazio != null) {
          return RefreshIndicator(
            onRefresh: _recarregar,
            child: ListView(children: [widget.vazio!]),
          );
        }
        return RefreshIndicator(
          onRefresh: _recarregar,
          child: widget.constroi(context, dados, _recarregar),
        );
      },
    );
  }
}

class MensagemVazia extends StatelessWidget {
  const MensagemVazia({
    super.key,
    required this.icone,
    required this.titulo,
    this.descricao,
    this.acao,
  });

  final IconData icone;
  final String titulo;
  final String? descricao;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 44, color: cs.outline),
            const SizedBox(height: 16),
            Text(titulo,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            if (descricao != null) ...[
              const SizedBox(height: 8),
              Text(descricao!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
            ],
            if (acao != null) ...[const SizedBox(height: 20), acao!],
          ],
        ),
      ),
    );
  }
}

class CartaoSecao extends StatelessWidget {
  const CartaoSecao({super.key, required this.titulo, required this.filho, this.acao});
  final String titulo;
  final Widget filho;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
          child: Row(
            children: [
              Expanded(
                child: Text(titulo,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        )),
              ),
              if (acao != null) acao!,
            ],
          ),
        ),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: filho)),
      ],
    );
  }
}

/// Campo de código de 6 dígitos. Um TextField só, estilizado — seis campos
/// separados dão mais bug de foco do que valor.
class CampoCodigo extends StatelessWidget {
  const CampoCodigo({super.key, required this.controller, this.onCompleto, this.autofocus = true});
  final TextEditingController controller;
  final ValueChanged<String>? onCompleto;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      maxLength: 6,
      style: const TextStyle(fontSize: 30, letterSpacing: 14, fontWeight: FontWeight.w700),
      decoration: const InputDecoration(counterText: '', hintText: '••••••'),
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onChanged: (v) {
        if (v.length == 6) onCompleto?.call(v);
      },
    );
  }
}

/// Formata CPF enquanto digita, sem brigar com o apagar.
class CpfFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue antes, TextEditingValue depois) {
    final d = depois.text.replaceAll(RegExp(r'\D'), '');
    final b = StringBuffer();
    for (var i = 0; i < d.length && i < 11; i++) {
      if (i == 3 || i == 6) b.write('.');
      if (i == 9) b.write('-');
      b.write(d[i]);
    }
    final t = b.toString();
    return TextEditingValue(text: t, selection: TextSelection.collapsed(offset: t.length));
  }
}

class TelefoneFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue antes, TextEditingValue depois) {
    final d = depois.text.replaceAll(RegExp(r'\D'), '');
    final b = StringBuffer();
    for (var i = 0; i < d.length && i < 11; i++) {
      if (i == 0) b.write('(');
      if (i == 2) b.write(') ');
      if (i == 7) b.write('-');
      b.write(d[i]);
    }
    final t = b.toString();
    return TextEditingValue(text: t, selection: TextSelection.collapsed(offset: t.length));
  }
}

void mostraErro(BuildContext context, Object e) {
  final msg = e is ApiErro ? e.toString() : 'Algo deu errado. Tente de novo.';
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg),
      behavior: SnackBarBehavior.floating,
      backgroundColor: Theme.of(context).colorScheme.errorContainer,
      showCloseIcon: true,
    ));
}

void mostraOk(BuildContext context, String msg) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
}
