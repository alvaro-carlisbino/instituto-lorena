/// Núcleo compartilhado dos apps do Instituto Lorena e do Tricopill.
///
/// Os três apps (paciente, equipe, cliente Tricopill) saem deste mesmo código.
/// O que varia é o flavor: marca, cores, quem loga e quais telas existem.
library;

// Reexportado para as telas não precisarem depender do SDK direto.
export 'package:supabase_flutter/supabase_flutter.dart' show AuthState, Session;

export 'src/api.dart';
export 'src/config.dart';
export 'src/models.dart';
export 'src/theme.dart';
export 'src/tela_login.dart';
export 'src/widgets.dart';
