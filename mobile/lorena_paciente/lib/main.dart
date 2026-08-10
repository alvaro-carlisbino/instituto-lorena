import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  await LorenaApi.init();
  runApp(const AppPaciente());
}

/// App do Instituto Lorena. Abre PÚBLICO, não no login: a maior parte de quem
/// baixa ainda não é paciente, e um app que começa pedindo CPF perde essa
/// pessoa na primeira tela. O login vive dentro de "Minha área".
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
      home: const TelaShell(),
    );
  }
}
