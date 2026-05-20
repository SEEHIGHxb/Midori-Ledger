# Midori Android Wrapper Web Assets Sync script
# run this inside PowerShell to bundle the latest web files into the Android app asset folder

$sourceDir = Get-Location
$assetsDir = Join-Path $sourceDir "android-app\app\src\main\assets"

Write-Host "Syncing Midori web app assets to Android asset directory..." -ForegroundColor Green
Write-Host "Target: $assetsDir" -ForegroundColor Cyan

# Ensure target directory exists
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
}

# Clean old assets if any
Remove-Item -Path (Join-Path $assetsDir "*") -Recurse -Force -ErrorAction SilentlyContinue

# Copy core assets
Copy-Item -Path (Join-Path $sourceDir "index.html") -Destination (Join-Path $assetsDir "index.html") -Force
Copy-Item -Path (Join-Path $sourceDir "manifest.json") -Destination (Join-Path $assetsDir "manifest.json") -Force
Copy-Item -Path (Join-Path $sourceDir "sw.js") -Destination (Join-Path $assetsDir "sw.js") -Force

# Copy directories recursively
Copy-Item -Path (Join-Path $sourceDir "js") -Destination $assetsDir -Recurse -Force
Copy-Item -Path (Join-Path $sourceDir "css") -Destination $assetsDir -Recurse -Force
Copy-Item -Path (Join-Path $sourceDir "image") -Destination $assetsDir -Recurse -Force

Write-Host "Asset synchronisation finished successfully! Midori is ready to compile into a native Android app." -ForegroundColor Green
