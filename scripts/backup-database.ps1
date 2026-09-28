[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectDirectory,
    [Parameter(Mandatory)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
if (-not (Test-Path -LiteralPath (Join-Path $project 'docker-compose.yml'))) { throw 'Kein Compose-Projekt gefunden.' }
$destination = [IO.Path]::GetFullPath($BackupDirectory)
if ($destination.StartsWith($project.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $destination -eq $project) {
    throw 'Sicherungen ausserhalb des Projektordners speichern.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$name = 'schichtplaner-' + (Get-Date -Format 'yyyy-MM-dd_HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.dump'
$containerFile = '/tmp/' + $name
$localFile = Join-Path $destination $name
$compose = @('compose', '--project-directory', $project, '-f', (Join-Path $project 'docker-compose.yml'))
try {
    & docker @compose exec -T postgres pg_dump -U schichtplaner -d schichtplaner -Fc -f $containerFile
    if ($LASTEXITCODE -ne 0) { throw 'Datenbanksicherung fehlgeschlagen.' }
    & docker @compose exec -T postgres pg_restore --list $containerFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Dump ist nicht lesbar.' }
    & docker @compose cp "postgres:$containerFile" $localFile
    if ($LASTEXITCODE -ne 0) { throw 'Kopieren der Sicherung fehlgeschlagen.' }
    $hash = (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash
    Set-Content -LiteralPath ($localFile + '.sha256') -Value ($hash + '  ' + $name) -Encoding ascii
    Write-Output "Sicherung erstellt und strukturell lesbar: $localFile"
    Write-Output 'Ein Wiederherstellungstest auf separater Datenbank steht noch aus.'
} finally {
    # Ausschliesslich die selbst erzeugte temporaere Datei entfernen.
    & docker @compose exec -T postgres rm -f -- $containerFile
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Temporaere Dump-Datei im Container konnte nicht entfernt werden.' }
}
