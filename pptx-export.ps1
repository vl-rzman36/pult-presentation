$ErrorActionPreference = 'Stop'
$office = $null
$deck = $null
$oldSecurity = $null
try {
    $office = New-Object -ComObject PowerPoint.Application
    try { $oldSecurity = $office.AutomationSecurity; $office.AutomationSecurity = 3 } catch { }
    $deck = $office.Presentations.Open($env:PULT_PPTX_INPUT, -1, 0, 0)
    # SaveAs PDF is also supported by WPS's PowerPoint-compatible automation.
    $deck.SaveAs($env:PULT_PPTX_OUTPUT, 32)
    if (!(Test-Path -LiteralPath $env:PULT_PPTX_OUTPUT)) { throw 'PDF was not created' }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($deck) { try { $deck.Close() } catch { }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
    if ($office) {
        if ($null -ne $oldSecurity) { try { $office.AutomationSecurity = $oldSecurity } catch { } }
        # Never quit an Office instance: it may contain the user's other documents.
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($office)
    }
}
