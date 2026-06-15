# Release 打包脚本
# 生成 legado-book-source-generator-v0.1.0.zip
# 用法: powershell -ExecutionPolicy Bypass -File package-release.ps1

param(
    [string]$Version = "v0.1.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$releaseDir = "$projectRoot\release"
$stagingDir = "$releaseDir\legado-book-source-generator"
$zipFile = "$releaseDir\legado-book-source-generator-$Version.zip"

# 清理
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
if (Test-Path $zipFile) { Remove-Item $zipFile -Force }
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

# 复制 skill 文件
$skillDir = "$projectRoot\legado-book-source-generator"
Copy-Item "$skillDir\SKILL.md" $stagingDir -ErrorAction SilentlyContinue
Copy-Item "$skillDir\README.txt" $stagingDir -ErrorAction SilentlyContinue
Copy-Item "$skillDir\references" "$stagingDir\references" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$skillDir\examples" "$stagingDir\examples" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$skillDir\scripts" "$stagingDir\scripts" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$skillDir\tests" "$stagingDir\tests" -Recurse -ErrorAction SilentlyContinue

# 创建 validator 目录
$validatorStaging = "$stagingDir\validator"
New-Item -ItemType Directory -Path "$validatorStaging\app" -Force | Out-Null
New-Item -ItemType Directory -Path "$validatorStaging\examples" -Force | Out-Null

# 复制 JAR
$jar = "$root\build\libs\legado-source-validator.jar"
if (Test-Path $jar) {
    Copy-Item $jar "$validatorStaging\app\"
    Write-Host "JAR: $([math]::Round((Get-Item $jar).Length / 1MB, 1)) MB"
} else {
    Write-Host "ERROR: JAR not found. Run 'gradlew jar' first."
    exit 1
}

# 复制 run.bat、stop.bat 和 README.txt
Copy-Item "$root\run.bat" $validatorStaging
Copy-Item "$root\stop.bat" $validatorStaging
Copy-Item "$root\README.txt" $validatorStaging

# 复制验证样例
Copy-Item "$root\examples\sources" "$validatorStaging\examples\sources" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$root\examples\cases" "$validatorStaging\examples\cases" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$root\examples\candidates" "$validatorStaging\examples\candidates" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$root\examples\TEST-PLAN.md" "$validatorStaging\examples\" -ErrorAction SilentlyContinue

# 打包: Compress-Archive 会保留 legado-book-source-generator/ 顶层目录
if (Test-Path $zipFile) { Remove-Item $zipFile -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Compress-Archive -Path $stagingDir -DestinationPath $zipFile -CompressionLevel Optimal

$size = [math]::Round((Get-Item $zipFile).Length / 1MB, 1)
Write-Host ""
Write-Host "Release: $zipFile ($size MB)"
Write-Host ""
Get-ChildItem $stagingDir -Recurse -File | ForEach-Object {
    $rel = "legado-book-source-generator\" + $_.FullName.Substring($stagingDir.Length + 1)
    Write-Host "  $rel"
}

Remove-Item $stagingDir -Recurse -Force
