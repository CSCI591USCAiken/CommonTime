param (
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage
)

Write-Host "1/3 Pushing to Google Apps Script..." -ForegroundColor Cyan
clasp push

Write-Host "2/3 Staging and committing Git changes..." -ForegroundColor Cyan
git add .
git commit -m $CommitMessage

Write-Host "3/3 Pushing to GitHub (triggers Jira update)..." -ForegroundColor Cyan
git push origin main

Write-Host "Done! Apps Script, GitHub, and Jira have all been updated." -ForegroundColor Green


# .\deploy.ps1 "PROJ-123 #time 1h 30m #done Implemented auth sync script"