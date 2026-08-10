# Apps móveis — Instituto Lorena e Tricopill

Um codebase, três apps. O que muda entre eles é o flavor: marca, quem faz login e
quais telas existem.

| Pasta | App | Quem usa | Login |
|---|---|---|---|
| `lorena_core/` | pacote compartilhado | — | — |
| `lorena_paciente/` | Instituto Lorena | paciente da clínica | CPF + código |
| `lorena_equipe/` | Lorena Equipe | colaborador | e-mail e senha do CRM |
| `tricopill_app/` | Tricopill | cliente/assinante | WhatsApp + código |

Colaborador e paciente **não** compartilham binário de propósito: um bug de RLS no
app do cliente nunca pode virar paciente lendo prontuário alheio.

## Rodar

O SDK vem do FVM (stable 3.44.5, já em cache nesta máquina):

```
export PATH="$HOME/fvm/versions/stable/bin:$PATH"
cd mobile/lorena_paciente && flutter run
```

`SUPABASE_URL` e `SUPABASE_ANON_KEY` têm valor padrão embutido (a chave anon é
pública, a mesma que já vai no bundle do CRM web). Para apontar noutro projeto:

```
flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
```

## Onde ficam as regras

Nenhuma tela fala direto com o Supabase: tudo passa por `LorenaApi`
(`lorena_core/lib/src/api.dart`), e o servidor devolve por RPC exatamente o
recorte que cada perfil pode ver. Regra de acesso não mora no app.
