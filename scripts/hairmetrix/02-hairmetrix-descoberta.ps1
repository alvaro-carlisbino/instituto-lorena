#Requires -RunAsAdministrator
<#
    02-hairmetrix-descoberta.ps1
    Instituto Lorena - mapeia onde e como o HairMetrix guarda os dados.

    SOMENTE LEITURA. Nao escreve nada no banco do fornecedor, nao altera arquivo nenhum.

    RODAR NA MAQUINA PRINCIPAL (a que tem o banco), como Administrador.

    Gera: Area de Trabalho\lorena-hairmetrix-<NOMEDAMAQUINA>.txt
    Me manda esse arquivo.
#>

param([switch]$SemVarreduraDeArquivos)

$ErrorActionPreference = 'Continue'
$log = Join-Path ([Environment]::GetFolderPath('Desktop')) "lorena-hairmetrix-$env:COMPUTERNAME.txt"
Start-Transcript -Path $log -Force | Out-Null

function Titulo($t) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
}
function Ok($m)    { Write-Host "  [OK]    $m" -ForegroundColor Green }
function Aviso($m) { Write-Host "  [ATENCAO] $m" -ForegroundColor Yellow }

Write-Host "Maquina: $env:COMPUTERNAME   |   $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')"
Write-Host "MODO SOMENTE LEITURA."


# ---------------------------------------------------------------------------
Titulo "1. QUAL PRODUTO ESTA INSTALADO (nome e versao exatos)"
# ---------------------------------------------------------------------------

$chaves = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$produtos = Get-ItemProperty $chaves -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'hair|canfield|metrix|mirror|trico|derma' } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation

if ($produtos) {
    $produtos | Format-List
    Ok "Anote a versao. Update do fornecedor pode mudar o schema e quebrar a integracao."
} else {
    Aviso "Nada casou com hair/canfield/metrix. Lista completa dos instalados:"
    Get-ItemProperty $chaves -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object DisplayName, DisplayVersion, Publisher |
        Sort-Object DisplayName | Format-Table -AutoSize
}

Write-Host ""
Write-Host "Processos rodando agora que parecem do sistema:"
Get-Process | Where-Object { $_.ProcessName -match 'hair|canfield|metrix|mirror' } |
    Select-Object ProcessName, Id, Path | Format-Table -AutoSize


# ---------------------------------------------------------------------------
Titulo "2. INSTANCIAS SQL SERVER"
# ---------------------------------------------------------------------------

$instancias = @()
$reg = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
if (Test-Path $reg) {
    (Get-ItemProperty $reg).PSObject.Properties |
        Where-Object { $_.Name -notmatch '^PS' } |
        ForEach-Object { $instancias += $_.Name }
}

if ($instancias) {
    Ok "Instancias encontradas: $($instancias -join ', ')"
} else {
    Aviso "Nenhuma instancia SQL Server no registro. O banco pode ser Firebird/Access/SQLite. Ver secao 4."
}

function Invoke-Sql {
    param([string]$Servidor, [string]$Banco = 'master', [string]$Query)
    $cs = "Server=$Servidor;Database=$Banco;Integrated Security=True;Connect Timeout=10;TrustServerCertificate=True"
    $conn = New-Object System.Data.SqlClient.SqlConnection $cs
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $Query
        $cmd.CommandTimeout = 120
        $ad = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
        $ds = New-Object System.Data.DataSet
        $ad.Fill($ds) | Out-Null
        if ($ds.Tables.Count -gt 0) { return $ds.Tables[0] }
    } catch {
        Write-Host "  [erro SQL] $($_.Exception.Message)" -ForegroundColor Red
    } finally { if ($conn.State -ne 'Closed') { $conn.Close() } }
}

foreach ($inst in $instancias) {
    $servidor = if ($inst -eq 'MSSQLSERVER') { 'localhost' } else { "localhost\$inst" }

    Titulo "3. INSTANCIA: $servidor"

    $versao = Invoke-Sql -Servidor $servidor -Query "SELECT @@VERSION AS v, SERVERPROPERTY('Edition') AS edicao"
    if (-not $versao) { Aviso "Nao consegui conectar em $servidor com autenticacao Windows. Pule."; continue }
    Write-Host "  $($versao.v)"
    Write-Host "  Edicao: $($versao.edicao)"

    Write-Host ""
    Write-Host "  Porta TCP em uso:"
    Invoke-Sql -Servidor $servidor -Query @"
SELECT DISTINCT local_tcp_port AS porta FROM sys.dm_exec_connections WHERE local_tcp_port IS NOT NULL
"@ | Format-Table -AutoSize
    Aviso "Se a porta vier vazia ou variar, e porta dinamica. Fixe em 1433 no SQL Server Configuration Manager."

    Write-Host ""
    Write-Host "  Bancos de usuario:"
    $bancos = Invoke-Sql -Servidor $servidor -Query @"
SELECT d.name AS banco, d.state_desc AS estado, d.create_date AS criado,
       CAST(SUM(mf.size) * 8.0 / 1024 AS DECIMAL(10,1)) AS tamanho_mb
FROM sys.databases d
JOIN sys.master_files mf ON mf.database_id = d.database_id
WHERE d.database_id > 4
GROUP BY d.name, d.state_desc, d.create_date
ORDER BY SUM(mf.size) DESC
"@
    $bancos | Format-Table -AutoSize

    Write-Host "  Arquivos fisicos:"
    Invoke-Sql -Servidor $servidor -Query @"
SELECT DB_NAME(database_id) AS banco, name AS arquivo, physical_name AS caminho
FROM sys.master_files WHERE database_id > 4 ORDER BY database_id
"@ | Format-Table -AutoSize -Wrap

    foreach ($b in $bancos) {
        $nome = $b.banco
        Titulo "3.$nome  TABELAS E VOLUME"

        $tabelas = Invoke-Sql -Servidor $servidor -Banco $nome -Query @"
SELECT s.name AS esquema, t.name AS tabela, SUM(p.rows) AS linhas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY s.name, t.name
HAVING SUM(p.rows) > 0
ORDER BY SUM(p.rows) DESC
"@
        if (-not $tabelas) { Write-Host "  (sem tabelas com dados)"; continue }
        $tabelas | Format-Table -AutoSize

        Write-Host ""
        Write-Host "  COLUNAS (necessario pra desenhar o mapeamento pro CRM):"
        Invoke-Sql -Servidor $servidor -Banco $nome -Query @"
SELECT c.TABLE_NAME AS tabela, c.COLUMN_NAME AS coluna, c.DATA_TYPE AS tipo,
       c.CHARACTER_MAXIMUM_LENGTH AS tamanho, c.IS_NULLABLE AS aceita_nulo
FROM INFORMATION_SCHEMA.COLUMNS c
JOIN sys.tables t ON t.name = c.TABLE_NAME
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
"@ | Format-Table -AutoSize

        Write-Host ""
        Write-Host "  CHAVES ESTRANGEIRAS (mostra como paciente liga com exame):"
        Invoke-Sql -Servidor $servidor -Banco $nome -Query @"
SELECT fk.name AS constraint_fk,
       OBJECT_NAME(fk.parent_object_id) AS tabela_filha,
       cf.name AS coluna_filha,
       OBJECT_NAME(fk.referenced_object_id) AS tabela_pai,
       cp.name AS coluna_pai
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns cf ON cf.object_id = fkc.parent_object_id AND cf.column_id = fkc.parent_column_id
JOIN sys.columns cp ON cp.object_id = fkc.referenced_object_id AND cp.column_id = fkc.referenced_column_id
ORDER BY tabela_pai, tabela_filha
"@ | Format-Table -AutoSize

        Write-Host ""
        Write-Host "  Colunas de DATA (definem o campo de sync incremental):"
        Invoke-Sql -Servidor $servidor -Banco $nome -Query @"
SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, DATA_TYPE AS tipo
FROM INFORMATION_SCHEMA.COLUMNS
WHERE DATA_TYPE IN ('datetime','datetime2','date','smalldatetime','datetimeoffset')
ORDER BY TABLE_NAME, COLUMN_NAME
"@ | Format-Table -AutoSize
    }
}


# ---------------------------------------------------------------------------
Titulo "4. OUTROS BANCOS (Firebird / Access / SQLite) E ARQUIVOS DE CONFIG"
# ---------------------------------------------------------------------------

if ($SemVarreduraDeArquivos) {
    Aviso "Varredura de arquivos pulada (-SemVarreduraDeArquivos)."
} else {

    $raizes = @('C:\Program Files', 'C:\Program Files (x86)', 'C:\ProgramData') +
              (Get-ChildItem 'C:\','D:\','E:\' -Directory -ErrorAction SilentlyContinue |
                   Where-Object { $_.Name -match 'hair|canfield|metrix|mirror|imagem|image|foto|exame' } |
                   ForEach-Object { $_.FullName })
    $raizes = $raizes | Where-Object { Test-Path $_ } | Select-Object -Unique
    Write-Host "Raizes varridas: $($raizes -join ' | ')"

    Write-Host ""
    Write-Host "Arquivos de banco encontrados:"
    Get-ChildItem $raizes -Recurse -File -ErrorAction SilentlyContinue `
        -Include *.fdb,*.gdb,*.mdb,*.accdb,*.sqlite,*.db,*.db3,*.sdf |
        Where-Object { $_.Length -gt 1MB } |
        Select-Object @{n='tamanho_mb';e={[math]::Round($_.Length/1MB,1)}}, LastWriteTime, FullName |
        Sort-Object tamanho_mb -Descending | Select-Object -First 25 | Format-Table -AutoSize -Wrap

    Write-Host ""
    Write-Host "Strings de conexao em arquivos de config:"
    Get-ChildItem $raizes -Recurse -File -ErrorAction SilentlyContinue `
        -Include *.ini,*.config,*.xml,*.json,*.cfg |
        Where-Object { $_.Length -lt 2MB } |
        Select-String -Pattern 'Data Source|Server\s*=|Database\s*=|Initial Catalog|ConnectionString|ImagePath|StoragePath|DataPath' -ErrorAction SilentlyContinue |
        Select-Object -First 40 Path, LineNumber, Line | Format-List
    Aviso "Se aparecer senha em texto puro acima, NAO me mande essa linha. Troque por ***."

    Write-Host ""
    Write-Host "Pastas com mais imagens (onde os exames provavelmente ficam):"
    Get-ChildItem $raizes -Recurse -File -ErrorAction SilentlyContinue `
        -Include *.jpg,*.jpeg,*.png,*.tif,*.tiff,*.bmp |
        Group-Object DirectoryName |
        Sort-Object Count -Descending | Select-Object -First 15 |
        Select-Object Count, @{n='pasta';e={$_.Name}} | Format-Table -AutoSize -Wrap
}


# ---------------------------------------------------------------------------
Titulo "5. COMPARTILHAMENTOS DE REDE JA EXISTENTES"
# ---------------------------------------------------------------------------

Get-SmbShare -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^\w\$$|^IPC\$$|^ADMIN\$$' } |
    Select-Object Name, Path, Description | Format-Table -AutoSize -Wrap


# ---------------------------------------------------------------------------
Titulo "FIM"
# ---------------------------------------------------------------------------
Write-Host "Arquivo gerado: $log" -ForegroundColor Cyan
Write-Host ""
Aviso "Antes de me enviar: abra o arquivo e apague qualquer SENHA que tenha aparecido na secao 4."
Aviso "Nome de paciente nao sai neste script. So schema, contagem e caminho."

Stop-Transcript | Out-Null
