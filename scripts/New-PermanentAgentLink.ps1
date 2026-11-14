# Run locally in Windows PowerShell. No API key or signing secret is needed.
# Open in Notepad, copy all lines, then paste into PowerShell.
# This creates a fresh private link. Do not rerun unless you intend to replace it.
& {
    $portalConnectionId = '3739255'
    $portalOrigin = 'https://hsi-agent-portal.onrender.com'
    $portalBytes = New-Object byte[] 32
    $portalRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $portalRng.GetBytes($portalBytes)
    $portalRng.Dispose()
    $portalGrant = 'p1.' + [Convert]::ToBase64String($portalBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    $portalHasher = [Security.Cryptography.SHA256]::Create()
    $portalHashBytes = $portalHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($portalGrant))
    $portalHasher.Dispose()
    $portalHash = ($portalHashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $portalConfig = @{}
    $portalConfig[$portalConnectionId] = $portalHash
    $global:HSIPortalAccessConfig = $portalConfig | ConvertTo-Json -Compress
    $global:HSIPortalPermanentLink = "$portalOrigin/agent/$portalConnectionId#grant=$portalGrant"
    Set-Clipboard $global:HSIPortalAccessConfig
    Write-Host 'Access configuration copied. Paste it into the Render variable PORTAL_AGENT_ACCESS_HASHES.'
    Write-Host 'Keep this PowerShell window open. After saving and deploying, run:'
    Write-Host 'Set-Clipboard $HSIPortalPermanentLink'
    Write-Host 'Then paste into your browser and bookmark the full link.'
}
