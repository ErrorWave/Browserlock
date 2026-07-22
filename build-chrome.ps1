# Builds the Chrome/Edge package into dist\chrome\ and zips it.
#
# The shared manifest.json is Firefox-shaped: it carries a gecko id and a
# background.scripts fallback. Chrome logs warnings for both, so this script
# emits a cleaned manifest rather than shipping the Firefox one as-is.

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$dist = Join-Path $dir 'dist\chrome'

$manifest = Get-Content (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

# Chrome does not understand either of these.
$manifest.PSObject.Properties.Remove('browser_specific_settings')
$manifest.background.PSObject.Properties.Remove('scripts')

$minimumChrome = '88'
$manifest | Add-Member -NotePropertyName 'minimum_chrome_version' -NotePropertyValue $minimumChrome -Force

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$sources = @(
  'background.js',
  'lock.html', 'lock.js',
  'options.html', 'options.js',
  'style.css'
)

foreach ($f in $sources) {
  $src = Join-Path $dir $f
  if (-not (Test-Path $src)) { throw "Missing source file: $f" }
  Copy-Item $src (Join-Path $dist $f)
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $dist 'manifest.json') -Encoding UTF8

$zip = Join-Path $dir "browserlock-chrome-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Host "Unpacked build: $dist"
Write-Host "Zip: $zip ($((Get-Item $zip).Length) bytes)"
