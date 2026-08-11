# HairMetrix (Canfield Mirror) → CRM

Integração do sistema de tricoscopia da clínica com o CRM. Levantado em 10/08/2026.

## O ambiente

| | |
|---|---|
| Máquina principal | `DESKTOP-D47ENNF` = `192.168.50.119` (hospeda tudo) |
| Máquina secundária | `192.168.50.32` (só cliente) |
| Produto | Canfield **Mirror** 7512, módulo HairMetrix |
| Banco | SQL Server 2019, instância `MSSQL$CANFIELD` (`MSSQL15.CANFIELD`) |
| Aparelho | VISIOMED 16, série 9906, magnificação 15, **187,12 px/mm** |
| Volume | 3.041 pacientes, 2.985 com exame, 32.331 capturas |

As duas máquinas estavam no SSID **"Visitantes Instituto Lorena V."**, com perfil de
rede `Public`. Precisam sair da rede de visitantes: além do risco LGPD de banco de
saúde no Wi-Fi de convidados, rede de visitante costuma filtrar multicast, e a
Canfield usa Bonjour (mDNS, UDP 5353) para as máquinas se descobrirem.

## A causa raiz do "não compartilha o banco"

Não era ping, nem roteador, nem TI de terceiro. A instância `CANFIELD` subia em
**porta dinâmica** (50255 no dia), que muda a cada restart. O cliente só descobriria
essa porta perguntando ao SQL Browser na **UDP 1434**, que estava bloqueada. Resultado:
a secundária nunca achava o banco.

Corrigido fixando a porta em 1433:

```
HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL15.CANFIELD\MSSQLServer\SuperSocketNetLib\Tcp\IPAll
  TcpPort         = 1433
  TcpDynamicPorts = (vazio)
```

**Pegadinha de diagnóstico:** conectar em `192.168.50.119\CANFIELD` a partir da
própria `.119` devolve `Open` mesmo sem TCP nenhum, porque cai em Shared Memory. E
`Test-NetConnection` para o próprio IP não passa pelo firewall. Teste de rede só
vale rodado da **outra** máquina.

## Onde os dados realmente estão

Não estão em tabela. Estão em arquivo:

```
C:\ProgramData\Canfield\Databases\MirrorDatabase\
  SOBRENOME, NOME (20260220132717638)\        ← id = timestamp do cadastro
    20260220133728064\                        ← id = timestamp da captura
      tricho_0.png                            imagem
      tricho_0.json                           detecção bruta
      tricho_0_input.json                     ppmm, roi, região, aparelho
      worklist.ini                            roteiro das 6 regiões da sessão
```

O `tricho_N.json` traz `follicle_units[]` e `hairs[]` (cada fio com `w` espessura,
`h` comprimento, `a` ângulo, `score`, `valid`). Não traz métrica pronta: as métricas
clínicas são derivadas disso pelo agente.

**Ler arquivo em vez de tabela é decisão de projeto**, não atalho: nada encosta no
banco do fornecedor, então não há risco de garantia nem de quebrar quando a Canfield
atualizar o schema.

## Região faz parte da chave clínica

A sessão padrão captura seis pontos: `Temporal 1 right`, `Frontal 1`,
`Temporal 1 left`, `Mid`, `Vertex center`, `Occiput 3 left`.

Occipital é **área doadora e não rala**; vertex é onde a calvície avança. Somar os
seis num número só, ou comparar um com o outro, produz gráfico bonito e conclusão
errada. Toda evolução é calculada dentro da mesma região.

Efeito colateral bom: o occipital vira **controle interno**. Se ele oscilar entre
exames, o que mudou foi a técnica de captura, não o tratamento.

## Os scripts

| Arquivo | O que faz | Onde roda |
|---|---|---|
| `01-rede-diagnostico-e-fix.ps1` | diagnostica e corrige a comunicação entre as duas máquinas | nas **duas** |
| `02-hairmetrix-descoberta.ps1` | mapeia instância, bancos, schema e pastas. Somente leitura | principal |
| `sync-hairmetrix.ps1` | o agente: lê as pastas, agrega e envia pro CRM | principal |
| `enviar-imagens.ps1` | miniatura JPEG das fotos, para o bucket privado. Use `-Fila` | principal |

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\sync-hairmetrix.ps1 -Teste     # 3 pacientes, não grava estado
.\sync-hairmetrix.ps1            # tudo que ainda não foi enviado
.\sync-hairmetrix.ps1 -Recomecar # ignora o estado e reprocessa
```

Estado em `C:\ProgramData\LorenaHairMetrix\capturas-enviadas.txt`. A primeira
rodada é longa (32 mil arquivos JSON, ordem de 1 a 2 horas); as seguintes são
incrementais e levam segundos.

## O lado do CRM

- Migration `supabase/migrations/20260810250000_hairmetrix_espelho.sql`
- Edge function `supabase/functions/hairmetrix-sync/` (`verify_jwt = false`)
- Autenticação por token do agente, SHA-256 em `hairmetrix_agent_keys`.
  Não usamos service_role key: máquina de consultório tem login compartilhado.
  Rotação = inserir chave nova, marcar a velha como `ativo = false`.

Tabelas: `hairmetrix_pacientes` → `hairmetrix_exames` → `hairmetrix_medidas`,
mais `hairmetrix_imagens` e `hairmetrix_sync_log`.

RPCs:

```sql
select * from hairmetrix_evolucao('<lead_id>');            -- todas as regiões
select * from hairmetrix_evolucao('<lead_id>', 'Vertex center');
select * from hairmetrix_pendentes_vinculo(50);            -- fila de vínculo
```

## Sanidade das métricas

Fio de `w ≈ 15 px` a 187,12 px/mm vira **80 µm**, espessura de fio terminal.
Miniaturizado (abaixo de 40 µm) cai em `w < 7,5 px`. Os números batem com a
fisiologia, o que valida o mapeamento.

A área analisada vem do polígono `roi` do `_input.json` (~0,90 cm²), **não** da
imagem inteira: usar a imagem toda infla a área e derruba a densidade
artificialmente.

`fios_por_uf` é a métrica mais confiável do conjunto, por ser razão entre duas
contagens: sai correta mesmo sem calibração.

## Imagens

O `tricho_N.png` tem 2274×2048 e 4 a 8 MB. As 32 mil capturas dariam **130 a 250 GB**
e dias de upload. O `enviar-imagens.ps1` converte para JPEG de no máximo 1400px
(~250 KB).

Mesmo assim, o modo padrão — a captura mais recente de *cada* paciente — dá ~18 mil
imagens e ~4,5 GB. Foi por isso que **este script nunca terminou uma rodada e
`hairmetrix_imagens` está com zero linha** desde 10/08/2026.

### `-Fila` é o modo para o dia a dia

O médico abre o laudo em `/tricoscopia/<paciente>` e clica em *Pedir as fotos deste
paciente*. Isso enfileira em `hairmetrix_pedidos_imagem`. Com `-Fila`, o agente lê a
fila (`action: 'fila'`), sobe a **primeira e a última** captura só daqueles pacientes
— o antes e depois que o laudo compara — e fecha o pedido (`action: 'fila-ok'`).

São ~12 imagens e ~3 MB por paciente. No ritmo real da clínica isso é alguns MB por
dia, e o acervo se forma sozinho, começando por quem está sendo atendido.

```powershell
.\enviar-imagens.ps1 -Fila            # <<< agendar de hora em hora
.\enviar-imagens.ps1 -Teste           # 3 pacientes
.\enviar-imagens.ps1                  # captura mais recente de cada um (~4,5 GB)
.\enviar-imagens.ps1 -PausaMs 800     # segura o upload em horário de atendimento
.\enviar-imagens.ps1 -Tudo            # todas as capturas (vários dias)
```

Agendador de Tarefas do Windows, de hora em hora:

```powershell
schtasks /create /tn "LorenaHairMetrix-Fila" /sc hourly ^
  /tr "powershell -ExecutionPolicy Bypass -File C:\Lorena\enviar-imagens.ps1 -Fila" /ru SYSTEM
```

Fila vazia sai em 1 segundo com `exit 0`, então rodar de hora em hora não custa nada.
Pedido cuja pasta não existe no disco, ou que não tem PNG, também é fechado — pedido
que não fecha voltaria na fila para sempre.

### Enquanto a foto não chega

O laudo não fica vazio: ele **desenha** 1 cm² do campo folicular a partir das medidas
(unidades por cm², fios por unidade, distribuição de espessura). Ver
`src/lib/campoFolicular.ts`. Não é a foto, a tela diz isso em letra grande, e custa
zero de upload — funciona para os 2.984 pacientes hoje.

Bucket `hairmetrix` é **privado**, aceita só `image/jpeg` e trava em 3 MB por arquivo
— o limite existe para impedir que alguém suba o PNG original por engano. Exibição
tem que usar URL assinada de vida curta, nunca link público.

## Pendente

- **Rodar o `enviar-imagens.ps1 -Fila`**: o token ainda está como `COLE_O_TOKEN_AQUI`
  e nenhuma foto subiu até hoje. Já existe um pedido de teste na fila (Wichoski,
  Marcio) que serve de primeira rodada.
- Tirar as duas máquinas da rede de visitantes; principal idealmente em cabo
- Sobrou no bucket um `.../99.jpg` de 160 bytes, do teste do endpoint. Inofensivo,
  dá para apagar pelo painel do Storage.
