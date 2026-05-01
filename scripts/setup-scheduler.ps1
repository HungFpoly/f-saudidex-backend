# Script to setup Daily Discovery Scheduler
$PROJECT_ID = "saudidix"
$API_URL = "https://saudidex.vercel.app/api/jobs/trigger" 
$ADMIN_SECRET = "Saudidex_Secret_9x2_kL0_pQ9_zM1_vR4" 
$SCHEDULE = "0 2 * * *" # Daily at 2 AM

Write-Host "Creating Cloud Scheduler Job: daily-discovery..." -ForegroundColor Cyan

gcloud scheduler jobs create http daily-discovery `
    --schedule=$SCHEDULE `
    --uri=$API_URL `
    --http-method=POST `
    --message-body='{"jobType": "discovery", "targetUrl": "https://mcci.org.sa/English/Pages/Factories.aspx", "maxPages": 100}' `
    --headers="Content-Type=application/json,x-admin-secret=$ADMIN_SECRET" `
    --location=me-central1 `
    --project=$PROJECT_ID

Write-Host "Scheduler Setup Complete!" -ForegroundColor Green
