$ErrorActionPreference = 'Stop'
$comment = (Get-Content 'audit-laurette/offer-feature/csp-comment.txt' -Raw -Encoding UTF8).TrimEnd()
$raw = Get-Content 'server.js' -Raw
$oldLines = @(
  '    for (const [headerName, headerValue] of Object.entries(securityHeaders(nonce, secure, tracking))) {',
  '      res.setHeader(headerName, headerValue);',
  '    }'
)
$newLines = @(
  "    const staticMedia = (req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/media/');",
  '    for (const [headerName, headerValue] of Object.entries(securityHeaders(nonce, secure, tracking))) {',
  "      $comment",
  "      if (staticMedia && headerName === 'content-security-policy') {",
  "        res.setHeader(headerName, String(headerValue).replace('frame-ancestors \'none\'', 'frame-ancestors \'self\''));",
  "      } else if (!(staticMedia && headerName === 'x-frame-options')) {",
  '        res.setHeader(headerName, headerValue);',
  '      }',
  '    }'
)
$old = $oldLines -join "`r`n"
$new = $newLines -join "`r`n"
if (-not $raw.Contains($old)) {
  $old = $oldLines -join "`n"
  $new = $newLines -join "`n"
}
if (-not $raw.Contains($old)) { Write-Output 'OLD NOT FOUND'; exit 1 }
if ($raw.Contains('staticMedia')) { Write-Output 'ALREADY PATCHED'; exit 0 }
$patched = $raw.Replace($old, $new)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'server.js.tmp-patch'), $patched, $utf8NoBom)
Copy-Item 'server.js.tmp-patch' 'server.js' -Force
Remove-Item 'server.js.tmp-patch' -Force
Write-Output 'PATCHED OK'
