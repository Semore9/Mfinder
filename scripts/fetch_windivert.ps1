param(
    [string]$Version = "2.2.2",
    [string]$Arch = "WIN64"
)

$ErrorActionPreference = "Stop"

$baseUrl = "https://github.com/basil00/Divert/releases/download/v$Version"
$zipName = "windivert-$Version-$Arch.zip"
$tmpZip = Join-Path $env:TEMP $zipName
$resourceDir = Join-Path (Split-Path $PSScriptRoot -Parent) "resources\\windivert"

Write-Host "Downloading $zipName ..."
Invoke-WebRequest "$baseUrl/$zipName" -OutFile $tmpZip

Write-Host "Extracting ..."
Expand-Archive $tmpZip -DestinationPath $env:TEMP -Force

$extracted = Join-Path $env:TEMP "windivert-$Version-$Arch"

New-Item -Path $resourceDir -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $extracted "WinDivert.dll") $resourceDir -Force
Copy-Item (Join-Path $extracted "WinDivert64.sys") $resourceDir -Force

Remove-Item $tmpZip -Force
Remove-Item $extracted -Recurse -Force

Write-Host "WinDivert files copied to $resourceDir"
