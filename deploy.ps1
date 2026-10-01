param (
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage,

    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[A-Z][A-Z0-9]*-\d+$')]
    [string]$JiraIssueKey
)

Write-Host "1/3 Pushing to Google Apps Script..." -ForegroundColor Cyan
clasp push

Write-Host "2/3 Staging and committing Git changes..." -ForegroundColor Cyan
git add .
$fullCommitMessage = "$JiraIssueKey $CommitMessage"
git commit -m $fullCommitMessage

Write-Host "3/3 Pushing to GitHub (triggers Jira update)..." -ForegroundColor Cyan
git push origin main

Write-Host "Done! Apps Script, GitHub, and Jira have all been updated." -ForegroundColor Green


#powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -JiraIssueKey "KAN-123" -CommitMessage "Implemented auth sync script"