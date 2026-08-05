param(
  [string]$Cwd = (Get-Location).Path,
  [string]$Out = "",
  [string]$Session = "",
  [switch]$Sanitize,
  [int]$MaxCount = 100,
  [string]$Opencode = "opencode"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "export-opencode-session.mjs"
$nodeArgs = @($script, "--cwd", $Cwd, "--max-count", "$MaxCount", "--opencode", $Opencode)

if ($Out) {
  $nodeArgs += @("--out", $Out)
}
if ($Session) {
  $nodeArgs += @("--session", $Session)
}
if ($Sanitize) {
  $nodeArgs += "--sanitize"
}

node @nodeArgs
exit $LASTEXITCODE
