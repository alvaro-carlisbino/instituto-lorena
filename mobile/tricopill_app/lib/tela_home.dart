import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';
import 'package:url_launcher/url_launcher.dart';

import 'tela_hoje.dart';
import 'tela_assinatura.dart';
import 'tela_pedidos.dart';

class TelaHomeTricopill extends StatefulWidget {
  const TelaHomeTricopill({super.key});

  @override
  State<TelaHomeTricopill> createState() => _TelaHomeTricopillState();
}

class _TelaHomeTricopillState extends State<TelaHomeTricopill> {
  int _aba = 0;
  static const _titulos = ['Hoje', 'Minha assinatura', 'Meus pedidos'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_titulos[_aba]),
        actions: [
          IconButton(
            tooltip: 'Falar com a gente',
            icon: const Icon(Icons.chat_bubble_outline_rounded),
            onPressed: () => launchUrl(
              Uri.parse('https://wa.me/${AppBrand.tricopill.suporteWhatsapp}'),
              mode: LaunchMode.externalApplication,
            ),
          ),
          IconButton(
            tooltip: 'Conta',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: _abrirConta,
          ),
        ],
      ),
      body: IndexedStack(
        index: _aba,
        children: const [TelaHoje(), TelaAssinatura(), TelaPedidos()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: (i) => setState(() => _aba = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today_rounded), label: 'Hoje'),
          NavigationDestination(icon: Icon(Icons.autorenew_outlined), selectedIcon: Icon(Icons.autorenew_rounded), label: 'Assinatura'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long_rounded), label: 'Pedidos'),
        ],
      ),
    );
  }

  Future<void> _abrirConta() async {
    final me = await LorenaApi.instance.clienteEu();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(me?['nome']?.toString() ?? 'Cliente'),
              subtitle: Text(me?['phone']?.toString() ?? ''),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.storefront_outlined),
              title: const Text('Abrir a loja'),
              onTap: () => launchUrl(
                Uri.parse('https://tricopill.com.br'),
                mode: LaunchMode.externalApplication,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.logout_rounded),
              title: const Text('Sair'),
              onTap: () async {
                Navigator.pop(ctx);
                await LorenaApi.instance.sair();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
