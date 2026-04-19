# SyncGo Tunnel Mode Startup Script
# Use cpolar tunnel for online battles

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath

$serverPath = Join-Path $projectPath "server"

# Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path (Join-Path $serverPath "node_modules"))) {
    Write-Host "Installing server dependencies..." -ForegroundColor Yellow
    Push-Location $serverPath
    npm install
    Pop-Location
}

# Read .env file for tunnel config
$envFile = Join-Path $projectPath ".env"
if (Test-Path $envFile) {
    Write-Host "Loading tunnel config..." -ForegroundColor Green
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Display tunnel info
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SyncGo Tunnel Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend: $env:VITE_SOCKET_SERVER" -ForegroundColor Yellow
Write-Host "Frontend: $env:VITE_FRONTEND_URL" -ForegroundColor Yellow
Write-Host ""
Write-Host "Share Frontend URL with your opponent" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start backend server
Write-Host "Starting backend server..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$serverPath'; npm run dev"

# Wait for backend
Start-Sleep -Seconds 2

# Start frontend
Write-Host "Starting frontend..." -ForegroundColor Green
npm run dev
