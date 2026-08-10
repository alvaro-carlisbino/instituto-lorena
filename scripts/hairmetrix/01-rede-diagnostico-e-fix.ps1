#Requires -RunAsAdministrator
<#
    01-rede-diagnostico-e-fix.ps1
    Instituto Lorena - diagnostico e correcao da comunicacao entre as duas maquinas do HairMetrix.

    RODAR NAS DUAS MAQUINAS (principal .119 e secundaria .32), como Administrador.

    Uso:
        .\01-rede-diagnostico-e-fix.ps1
        (ele pergunta o IP da outra maquina)

    Ou direto:
        .\01-rede-diagnostico-e-fix.ps1 -OutroIP 192.168.50.32 -EhServidorDoBanco

    Gera um log em: Area de Trabalho\lorena-rede-<NOMEDAMAQUINA>.txt
#>

param(
    [string]$OutroIP,
    [switch]$EhServidorDoBanco,
    [switch]$SomenteDiagnostico
)

$ErrorActionPreference = 'Continue'
$log = Join-Path ([Environment]::GetFolderPath('Desktop')) "lorena-rede-$env:COMPUTERNAME.txt"
Start-Transcript -Path $log -Force | Out-Null

function Titulo($t) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
}

function Ok($m)    { Write-Host "  [OK]    $m" -ForegroundColor Green }
function Aviso($m) { Write-Host "  [ATENCAO] $m" -ForegroundColor Yellow }
function Erro($m)  { Write-Host "  [FALHA] $m" -ForegroundColor Red }

if (-not $OutroIP) {
    $OutroIP = Read-Host "IP da OUTRA maquina (ex: 192.168.50.32)"
}

Write-Host ""
Write-Host "Maquina: $env:COMPUTERNAME   |   Data: $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')"
Write-Host "Log sera salvo em: $log"


# ---------------------------------------------------------------------------
Titulo "1. ESTADO DA REDE DESTA MAQUINA"
# ---------------------------------------------------------------------------

Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object InterfaceAlias, IPAddress, PrefixLength, PrefixOrigin |
    Format-Table -AutoSize

Write-Host "Gateway padrao:"
Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Select-Object InterfaceAlias, NextHop, RouteMetric | Format-Table -AutoSize

Write-Host "Perfil de rede (Public bloqueia compartilhamento):"
Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory | Format-Table -AutoSize

$publicas = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($publicas) { Aviso "Existe adaptador em perfil Public. Sera corrigido abaixo." }
else           { Ok "Nenhum adaptador em perfil Public." }


# ---------------------------------------------------------------------------
Titulo "2. FIREWALL: ESTADO ATUAL"
# ---------------------------------------------------------------------------

Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction | Format-Table -AutoSize

Write-Host "Antivirus / firewall de terceiro registrado no Windows:"
try {
    Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop |
        Select-Object displayName, pathToSignedProductExe | Format-Table -AutoSize
} catch { Write-Host "  (nao foi possivel consultar)" }
Aviso "Se aparecer Kaspersky/Avast/McAfee/Bitdefender acima, o firewall DELE tambem precisa liberar. O Windows Firewall nao manda nele."


# ---------------------------------------------------------------------------
Titulo "3. VARREDURA DA REDE (quem esta vivo em 192.168.50.x)"
# ---------------------------------------------------------------------------

$meuIP = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
$prefixo = ($meuIP -split '\.')[0..2] -join '.'
Write-Host "Varrendo $prefixo.1-254 ... (uns 10 segundos)"

$tarefas = 1..254 | ForEach-Object {
    (New-Object System.Net.NetworkInformation.Ping).SendPingAsync("$prefixo.$_", 600)
}
Start-Sleep -Seconds 8

$vivos = $tarefas |
    Where-Object { $_.IsCompleted -and -not $_.IsFaulted -and $_.Result.Status -eq 'Success' } |
    ForEach-Object { $_.Result.Address.ToString() }

Write-Host ""
Write-Host "Responderam ao PING:"
if ($vivos) { $vivos | Sort-Object { [int](($_ -split '\.')[3]) } | ForEach-Object { Write-Host "   $_" } }
else        { Write-Host "   (nenhum)" }

Write-Host ""
Write-Host "Tabela ARP (aparece aqui mesmo com ping bloqueado por firewall):"
$arp = arp -a | Select-String $prefixo
$arp | ForEach-Object { Write-Host "  $_" }

Write-Host ""
if ($arp -match [regex]::Escape($OutroIP)) {
    Ok "$OutroIP TEM entrada ARP. A maquina esta viva e na mesma rede fisica."
    Aviso "Logo, se o ping falha, o problema e FIREWALL, nao roteador."
} else {
    Erro "$OutroIP NAO aparece no ARP."
    Aviso "Causas: maquina desligada/dormindo, IP mudou (rode ipconfig nela), ou isolamento de cliente no roteador/repetidor Wi-Fi."
}


# ---------------------------------------------------------------------------
Titulo "4. SERVICOS DE BANCO NESTA MAQUINA"
# ---------------------------------------------------------------------------

$sql = Get-Service | Where-Object { $_.Name -like '*SQL*' -or $_.DisplayName -like '*SQL*' }
if ($sql) {
    $sql | Select-Object Name, Status, StartType, DisplayName | Format-Table -AutoSize
    Ok "Esta maquina TEM SQL Server. Provavelmente e ela quem hospeda o banco do HairMetrix."
    $browser = Get-Service SQLBrowser -ErrorAction SilentlyContinue
    if ($browser -and $browser.Status -ne 'Running') {
        Aviso "SQL Browser esta $($browser.Status). Com instancia nomeada (SQLEXPRESS) o cliente NAO acha a porta sem ele."
    }
} else {
    Write-Host "  Nenhum servico SQL encontrado. Esta maquina e cliente."
}

Write-Host ""
Write-Host "Portas em escuta que interessam:"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 445,1433,1434,3050,5432 } |
    Select-Object LocalAddress, LocalPort, OwningProcess -Unique | Format-Table -AutoSize


# ---------------------------------------------------------------------------
if ($SomenteDiagnostico) {
    Titulo "MODO SOMENTE DIAGNOSTICO - nada foi alterado"
    Stop-Transcript | Out-Null
    Write-Host ""
    Write-Host "Log: $log" -ForegroundColor Cyan
    return
}

Titulo "5. APLICANDO CORRECOES"
# ---------------------------------------------------------------------------

# 5.1 Perfil de rede Public -> Private
foreach ($p in (Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })) {
    try {
        Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
        Ok "Perfil de '$($p.Name)' mudado de Public para Private."
    } catch { Erro "Nao consegui mudar o perfil de '$($p.Name)': $_" }
}

# 5.2 Regras de firewall (nomes proprios, imunes ao idioma do Windows)
function Set-Regra {
    param([string]$Nome, [hashtable]$Opcoes)
    Get-NetFirewallRule -DisplayName $Nome -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    try {
        New-NetFirewallRule -DisplayName $Nome -Profile Domain,Private -Enabled True @Opcoes -ErrorAction Stop | Out-Null
        Ok "Regra: $Nome"
    } catch { Erro "Regra '$Nome' falhou: $_" }
}

Set-Regra 'LORENA - Ping ICMPv4 entrada' @{
    Direction = 'Inbound'; Protocol = 'ICMPv4'; IcmpType = 8; Action = 'Allow'
}
Set-Regra 'LORENA - SMB 445 entrada' @{
    Direction = 'Inbound'; Protocol = 'TCP'; LocalPort = 445; Action = 'Allow'
}

if ($EhServidorDoBanco -or $sql) {
    Set-Regra 'LORENA - SQL Server 1433 entrada' @{
        Direction = 'Inbound'; Protocol = 'TCP'; LocalPort = 1433; Action = 'Allow'
    }
    Set-Regra 'LORENA - SQL Browser 1434 entrada' @{
        Direction = 'Inbound'; Protocol = 'UDP'; LocalPort = 1434; Action = 'Allow'
    }
    $b = Get-Service SQLBrowser -ErrorAction SilentlyContinue
    if ($b) {
        try {
            Set-Service SQLBrowser -StartupType Automatic -ErrorAction Stop
            if ($b.Status -ne 'Running') { Start-Service SQLBrowser -ErrorAction Stop }
            Ok "SQL Browser: automatico e rodando."
        } catch { Erro "SQL Browser: $_" }
    }
}


# ---------------------------------------------------------------------------
Titulo "6. VALIDACAO CONTRA $OutroIP"
# ---------------------------------------------------------------------------

Write-Host "Ping:"
$ping = Test-Connection -ComputerName $OutroIP -Count 3 -Quiet -ErrorAction SilentlyContinue
if ($ping) { Ok "Ping responde." } else { Erro "Ping NAO responde (rode este script na outra maquina tambem, o bloqueio e la)." }

foreach ($porta in 445, 1433) {
    $r = Test-NetConnection -ComputerName $OutroIP -Port $porta -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($r) { Ok "Porta $porta ABERTA em $OutroIP" } else { Aviso "Porta $porta fechada em $OutroIP" }
}

Write-Host ""
Write-Host "SQL Browser (UDP 1434) - instancias que $OutroIP anuncia:"
try {
    $udp = New-Object System.Net.Sockets.UdpClient
    $udp.Client.ReceiveTimeout = 3000
    $ep = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Parse($OutroIP)), 1434
    $udp.Send([byte[]](0x02), 1, $ep) | Out-Null
    $remoto = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any), 0
    $resp = $udp.Receive([ref]$remoto)
    $txt = [System.Text.Encoding]::ASCII.GetString($resp, 3, $resp.Length - 3)
    Write-Host "  $($txt -replace ';;', "`n  ")" -ForegroundColor Green
    Ok "SQL Browser respondeu. Anote a InstanceName e a tcp acima."
} catch {
    Write-Host "  (sem resposta - normal se esta maquina for a que hospeda o banco)"
} finally { if ($udp) { $udp.Close() } }


# ---------------------------------------------------------------------------
Titulo "FIM"
# ---------------------------------------------------------------------------
Write-Host "O que importa NAO e o ping. E a porta do banco responder."
Write-Host ""
Write-Host "Log salvo em: $log" -ForegroundColor Cyan
Write-Host "Rode este mesmo script na OUTRA maquina antes de concluir qualquer coisa." -ForegroundColor Yellow

Stop-Transcript | Out-Null
