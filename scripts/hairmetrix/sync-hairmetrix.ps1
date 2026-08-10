#Requires -Version 5.1
<#
    sync-hairmetrix.ps1
    Instituto Lorena - agente que leva os exames de tricoscopia do HairMetrix
    (Canfield Mirror) para o CRM.

    RODA NA MAQUINA PRINCIPAL DA CLINICA (DESKTOP-D47ENNF / 192.168.50.119).

    O QUE ELE FAZ
      Le as pastas de C:\ProgramData\Canfield\Databases\MirrorDatabase, calcula os
      agregados de cada captura e manda por HTTPS de SAIDA para a edge function
      hairmetrix-sync. Nao abre porta, nao expoe banco, nao escreve nada no
      sistema da Canfield. E somente leitura do disco.

    POR QUE ARQUIVO E NAO BANCO
      O resultado da analise nao esta em tabela do SQL Server, esta em
      tricho_N.json dentro da pasta da captura. Ler arquivo evita encostar no
      banco do fornecedor: sem risco de garantia e sem quebrar quando eles
      atualizarem o schema.

    O BRUTO NAO SAI DA CLINICA
      Um tricho_N.json tem centenas de fios. As 32 mil capturas passariam de 6 GB
      no fio. O agente calcula aqui e manda ~20 numeros por captura.

    USO
      .\sync-hairmetrix.ps1 -Teste              # 3 pacientes, nao grava estado
      .\sync-hairmetrix.ps1                     # tudo que ainda nao foi enviado
      .\sync-hairmetrix.ps1 -Recomecar          # ignora o estado e reprocessa

    O estado fica em C:\ProgramData\LorenaHairMetrix\capturas-enviadas.txt.
    Rodar duas vezes nao duplica nada: o servidor faz upsert por chave.
#>

param(
  [string]$Raiz     = 'C:\ProgramData\Canfield\Databases\MirrorDatabase',
  [string]$Endpoint = 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/hairmetrix-sync',
  [string]$Token    = 'COLE_O_TOKEN_AQUI',
  [int]$MaxPacientes  = 0,          # 0 = todos
  [int]$LotePacientes = 20,
  [switch]$Recomecar,
  [switch]$Teste
)

$ErrorActionPreference = 'Continue'

# PS 5.1 ainda negocia TLS 1.0 por padrao em maquina antiga. Sem isto o POST no
# Supabase morre com "conexao subjacente foi fechada" e parece problema de rede.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$pastaEstado  = 'C:\ProgramData\LorenaHairMetrix'
$arquivoEstado = Join-Path $pastaEstado 'capturas-enviadas.txt'
$arquivoLog    = Join-Path $pastaEstado ("sync-{0}.log" -f (Get-Date -Format 'yyyy-MM'))
New-Item -ItemType Directory -Force -Path $pastaEstado | Out-Null

function Log($msg, $cor = 'Gray') {
  $linha = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $linha -ForegroundColor $cor
  Add-Content -Path $arquivoLog -Value $linha -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Os ids do Mirror sao timestamp local: AAAAMMDDHHMMSSmmm (17) ou AAAAMMDDHHMMSS (14).
# Carimbamos -03:00 na mao. Deixar o PowerShell converter usaria o fuso do processo
# e jogaria exame de manha pra madrugada do dia anterior no banco.
function ConvertFrom-MirrorId([string]$id) {
  if ($id -match '^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{0,3})$') {
    $ms = if ($matches[7]) { $matches[7].PadRight(3,'0') } else { '000' }
    return "{0}-{1}-{2}T{3}:{4}:{5}.{6}-03:00" -f `
      $matches[1], $matches[2], $matches[3], $matches[4], $matches[5], $matches[6], $ms
  }
  return $null
}

function Get-Media($valores) {
  if (-not $valores -or $valores.Count -eq 0) { return $null }
  $s = 0.0; foreach ($v in $valores) { $s += $v }
  return $s / $valores.Count
}

function Get-Percentil($ordenados, [double]$p) {
  if (-not $ordenados -or $ordenados.Count -eq 0) { return $null }
  $i = [int][Math]::Floor($p * ($ordenados.Count - 1))
  if ($i -lt 0) { $i = 0 }
  if ($i -ge $ordenados.Count) { $i = $ordenados.Count - 1 }
  return $ordenados[$i]
}

# Area do poligono roi pela formula do shoelace. Usar a imagem inteira infla a area
# e derruba a densidade artificialmente: o Mirror analisa so o retangulo do roi.
function Get-AreaPoligonoPx($roi) {
  if (-not $roi -or $roi.Count -lt 3) { return $null }
  $soma = 0.0
  for ($i = 0; $i -lt $roi.Count; $i++) {
    $a = $roi[$i]; $b = $roi[($i + 1) % $roi.Count]
    $soma += ([double]$a[0] * [double]$b[1]) - ([double]$b[0] * [double]$a[1])
  }
  return [Math]::Abs($soma) / 2.0
}

function Send-Lote($payload, [string]$rotulo) {
  $json  = $payload | ConvertTo-Json -Depth 12 -Compress
  # UTF8 explicito: nome de paciente tem acento (ANGELA, ALVARES) e sem isto
  # chega corrompido no banco.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $head  = @{ 'x-hairmetrix-token' = $Token }

  for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
    try {
      return Invoke-RestMethod -Uri $Endpoint -Method Post -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -Headers $head -TimeoutSec 120
    } catch {
      $msg = $_.Exception.Message
      if ($tentativa -eq 3) { Log "FALHA em $rotulo apos 3 tentativas: $msg" 'Red'; return $null }
      Log "  tentativa $tentativa falhou ($msg), repetindo em $($tentativa * 5)s" 'Yellow'
      Start-Sleep -Seconds ($tentativa * 5)
    }
  }
}

# ---------------------------------------------------------------------------
# Le uma captura (uma pasta tricho) e devolve o agregado
# ---------------------------------------------------------------------------
function Read-Medida([string]$pastaCaptura, [int]$indice) {
  $fAnalise = Join-Path $pastaCaptura "tricho_$indice.json"
  $fEntrada = Join-Path $pastaCaptura "tricho_${indice}_input.json"
  if (-not (Test-Path $fAnalise)) { return $null }

  try { $a = Get-Content $fAnalise -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }

  $ppmm = $null; $regiao = $null; $guid = $null; $areaPx = $null
  $dispositivo = $null; $serial = $null; $magnif = $null; $zoom = $null; $consulta = $null
  if (Test-Path $fEntrada) {
    try {
      $e = Get-Content $fEntrada -Raw -Encoding UTF8 | ConvertFrom-Json
      $consulta = $e.consultation_guid
      $ai = $e.AnalysisInput
      if ($ai) {
        $ppmm        = [double]$ai.ppmm
        $regiao      = $ai.location
        $guid        = $ai.guid
        $areaPx      = Get-AreaPoligonoPx $ai.roi
        $dispositivo = $ai.deviceType
        $serial      = [string]$ai.serialNo
        $magnif      = $ai.magnification
        $zoom        = $ai.zoomLevel
      }
    } catch { }
  }

  $ufs   = if ($a.follicle_units) { @($a.follicle_units).Count } else { 0 }
  $todos = if ($a.hairs) { @($a.hairs) } else { @() }
  $val   = @($todos | Where-Object { $_.valid })

  # List<double> e nao array. Com `+=` em array, cada fio recopia o vetor inteiro:
  # ~300 fios x 32 mil arquivos = bilhoes de operacoes e o agente roda por dias.
  $larguras = New-Object 'System.Collections.Generic.List[double]'
  $alturas  = New-Object 'System.Collections.Generic.List[double]'
  $scores   = New-Object 'System.Collections.Generic.List[double]'
  foreach ($h in $val) {
    if ($null -ne $h.w)     { $larguras.Add([double]$h.w) }
    if ($null -ne $h.h)     { $alturas.Add([double]$h.h) }
    if ($null -ne $h.score) { $scores.Add([double]$h.score) }
  }
  $ordenadas = New-Object 'System.Collections.Generic.List[double]' (,$larguras)
  $ordenadas.Sort()

  $mediaW = Get-Media $larguras
  $medida = [ordered]@{
    indice               = $indice
    guid                 = $guid
    regiao               = $regiao
    evaluator            = $a.evaluator
    unidades_foliculares = $ufs
    fios_total           = $todos.Count
    fios_validos         = $val.Count
    fios_por_uf          = if ($ufs -gt 0) { [Math]::Round($val.Count / $ufs, 3) } else { $null }
    espessura_media_px   = if ($mediaW) { [Math]::Round($mediaW, 3) } else { $null }
    espessura_mediana_px = $(if ($ordenadas.Count) { [Math]::Round((Get-Percentil $ordenadas 0.50), 3) } else { $null })
    espessura_p10_px     = $(if ($ordenadas.Count) { [Math]::Round((Get-Percentil $ordenadas 0.10), 3) } else { $null })
    comprimento_medio_px = $(if ($alturas.Count) { [Math]::Round((Get-Media $alturas), 3) } else { $null })
    score_medio          = $(if ($scores.Count)  { [Math]::Round((Get-Media $scores), 4) } else { $null })
    px_por_mm            = $ppmm
    magnificacao         = $magnif
    zoom                 = $zoom
    consultation_guid    = $consulta
    dispositivo          = $dispositivo
    serial_dispositivo   = $serial
  }

  # Derivados so quando ha calibracao. Melhor campo nulo do que numero errado em
  # prontuario. O ppmm vem em todo _input.json (187,12 no VISIOMED 16 mag 15),
  # entao na pratica preenche sempre.
  if ($ppmm -and $ppmm -gt 0) {
    $emUm = { param($px) [Math]::Round(($px / $ppmm) * 1000.0, 2) }

    if ($mediaW) { $medida.espessura_media_um = & $emUm $mediaW }

    if ($larguras.Count -gt 0) {
      # Uma passada so: percentual de finos e histograma saem do mesmo laco.
      # Fio abaixo de 40 um e miniaturizado; acima de 60 um e terminal saudavel.
      $h0=0; $h1=0; $h2=0; $h3=0; $h4=0; $h5=0; $finos=0
      foreach ($w in $larguras) {
        $um = ($w / $ppmm) * 1000.0
        if ($um -lt 40) { $finos++ }
        if     ($um -lt 20)  { $h0++ }
        elseif ($um -lt 40)  { $h1++ }
        elseif ($um -lt 60)  { $h2++ }
        elseif ($um -lt 80)  { $h3++ }
        elseif ($um -lt 100) { $h4++ }
        else                 { $h5++ }
      }
      $medida.pct_fios_finos = [Math]::Round(100.0 * $finos / $larguras.Count, 2)
      $medida.espessura_hist = [ordered]@{
        ate20 = $h0; '20a40' = $h1; '40a60' = $h2
        '60a80' = $h3; '80a100' = $h4; acima100 = $h5
      }
    }

    if ($areaPx -and $areaPx -gt 0) {
      $areaMm2 = $areaPx / ($ppmm * $ppmm)
      $areaCm2 = $areaMm2 / 100.0
      $medida.roi_area_mm2 = [Math]::Round($areaMm2, 4)
      if ($areaCm2 -gt 0) {
        $medida.densidade_uf_cm2   = [Math]::Round($ufs / $areaCm2, 2)
        $medida.densidade_fios_cm2 = [Math]::Round($val.Count / $areaCm2, 2)
      }
    }
  }

  return $medida
}

# ---------------------------------------------------------------------------
# Execucao
# ---------------------------------------------------------------------------

if ($Token -eq 'COLE_O_TOKEN_AQUI' -or [string]::IsNullOrWhiteSpace($Token)) {
  Log 'Token nao configurado. Edite o parametro -Token no topo do script.' 'Red'
  exit 1
}
if (-not (Test-Path $Raiz)) { Log "Pasta nao encontrada: $Raiz" 'Red'; exit 1 }

$inicio = (Get-Date).ToString('o')
Log "=== sync-hairmetrix iniciado em $env:COMPUTERNAME ===" 'Cyan'

# credencial e rede antes de varrer 3 mil pastas
$ping = Send-Lote @{ action = 'ping' } 'ping'
if (-not $ping -or -not $ping.ok) { Log 'Ping falhou. Verifique token e internet.' 'Red'; exit 1 }
Log "Conectado. Tenant $($ping.tenant), agente $($ping.agente), $($ping.exames_no_banco) exames ja no banco." 'Green'

# estado: quais capturas ja foram enviadas
$jaEnviadas = New-Object 'System.Collections.Generic.HashSet[string]'
if ((Test-Path $arquivoEstado) -and -not $Recomecar) {
  foreach ($l in [System.IO.File]::ReadAllLines($arquivoEstado)) {
    if ($l) { [void]$jaEnviadas.Add($l.Trim()) }
  }
  Log "$($jaEnviadas.Count) capturas ja enviadas em rodadas anteriores." 'Gray'
} elseif ($Recomecar) {
  Log 'Modo -Recomecar: estado ignorado, reprocessando tudo (upsert nao duplica).' 'Yellow'
}

$pastas = @(Get-ChildItem $Raiz -Directory -ErrorAction SilentlyContinue)
if ($Teste)              { $pastas = $pastas | Select-Object -First 3 }
elseif ($MaxPacientes -gt 0) { $pastas = $pastas | Select-Object -First $MaxPacientes }
Log "$($pastas.Count) pastas de paciente a varrer." 'Cyan'

$lote = @()
$novasCapturas = New-Object System.Collections.ArrayList
$tot = @{ pacientes = 0; exames = 0; medidas = 0; erros = 0; pulados = 0 }
$n = 0

function Flush-Lote {
  if ($script:lote.Count -eq 0) { return }
  $r = Send-Lote @{ pacientes = $script:lote } "lote de $($script:lote.Count) pacientes"
  if ($r -and $r.ok) {
    $script:tot.exames  += [int]$r.exames
    $script:tot.medidas += [int]$r.medidas
    Log "  enviado: $($r.pacientes) pacientes, $($r.exames) exames, $($r.medidas) medidas" 'Green'
    if (-not $Teste -and $script:novasCapturas.Count -gt 0) {
      Add-Content -Path $arquivoEstado -Value $script:novasCapturas -Encoding UTF8
    }
  } else {
    $script:tot.erros += $script:lote.Count
    $detalhe = if ($r) { ($r | ConvertTo-Json -Compress) } else { 'sem resposta' }
    Log "  lote REJEITADO: $detalhe" 'Red'
  }
  $script:lote = @()
  $script:novasCapturas.Clear()
}

foreach ($pasta in $pastas) {
  $n++
  if ($n % 100 -eq 0) { Log "... $n/$($pastas.Count) pastas" 'DarkGray' }

  # "SOBRENOME, NOME  (20260220132717638)"
  if ($pasta.Name -notmatch '^(.*?)\s*\((\d{10,})\)\s*$') { continue }
  $nomePasta = $matches[1].Trim()
  $mirrorId  = $matches[2]

  $exames = @()
  foreach ($cap in (Get-ChildItem $pasta.FullName -Directory -ErrorAction SilentlyContinue)) {
    if ($cap.Name -notmatch '^\d{10,}$') { continue }
    if ($jaEnviadas.Contains($cap.Name)) { $tot.pulados++; continue }

    $capturadoEm = ConvertFrom-MirrorId $cap.Name
    if (-not $capturadoEm) { continue }

    $medidas = @()
    $arquivos = @(Get-ChildItem $cap.FullName -Filter 'tricho_*.json' -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -notlike '*_input.json' })
    foreach ($f in $arquivos) {
      if ($f.BaseName -notmatch '^tricho_(\d+)$') { continue }
      try {
        $m = Read-Medida $cap.FullName ([int]$matches[1])
        if ($m) { $medidas += $m }
      } catch {
        $tot.erros++
        Log "  erro em $($cap.Name)/$($f.Name): $($_.Exception.Message)" 'Red'
      }
    }
    if ($medidas.Count -eq 0) { continue }

    $primeira = $medidas[0]
    $exames += [ordered]@{
      capture_id         = $cap.Name
      capturado_em       = $capturadoEm
      consultation_guid  = $primeira.consultation_guid
      dispositivo        = $primeira.dispositivo
      serial_dispositivo = $primeira.serial_dispositivo
      medidas            = $medidas
    }
    [void]$novasCapturas.Add($cap.Name)
  }

  if ($exames.Count -eq 0) { continue }

  $lote += [ordered]@{
    mirror_patient_id = $mirrorId
    nome_pasta        = $nomePasta
    cadastrado_em     = (ConvertFrom-MirrorId $mirrorId)
    exames            = $exames
  }
  $tot.pacientes++

  if ($lote.Count -ge $LotePacientes) { Flush-Lote }
}

Flush-Lote

# Fecha a rodada com o resumo. Cron verde nao prova nada: e este log que permite
# alertar "sem exame novo ha 48h" em vez de descobrir por reclamacao da recepcao.
Send-Lote @{
  action = 'log'
  origem = "agente-windows/$env:COMPUTERNAME"
  resumo = @{
    iniciado_em     = $inicio
    pastas_varridas = $pastas.Count
    exames_novos    = $tot.exames
    medidas_novas   = $tot.medidas
    erros           = $tot.erros
  }
} 'log' | Out-Null

Log ''
Log "=== FIM ===" 'Cyan'
Log "Pacientes com exame novo : $($tot.pacientes)"
Log "Exames enviados          : $($tot.exames)"
Log "Medidas enviadas         : $($tot.medidas)"
Log "Capturas ja enviadas     : $($tot.pulados) (puladas)"
Log "Erros                    : $($tot.erros)" $(if ($tot.erros -gt 0) { 'Red' } else { 'Gray' })
if ($Teste) { Log 'MODO TESTE: estado nao foi gravado, pode rodar de novo.' 'Yellow' }
Log "Log: $arquivoLog" 'Gray'
