# Pull the 2026 foil-border sample end to end: TAG reports -> images -> R2 -> dataset tables.
# Run from scripts/tag-dataset:  powershell -File samples\2026-foil-border\run-pull.ps1
# Resumable: every stage skips what is already done (fetch skips certs in the store, download
# skips files in the store, build rebuilds the tables). Log: data\foil-pull.log
$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")
$py = ".\.venv\Scripts\python.exe"
$certs = "samples\2026-foil-border\certs.parquet"
$certsTxt = "samples\2026-foil-border\certs.txt"
$log = "data\foil-pull.log"
function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Add-Content -Path $log -Value $line; Write-Host $line }
. .\data\env.ps1   # B2_KEY_ID / B2_APP_KEY for download + verify; never logged

Log "=== foil-border pull start ==="
Log "stage 1: fetch detail+score for the sample (proxied, sliding window)"
& $py -m tagdataset fetch --certs $certs --proxies data\proxies.txt 2>&1 | Tee-Object -FilePath $log -Append
Log "stage 1b: retry fetch failures once"
& $py -m tagdataset fetch --certs $certs --proxies data\proxies.txt --retry-failures 2>&1 | Tee-Object -FilePath $log -Append

Log "stage 2: download images for the sample certs to R2 (proxied)"
& $py -m tagdataset download --certs-file $certsTxt --proxies data\proxies.txt 2>&1 | Tee-Object -FilePath $log -Append

Log "stage 3: verify against the bucket"
& $py -m tagdataset verify --check-bucket 2>&1 | Tee-Object -FilePath $log -Append
if (Test-Path data\missing.parquet) {
  Log "stage 3b: retry missing files once"
  & $py -m tagdataset download --retry-missing data\missing.parquet --proxies data\proxies.txt 2>&1 | Tee-Object -FilePath $log -Append
}

Log "stage 4: build tables (foil2026 split is pre-assigned in splits/splits.parquet)"
& $py -m tagdataset build 2>&1 | Tee-Object -FilePath $log -Append
Log "stage 5: stats"
& $py -m tagdataset stats --save data\dataset\stats_report.txt 2>&1 | Tee-Object -FilePath $log -Append
Log "=== foil-border pull done ==="
