# Deploy to Google Cloud Run (EN)

This guide deploys Derup as a **single service** (frontend + Gemini/Grok API proxy) on Cloud Run.

## 1) Prerequisites
- Active Google Cloud project.
- Billing enabled.
- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install).
- Permissions for Cloud Run, Cloud Build, and Secret Manager.

## 2) Base variables
```bash
PROJECT_ID="your-project"
REGION="us-central1"
SERVICE="derup"
```

## 3) Login and project setup
```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"
```

## 4) Enable required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

## 5) Create runtime service account
```bash
gcloud iam service-accounts create derup-run-sa \
  --display-name="Derup Cloud Run Runtime"
```

Grant secret access:
```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:derup-run-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6) Create secrets
Gemini:
```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
```

Grok/xAI:
```bash
echo -n "YOUR_XAI_API_KEY" | gcloud secrets create xai-api-key --data-file=-
```

If already created, add a new version:
```bash
echo -n "NEW_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
echo -n "NEW_KEY" | gcloud secrets versions add xai-api-key --data-file=-
```

## 7) Deploy
From repository root:
```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "derup-run-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --update-secrets "GEMINI_API_KEY=gemini-api-key:latest,XAI_API_KEY=xai-api-key:latest"
```

Cloud Run returns a URL like:
`https://derup-xxxxx-uc.a.run.app`

## 8) Verification
- Open service URL.
- In the AI panel, Gemini/Grok should connect if keys are valid.
- Ollama will usually show disconnected on Cloud Run (it's local by design).

## 9) Updates
For each new release:
```bash
gcloud run deploy "$SERVICE" --source . --region "$REGION"
```

## Notes
- In production there is no Vite dev proxy: Node serves `dist/` and `/api/*` from one service.
- For custom domains, use Cloud Run domain mapping or Cloud Load Balancer.
