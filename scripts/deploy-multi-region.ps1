# PowerShell Script to deploy Saudidex Scraper to multiple GCP regions
$PROJECT_ID = "saudidix"
$IMAGE_NAME = "gcr.io/$PROJECT_ID/saudidex-scraper"
$REGIONS = @("me-central1", "us-central1", "europe-west1", "asia-east1")

Write-Host "Updating and Pushing Container Image..." -ForegroundColor Cyan
docker build -t $IMAGE_NAME .
docker push $IMAGE_NAME

foreach ($REGION in $REGIONS) {
    Write-Host "Deploying to region: $REGION..." -ForegroundColor Green
    
    # Check if job already exists
    $exists = gcloud run jobs describe saudidex-scraper --region=$REGION --format="value(name)" 2>$null
    
    if ($exists) {
        Write-Host "Updating existing job in $REGION..."
        gcloud run jobs update saudidex-scraper `
            --image=$IMAGE_NAME `
            --region=$REGION `
            --memory=4Gi `
            --cpu=2 `
            --task-timeout=3600 `
            --set-env-vars="REGION=$REGION"
    } else {
        Write-Host "Creating new job in $REGION..."
        gcloud run jobs create saudidex-scraper `
            --image=$IMAGE_NAME `
            --region=$REGION `
            --memory=4Gi `
            --cpu=2 `
            --task-timeout=3600 `
            --set-env-vars="REGION=$REGION"
    }
}

Write-Host "Multi-Region Deployment Complete!" -ForegroundColor Cyan
