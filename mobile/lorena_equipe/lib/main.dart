import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_home.dart';
import 'tela_login_equipe.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  await LorenaApi.init();
  runApp(const AppEquipe());
}

class AppEquipe extends StatelessWidget {
  const AppEquipe({super.key});

  static const brand = AppBrand.equipe;

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
          return TelaLoginEquipe(aoEntrar: () => setState(() {}));
        }
        return const TelaHomeEquipe();
      },
    );
  }
}
