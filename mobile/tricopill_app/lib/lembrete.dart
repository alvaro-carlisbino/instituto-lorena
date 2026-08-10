import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Lembrete diário da cápsula. É o motivo de existir um app para um suplemento:
/// quem esquece de tomar para de comprar. Tudo local — não depende do servidor
/// nem gasta push.
class Lembrete {
  Lembrete._();
  static final instance = Lembrete._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static const _chaveLigado = 'lembrete_ligado';
  static const _chaveHora = 'lembrete_hora';
  static const _chaveMinuto = 'lembrete_minuto';
  static const _idManha = 1001;
  static const _idNoite = 1002;

  bool _pronto = false;

  Future<void> iniciar() async {
    if (_pronto) return;
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('America/Sao_Paulo'));
    await _plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
    );
    _pronto = true;
  }

  Future<bool> pedirPermissao() async {
    await iniciar();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return await ios.requestPermissions(alert: true, badge: true, sound: true) ?? false;
    }
    final android =
        _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return await android.requestNotificationsPermission() ?? false;
    }
    return false;
  }

  Future<({bool ligado, TimeOfDay hora})> ler() async {
    final p = await SharedPreferences.getInstance();
    return (
      ligado: p.getBool(_chaveLigado) ?? false,
      hora: TimeOfDay(
        hour: p.getInt(_chaveHora) ?? 8,
        minute: p.getInt(_chaveMinuto) ?? 0,
      ),
    );
  }

  /// A posologia é 2 cápsulas por dia: agendamos manhã e 12 horas depois.
  Future<void> definir({required bool ligado, required TimeOfDay hora}) async {
    await iniciar();
    final p = await SharedPreferences.getInstance();
    await p.setBool(_chaveLigado, ligado);
    await p.setInt(_chaveHora, hora.hour);
    await p.setInt(_chaveMinuto, hora.minute);

    await _plugin.cancel(_idManha);
    await _plugin.cancel(_idNoite);
    if (!ligado) return;

    await _agenda(_idManha, hora, 'Hora da sua cápsula', 'Primeira dose do dia.');
    final segunda = TimeOfDay(hour: (hora.hour + 12) % 24, minute: hora.minute);
    await _agenda(_idNoite, segunda, 'Segunda cápsula', 'Fecha a dose do dia.');
  }

  Future<void> _agenda(int id, TimeOfDay hora, String titulo, String corpo) async {
    await _plugin.zonedSchedule(
      id,
      titulo,
      corpo,
      _proximaOcorrencia(hora),
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'tricopill_lembrete',
          'Lembrete da cápsula',
          channelDescription: 'Aviso diário para tomar o Tricopill',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      matchDateTimeComponents: DateTimeComponents.time,
    );
  }

  tz.TZDateTime _proximaOcorrencia(TimeOfDay t) {
    final agora = tz.TZDateTime.now(tz.local);
    var quando = tz.TZDateTime(tz.local, agora.year, agora.month, agora.day, t.hour, t.minute);
    if (!quando.isAfter(agora)) quando = quando.add(const Duration(days: 1));
    return quando;
  }
}
