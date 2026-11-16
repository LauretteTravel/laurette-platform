$ErrorActionPreference = 'Stop'
$comment = (Get-Content 'audit-laurette/offer-feature/csp-comment.txt' -Raw -Encoding UTF8).TrimEnd()
$raw = Get-Content 'server.js' -Raw
if (-not $raw.Contains($comment)) { Write-Output 'COMMENT NOT FOUND'; exit 1 }
if ($raw.Contains('// ' + $comment)) { Write-Output 'ALREADY OK'; exit 0 }
$patched = $raw.Replace($comment, '// ' + $comment)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'server.js.tmp-fix'), $patched, $utf8NoBom)
Copy-Item 'server.js.tmp-fix' 'server.js' -Force
Remove-Item 'server.js.tmp-fix' -Force
Write-Output 'COMMENT FIXED'
