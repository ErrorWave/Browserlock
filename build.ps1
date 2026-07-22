# Repacks the extension into browserlock-<version>.xpi (a plain zip with
# manifest.json at the archive root). Run after editing any source file.

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$version = (Get-Content (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json).version
$xpi = Join-Path $dir "browserlock-$version.xpi"
$tmp = Join-Path $dir "browserlock-$version.zip"

$files = @(
  'manifest.json', 'background.js',
  'lock.html', 'lock.js',
  'options.html', 'options.js',
  'style.css'
) | ForEach-Object { Join-Path $dir $_ }

$missing = $files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "Missing source files: $($missing -join ', ')" }

Compress-Archive -Path $files -DestinationPath $tmp -CompressionLevel Optimal -Force
Move-Item $tmp $xpi -Force

Write-Host "Built $xpi ($((Get-Item $xpi).Length) bytes)"
