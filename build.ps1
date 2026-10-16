$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
  & node scripts/build-delivery.mjs @args
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
} finally {
  Pop-Location
}
