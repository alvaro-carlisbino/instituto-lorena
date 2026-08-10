import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_home.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  await LorenaApi.init();
  runApp(const AppPaciente());
}

class AppPaciente extends StatelessWidget {
  const AppPaciente({super.key});

  static const brand = AppBrand.paciente;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: brand.nome,
      debugShowCheckedModeBanner: false,
      theme: lorenaTheme(brand, Brightness.light),
      darkTheme: lorenaTheme(brand, Brightness.dark),
      home: const _Porta(),
    );
  }
}

/// Decide entre login e app conforme a sessão do Supabase — e reage a
/// logout/expiração sem precisar de navegação manual.
class _Porta extends StatefulWidget {
  const _Porta();

  @override
  State<_Porta> createState() => _PortaState();
}

class _PortaState extends State<_Porta> {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: LorenaApi.instance.mudancasDeAuth,
      builder: (context, _) {
        if (!LorenaApi.instance.logado) {
          return TelaLoginCodigo(
            brand: AppPaciente.brand,
            aoEntrar: () => setState(() {}),
          );
        }
        return const TelaHome();
      },
    );
  }
}
