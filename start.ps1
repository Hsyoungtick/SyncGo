$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath

$serverPath = Join-Path $projectPath "server"

if (-not (Test-Path "node_modules")) {
    Write-Host "正在安装前端依赖..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path (Join-Path $serverPath "node_modules"))) {
    Write-Host "正在安装服务器依赖..." -ForegroundColor Yellow
    Push-Location $serverPath
    npm install
    Pop-Location
}

Write-Host "启动服务器..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$serverPath'; npm run dev"

Write-Host "启动前端..." -ForegroundColor Green
Start-Sleep -Seconds 2
npm run dev
