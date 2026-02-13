# Deploy en Google Cloud Run (ES)

Esta guia publica Derup como **un solo servicio** (frontend + API proxy Gemini/Grok) en Cloud Run.

## 1) Prerrequisitos
- Proyecto de Google Cloud activo.
- Facturacion habilitada.
- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install).
- Permisos para Cloud Run, Cloud Build y Secret Manager.

## 2) Variables base
```bash
PROJECT_ID="tu-proyecto"
REGION="us-central1"
SERVICE="derup"
```

## 3) Login y seleccion de proyecto
```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"
```

## 4) Habilitar APIs necesarias
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

## 5) Crear cuenta de servicio de runtime
```bash
gcloud iam service-accounts create derup-run-sa \
  --display-name="Derup Cloud Run Runtime"
```

Otorgar acceso a secretos:
```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:derup-run-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6) Crear secretos
Gemini:
```bash
echo -n "TU_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
```

Grok/xAI:
```bash
echo -n "TU_XAI_API_KEY" | gcloud secrets create xai-api-key --data-file=-
```

Si ya existen, agrega nueva version:
```bash
echo -n "NUEVA_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
echo -n "NUEVA_KEY" | gcloud secrets versions add xai-api-key --data-file=-
```

## 7) Deploy
Desde la raiz del repo:
```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "derup-run-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --update-secrets "GEMINI_API_KEY=gemini-api-key:latest,XAI_API_KEY=xai-api-key:latest"
```

Cloud Run devolvera una URL tipo:
`https://derup-xxxxx-uc.a.run.app`

## 8) Verificacion
- Abrir URL del servicio.
- En panel IA deberias ver Gemini/Grok conectables segun key.
- Ollama en Cloud Run normalmente aparecera desconectado (es local).

## 9) Actualizaciones
Cada cambio:
```bash
gcloud run deploy "$SERVICE" --source . --region "$REGION"
```

## Notas
- En produccion no se usa proxy de Vite: el servidor Node sirve `dist/` y `/api/*` en el mismo servicio.
- Si quieres dominio propio: usa Cloud Run domain mapping o Cloud Load Balancer.
