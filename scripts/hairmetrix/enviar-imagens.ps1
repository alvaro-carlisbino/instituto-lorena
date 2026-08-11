#Requires -Version 5.1
<#
    enviar-imagens.ps1
    Instituto Lorena - envia as fotos da tricoscopia para o CRM.

    RODA NA MAQUINA PRINCIPAL (DESKTOP-D47ENNF). Somente leitura do disco.

    POR QUE MINIATURA E NAO O ORIGINAL
      O tricho_N.png tem 2274x2048 e entre 4 e 8 MB. As 32 mil capturas dariam
      130 a 250 GB e dias de upload na internet da clinica. Este script converte
      para JPEG de no maximo 1400px antes de subir: cai para ~250 KB.

    POR QUE SO A CAPTURA MAIS RECENTE
      A sessao mais nova ja tem uma imagem de cada regiao, que e o que o medico
      mostra ao paciente. O historico numerico completo continua no CRM; o que
      nao sobe e a FOTO dos exames antigos. Use -Tudo para mandar todas (varios
      dias de upload).

    USO
      .\enviar-imagens.ps1 -Teste          # 3 pacientes
      .\enviar-imagens.ps1                 # a captura mais recente de cada paciente
      .\enviar-imagens.ps1 -Tudo           # todas as capturas (pesado)
      .\enviar-imagens.ps1 -PausaMs 800    # segura o upload em horario de atendimento

    Estado em C:\ProgramData\LorenaHairMetrix\imagens-enviadas.txt.
    Pode parar e retomar a vontade: o servidor faz upsert e o estado evita reenvio.
#>

param(
  [string]$Raiz       = 'C:\ProgramData\Canfield\Databases\MirrorDatabase',
  [string]$Endpoint   = 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/hairmetrix-sync',
  [string]$Token      = 'COLE_O_TOKEN_AQUI',
  [int]$LadoMaximo    = 1400,
  [int]$Qualidade     = 80,
  [int]$PausaMs       = 0,
  [int]$MaxPacientes  = 0,
  [switch]$Tudo,
  [switch]$Teste,
  [switch]$Fila
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing

$pastaEstado   = 'C:\ProgramData\LorenaHairMetrix'
$arquivoEstado = Join-Path $pastaEstado 'imagens-enviadas.txt'
$arquivoLog    = Join-Path $pastaEstado ("imagens-{0}.log" -f (Get-Date -Format 'yyyy-MM'))
New-Item -ItemType Directory -Force -Path $pastaEstado | Out-Null

function Log($msg, $cor = 'Gray') {
  $linha = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $linha -ForegroundColor $cor
  Add-Content -Path $arquivoLog -Value $linha -Encoding UTF8
}

# Converte o PNG para JPEG reduzido e devolve base64. Sem isto, cada arquivo sobe
# 20 a 30 vezes maior e o upload nunca termina.
function ConvertTo-JpegBase64([string]$caminho, [int]$lado, [int]$q) {
  $img = $null; $bmp = $null; $g = $null; $ms = $null
  try {
    $img = [System.Drawing.Image]::FromFile($caminho)
    $maior = [Math]::Max($img.Width, $img.Height)
    $escala = if ($maior -gt $lado) { $lado / $maior } else { 1.0 }
    $w = [int][Math]::Round($img.Width * $escala)
    $h = [int][Math]::Round($img.Height * $escala)

    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $w, $h)

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
               Where-Object { $_.MimeType -eq 'image/jpeg' }
    $prm = New-Object System.Drawing.Imaging.EncoderParameters 1
    $prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
      [System.Drawing.Imaging.Encoder]::Quality, [int64]$q)

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $codec, $prm)
    return [Convert]::ToBase64String($ms.ToArray())
  } catch {
    Log "  erro convertendo $([IO.Path]::GetFileName($caminho)): $($_.Exception.Message)" 'Red'
    return $null
  } finally {
    if ($ms)  { $ms.Dispose() }
    if ($g)   { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    if ($img) { $img.Dispose() }   # solta o arquivo, senao o Mirror nao consegue reescrever
  }
}

function Send-Json($payload, [string]$rotulo) {
  $json  = $payload | ConvertTo-Json -Depth 6 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $head  = @{ 'x-hairmetrix-token' = $Token }
  for ($t = 1; $t -le 3; $t++) {
    try {
      return Invoke-RestMethod -Uri $Endpoint -Method Post -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -Headers $head -TimeoutSec 180
    } catch {
      if ($t -eq 3) { Log "  FALHA $rotulo : $($_.Exception.Message)" 'Red'; return $null }
      Start-Sleep -Seconds ($t * 4)
    }
  }
}

# Fecha o pedido da fila. Tem que ser chamado em TODA saida do laco do paciente,
# inclusive quando a pasta nao tem captura nenhuma: pedido que nao fecha volta na
# proxima rodada e o script gasta o dia inteiro no mesmo paciente vazio.
function Close-Pedido($pasta, $quantas, $detalhe) {
  if (-not $Fila) { return }
  if ($pasta.Name -notmatch '\((\d{10,})\)\s*$') { return }
  $mid = $matches[1]
  if (-not $pedidos.ContainsKey($mid)) { return }
  Send-Json @{
    action           = 'fila-ok'
    pedido_id        = $pedidos[$mid]
    imagens_enviadas = $quantas
    detalhe          = $detalhe
  } "fila-ok $mid" | Out-Null
  $pedidos.Remove($mid)
  Log "  pedido fechado: $mid ($quantas imagens)" 'Green'
}

# ---------------------------------------------------------------------------

if ($Token -eq 'COLE_O_TOKEN_AQUI') { Log 'Token nao configurado.' 'Red'; exit 1 }
if (-not (Test-Path $Raiz))         { Log "Pasta nao encontrada: $Raiz" 'Red'; exit 1 }

Log "=== enviar-imagens iniciado ===" 'Cyan'
$ping = Send-Json @{ action = 'ping' } 'ping'
if (-not $ping -or -not $ping.ok) { Log 'Ping falhou. Verifique token e internet.' 'Red'; exit 1 }
Log "Conectado. $($ping.exames_no_banco) exames no banco." 'Green'
Log "Miniatura: lado maximo $LadoMaximo px, qualidade $Qualidade." 'Gray'

$jaEnviadas = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $arquivoEstado) {
  foreach ($l in [System.IO.File]::ReadAllLines($arquivoEstado)) { if ($l) { [void]$jaEnviadas.Add($l.Trim()) } }
  Log "$($jaEnviadas.Count) imagens ja enviadas antes." 'Gray'
}

$pastas = @(Get-ChildItem $Raiz -Directory -ErrorAction SilentlyContinue)

# Fila: o CRM diz quais pacientes interessam agora. O mirror_patient_id e o numero
# entre parenteses no nome da pasta, entao da para casar sem tocar no banco deles.
$pedidos = @{}
if ($Fila) {
  $resp = Send-Json @{ action = 'fila'; limite = 50 } 'fila'
  if (-not $resp -or -not $resp.ok) { Log 'Nao consegui ler a fila de pedidos.' 'Red'; exit 1 }
  if (@($resp.pedidos).Count -eq 0) { Log 'Fila vazia: ninguem pediu foto. Nada a fazer.' 'Green'; exit 0 }

  foreach ($ped in $resp.pedidos) { $pedidos[[string]$ped.mirror_patient_id] = $ped.id }
  Log "$($pedidos.Count) paciente(s) na fila." 'Cyan'

  $pastas = @($pastas | Where-Object {
    if ($_.Name -match '\((\d{10,})\)\s*$') { $pedidos.ContainsKey($matches[1]) } else { $false }
  })
  Log "$($pastas.Count) pasta(s) casaram com a fila." 'Cyan'

  # Pedido cuja pasta sumiu do disco tem que fechar assim mesmo, senao volta na
  # fila para sempre e o script gasta uma rodada nele todo dia.
  $achados = @{}
  foreach ($pa in $pastas) { if ($pa.Name -match '\((\d{10,})\)\s*$') { $achados[$matches[1]] = $true } }
  foreach ($mid in @($pedidos.Keys)) {
    if (-not $achados.ContainsKey($mid)) {
      Log "  pasta nao encontrada para $mid ; fechando o pedido" 'Yellow'
      Send-Json @{ action='fila-ok'; pedido_id=$pedidos[$mid]; imagens_enviadas=0; detalhe='pasta nao encontrada no disco' } 'fila-ok' | Out-Null
      $pedidos.Remove($mid)  # tira da hash aqui: Close-Pedido nunca vera esta pasta
    }
  }
}
elseif ($Teste)              { $pastas = $pastas | Select-Object -First 3 }
elseif ($MaxPacientes -gt 0) { $pastas = $pastas | Select-Object -First $MaxPacientes }
Log "$($pastas.Count) pastas de paciente." 'Cyan'

$tot = @{ enviadas = 0; puladas = 0; erros = 0; bytes = 0 }
$n = 0

foreach ($pasta in $pastas) {
  $n++
  if ($n % 50 -eq 0) {
    Log ("... {0}/{1} pacientes | {2} imagens | {3:N1} MB" -f `
      $n, $pastas.Count, $tot.enviadas, ($tot.bytes / 1MB)) 'DarkGray'
  }

  $enviadasDestePaciente = 0

  $capturas = @(Get-ChildItem $pasta.FullName -Directory -ErrorAction SilentlyContinue |
                  Where-Object { $_.Name -match '^\d{10,}$' } |
                  Sort-Object Name -Descending)
  if ($capturas.Count -eq 0) {
    Close-Pedido $pasta 0 'pasta sem captura'
    continue
  }
  # id da captura e timestamp, entao ordenar pelo nome ja da a mais recente primeiro
  if ($Fila) {
    # antes e depois: a mais antiga e a mais nova. E o par que o laudo compara.
    $capturas = if ($capturas.Count -gt 1) { @($capturas[0], $capturas[-1]) } else { @($capturas[0]) }
  }
  elseif (-not $Tudo) { $capturas = @($capturas[0]) }

  foreach ($cap in $capturas) {
    $pngs = @(Get-ChildItem $cap.FullName -Filter 'tricho_*.png' -File -ErrorAction SilentlyContinue)
    foreach ($png in $pngs) {
      if ($png.BaseName -notmatch '^tricho_(\d+)$') { continue }
      $indice = [int]$matches[1]
      $chave = "$($cap.Name)/$indice"
      if ($jaEnviadas.Contains($chave)) { $tot.puladas++; continue }

      # regiao vem do _input.json, o mesmo campo `location` que o sync usa
      $regiao = $null
      $fin = Join-Path $cap.FullName "tricho_${indice}_input.json"
      if (Test-Path $fin) {
        try { $regiao = (Get-Content $fin -Raw -Encoding UTF8 | ConvertFrom-Json).AnalysisInput.location } catch { }
      }

      $b64 = ConvertTo-JpegBase64 $png.FullName $LadoMaximo $Qualidade
      if (-not $b64) { $tot.erros++; continue }

      $r = Send-Json @{
        action       = 'imagem'
        capture_id   = $cap.Name
        indice       = $indice
        regiao       = $regiao
        jpeg_base64  = $b64
      } "imagem $chave"

      if ($r -and $r.ok) {
        $tot.enviadas++
        $enviadasDestePaciente++
        $tot.bytes += [int]$r.bytes
        Add-Content -Path $arquivoEstado -Value $chave -Encoding UTF8
      } elseif ($r -and $r.error -eq 'exame_desconhecido') {
        # a captura ainda nao foi sincronizada pelo sync-hairmetrix; tenta na proxima
        $tot.puladas++
      } else {
        $tot.erros++
      }

      if ($PausaMs -gt 0) { Start-Sleep -Milliseconds $PausaMs }
    }
  }

  Close-Pedido $pasta $enviadasDestePaciente $null
}

Log ''
Log '=== FIM ===' 'Cyan'
Log ("Imagens enviadas : {0}  ({1:N1} MB)" -f $tot.enviadas, ($tot.bytes / 1MB))
Log "Puladas          : $($tot.puladas)"
Log "Erros            : $($tot.erros)" $(if ($tot.erros -gt 0) { 'Red' } else { 'Gray' })
Log "Log: $arquivoLog" 'Gray'
