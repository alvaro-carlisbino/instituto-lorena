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
| `enviar-imagens.ps1` | miniatura JPEG das fotos, para o bucket privado | principal |

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
(~250 KB) e sobe só a **captura mais recente de cada paciente**, que já traz uma foto
de cada região: ~18 mil imagens, ~4,5 GB.

```powershell
.\enviar-imagens.ps1 -Teste           # 3 pacientes
.\enviar-imagens.ps1                  # captura mais recente de cada um
.\enviar-imagens.ps1 -PausaMs 800     # segura o upload em horário de atendimento
.\enviar-imagens.ps1 -Tudo            # todas as capturas (vários dias)
```

Bucket `hairmetrix` é **privado**, aceita só `image/jpeg` e trava em 3 MB por arquivo
— o limite existe para impedir que alguém suba o PNG original por engano. Exibição
tem que usar URL assinada de vida curta, nunca link público.

## Pendente

- Exibir a foto na ficha (o caminho já vem em `tricoscopia[].imagem_path`)
- Tirar as duas máquinas da rede de visitantes; principal idealmente em cabo
- Sobrou no bucket um `.../99.jpg` de 160 bytes, do teste do endpoint. Inofensivo,
  dá para apagar pelo painel do Storage.
