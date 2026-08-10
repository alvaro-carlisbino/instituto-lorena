import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_captura.dart';

/// Bater ponto: selfie + GPS. A cerca é conferida no servidor (staff_punch) —
/// o app só mostra o resultado. Regra que mora só no cliente é regra que não
/// existe num app instalado no celular de quem ela regula.
class TelaPonto extends StatefulWidget {
  const TelaPonto({super.key});

  @override
  State<TelaPonto> createState() => _TelaPontoState();
}

class _TelaPontoState extends State<TelaPonto> {
  bool _batendo = false;
  Key _chave = UniqueKey();

  Future<void> _recarrega() async => setState(() => _chave = UniqueKey());

  Future<Position?> _posicao() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw ApiErro('gps_desligado', 'Ligue a localização do celular para bater o ponto.');
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
      throw ApiErro('sem_gps', 'Precisamos da sua localização para registrar o ponto.');
    }
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }

  Future<void> _bater() async {
    if (_batendo) return;
    setState(() => _batendo = true);
    try {
      final foto = await Navigator.of(context).push<XFile>(
        MaterialPageRoute(
          builder: (_) => const TelaCaptura(
            titulo: 'Selfie do ponto',
            instrucao: 'Enquadre o rosto e toque para registrar.',
            frontal: true,
          ),
        ),
      );
      if (foto == null) {
        if (mounted) setState(() => _batendo = false);
        return;
      }

      final pos = await _posicao();
      final bytes = await foto.readAsBytes();
      final path = await LorenaApi.instance.equipeEnviarSelfie(bytes, 'selfie.jpg');
      final b = await LorenaApi.instance.equipeBaterPonto(
        lat: pos!.latitude,
        lng: pos.longitude,
        selfiePath: path,
      );

      if (!mounted) return;
      setState(() => _batendo = false);
      mostraOk(context, 'Ponto registrado às ${DateFormat('HH:mm').format(b.at ?? DateTime.now())}');
      await _recarrega();
    } catch (e) {
      if (!mounted) return;
      setState(() => _batendo = false);
      mostraErro(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Carrega<(StaffMe?, List<Batida>)>(
      key: _chave,
      buscar: () async {
        final api = LorenaApi.instance;
        final r = await Future.wait([api.equipeEu(), api.equipeBatidasHoje()]);
        return (r[0] as StaffMe?, r[1] as List<Batida>);
      },
      constroi: (context, dados, _) {
        final (me, batidas) = dados;
        final cs = Theme.of(context).colorScheme;
        final tt = Theme.of(context).textTheme;
        final hora = DateFormat('HH:mm');

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(me?.nome ?? '', style: tt.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            Text(
              DateFormat("EEEE, d 'de' MMMM", 'pt_BR').format(DateTime.now()),
              style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            ),
            const SizedBox(height: 24),

            if (me != null && !me.podeBaterPonto)
              Card(
                color: cs.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Seu usuário ainda não tem ficha de colaborador no RH. '
                    'Sem ela não dá para bater ponto — fale com a gestão.',
                    style: tt.bodyMedium?.copyWith(color: cs.onErrorContainer),
                  ),
                ),
              )
            else
              FilledButton.icon(
                onPressed: _batendo ? null : _bater,
                icon: _batendo
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2.5))
                    : const Icon(Icons.fingerprint_rounded),
                label: Text(batidas.length.isEven ? 'Registrar entrada' : 'Registrar saída'),
              ),

            const SizedBox(height: 28),
            CartaoSecao(
              titulo: 'BATIDAS DE HOJE',
              filho: batidas.isEmpty
                  ? Text('Nenhuma batida ainda.',
                      style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant))
                  : Column(
                      children: [
                        for (var i = 0; i < batidas.length; i++)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Row(
                              children: [
                                Icon(
                                  i.isEven ? Icons.login_rounded : Icons.logout_rounded,
                                  size: 18,
                                  color: cs.primary,
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  batidas[i].at == null ? '—' : hora.format(batidas[i].at!),
                                  style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(width: 10),
                                Text(i.isEven ? 'entrada' : 'saída',
                                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                                const Spacer(),
                                if (batidas[i].manual)
                                  Text('ajuste', style: tt.bodySmall?.copyWith(color: cs.tertiary))
                                else if (batidas[i].distanciaM != null)
                                  Text('${batidas[i].distanciaM} m',
                                      style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                              ],
                            ),
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
