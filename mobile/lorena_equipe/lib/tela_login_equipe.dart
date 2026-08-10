import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

/// A equipe entra com o mesmo login do CRM. Não há cadastro pelo app: quem cria
/// usuário é a gestão, no CRM.
class TelaLoginEquipe extends StatefulWidget {
  const TelaLoginEquipe({super.key, required this.aoEntrar});
  final VoidCallback aoEntrar;

  @override
  State<TelaLoginEquipe> createState() => _TelaLoginEquipeState();
}

class _TelaLoginEquipeState extends State<TelaLoginEquipe> {
  final _email = TextEditingController();
  final _senha = TextEditingController();
  bool _enviando = false;
  bool _mostrarSenha = false;

  @override
  void dispose() {
    _email.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (_enviando) return;
    setState(() => _enviando = true);
    try {
      await LorenaApi.instance.equipeEntrar(_email.text, _senha.text);
      if (!mounted) return;
      widget.aoEntrar();
    } catch (e) {
      if (!mounted) return;
      setState(() => _enviando = false);
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
                    child: Icon(Icons.badge_rounded, size: 36, color: cs.onPrimaryContainer),
                  ),
                  const SizedBox(height: 24),
                  Text(AppBrand.equipe.nome,
                      style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                  const SizedBox(height: 4),
                  Text(AppBrand.equipe.subtitulo!,
                      style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                  const SizedBox(height: 36),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'E-mail',
                      prefixIcon: Icon(Icons.alternate_email_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _senha,
                    obscureText: !_mostrarSenha,
                    decoration: InputDecoration(
                      labelText: 'Senha',
                      prefixIcon: const Icon(Icons.lock_outline_rounded),
                      suffixIcon: IconButton(
                        icon: Icon(_mostrarSenha ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                        onPressed: () => setState(() => _mostrarSenha = !_mostrarSenha),
                      ),
                    ),
                    onSubmitted: (_) => _entrar(),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _enviando ? null : _entrar,
                    child: _enviando
                        ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                        : const Text('Entrar'),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Use o mesmo e-mail e senha do CRM. Esqueceu a senha? Fale com a gestão.',
                    textAlign: TextAlign.center,
                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
