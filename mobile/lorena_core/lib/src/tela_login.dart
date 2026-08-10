import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'config.dart';
import 'widgets.dart';

/// Login em duas etapas (identificação → código), compartilhado pelos apps do
/// paciente e do Tricopill. Muda só o que se digita: CPF numa ponta, telefone
/// na outra. O app da equipe usa e-mail e senha e tem tela própria.
class TelaLoginCodigo extends StatefulWidget {
  const TelaLoginCodigo({
    super.key,
    required this.brand,
    required this.aoEntrar,
  });

  final AppBrand brand;
  final VoidCallback aoEntrar;

  bool get porCpf => brand.flavor == AppFlavor.paciente;

  @override
  State<TelaLoginCodigo> createState() => _TelaLoginCodigoState();
}

class _TelaLoginCodigoState extends State<TelaLoginCodigo> {
  final _idCtrl = TextEditingController();
  final _codigoCtrl = TextEditingController();
  bool _enviando = false;
  bool _etapaCodigo = false;
  String? _mascarado;
  int _segundosParaReenviar = 0;
  Timer? _timer;

  String get _idLimpo => _idCtrl.text.replaceAll(RegExp(r'\D'), '');
  bool get _idValido => widget.porCpf ? _idLimpo.length == 11 : _idLimpo.length >= 10;

  @override
  void dispose() {
    _timer?.cancel();
    _idCtrl.dispose();
    _codigoCtrl.dispose();
    super.dispose();
  }

  void _iniciaContagem() {
    _segundosParaReenviar = 60;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _segundosParaReenviar--);
      if (_segundosParaReenviar <= 0) t.cancel();
    });
  }

  Future<void> _pedirCodigo() async {
    if (!_idValido || _enviando) return;
    setState(() => _enviando = true);
    try {
      if (widget.porCpf) {
        await LorenaApi.instance.pacienteSolicitarCodigo(_idLimpo);
      } else {
        _mascarado = await LorenaApi.instance.clienteSolicitarCodigo(_idLimpo);
      }
      if (!mounted) return;
      setState(() {
        _etapaCodigo = true;
        _enviando = false;
      });
      _iniciaContagem();
    } catch (e) {
      if (!mounted) return;
      setState(() => _enviando = false);
      mostraErro(context, e);
    }
  }

  Future<void> _entrar([String? codigo]) async {
    final c = (codigo ?? _codigoCtrl.text).replaceAll(RegExp(r'\D'), '');
    if (c.length != 6 || _enviando) return;
    setState(() => _enviando = true);
    try {
      if (widget.porCpf) {
        await LorenaApi.instance.pacienteEntrar(_idLimpo, c);
      } else {
        await LorenaApi.instance.clienteEntrar(_idLimpo, c);
      }
      if (!mounted) return;
      widget.aoEntrar();
    } catch (e) {
      if (!mounted) return;
      setState(() => _enviando = false);
      _codigoCtrl.clear();
      mostraErro(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    height: 72,
                    width: 72,
                    decoration: BoxDecoration(
                      color: cs.primaryContainer,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Icon(
                      widget.brand.flavor == AppFlavor.tricopill
                          ? Icons.medication_liquid_rounded
                          : Icons.spa_rounded,
                      size: 36,
                      color: cs.onPrimaryContainer,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(widget.brand.nome,
                      style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                  if (widget.brand.subtitulo != null) ...[
                    const SizedBox(height: 4),
                    Text(widget.brand.subtitulo!,
                        style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                  ],
                  const SizedBox(height: 36),
                  if (!_etapaCodigo) ..._etapaIdentificacao(cs, tt) else ..._etapaCodigoWidgets(cs, tt),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _etapaIdentificacao(ColorScheme cs, TextTheme tt) => [
        Text(widget.porCpf ? 'Seu CPF' : 'Seu WhatsApp',
            style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text(
          widget.porCpf
              ? 'Enviamos um código para o contato do seu cadastro na clínica.'
              : 'Enviamos um código para o seu WhatsApp.',
          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _idCtrl,
          keyboardType: TextInputType.number,
          autofocus: true,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            if (widget.porCpf) CpfFormatter() else TelefoneFormatter(),
          ],
          decoration: InputDecoration(
            hintText: widget.porCpf ? '000.000.000-00' : '(44) 90000-0000',
            prefixIcon: Icon(widget.porCpf ? Icons.badge_outlined : Icons.phone_iphone_rounded),
          ),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _pedirCodigo(),
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _idValido && !_enviando ? _pedirCodigo : null,
          child: _enviando
              ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
              : const Text('Receber código'),
        ),
      ];

  List<Widget> _etapaCodigoWidgets(ColorScheme cs, TextTheme tt) => [
        Text('Digite o código', style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text(
          _mascarado != null
              ? 'Enviamos 6 dígitos para $_mascarado.'
              : 'Se este ${widget.porCpf ? 'CPF' : 'número'} estiver cadastrado, enviamos 6 dígitos '
                  'para o contato do cadastro.',
          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        CampoCodigo(controller: _codigoCtrl, onCompleto: _entrar),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _enviando ? null : () => _entrar(),
          child: _enviando
              ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
              : const Text('Entrar'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _segundosParaReenviar > 0 || _enviando ? null : _pedirCodigo,
          child: Text(_segundosParaReenviar > 0
              ? 'Reenviar em ${_segundosParaReenviar}s'
              : 'Reenviar código'),
        ),
        TextButton(
          onPressed: () => setState(() {
            _etapaCodigo = false;
            _codigoCtrl.clear();
          }),
          child: const Text('Corrigir os dados'),
        ),
        const SizedBox(height: 8),
        Text(
          'Não recebeu? Fale com a gente no WhatsApp.',
          textAlign: TextAlign.center,
          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
        ),
      ];
}
