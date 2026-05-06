# Braintech Solution SRL — Deploy Guide
## Azure Static Web Apps + Azure Functions + Mailjet + New Relic

---

## Estructura del proyecto

```
/
├── contacto.html                 # Página de contacto (sitio estático)
├── staticwebapp.config.json      # Routing y headers de Azure SWA
├── .env.example                  # Variables de entorno (copiar a .env local)
└── api/                          # Azure Functions (backend)
    ├── host.json
    ├── package.json
    └── contact/
        ├── index.js              # Lógica: Mailjet + New Relic
        └── function.json         # Binding HTTP trigger
```

---

## 1. Pre-requisitos

- Cuenta Azure (portal.azure.com)
- Cuenta Mailjet (mailjet.com) — plan gratuito incluye 6,000 emails/mes
- Cuenta New Relic (newrelic.com) — plan gratuito disponible
- Git + GitHub/Azure DevOps (para CI/CD automático)
- Node.js 18+ instalado localmente

---

## 2. Configurar Mailjet

1. Crear cuenta en https://app.mailjet.com
2. Ir a **Account → API Keys** y copiar `API Key` y `Secret Key`
3. Ir a **Senders & Domains** y verificar el dominio `braintechsolution.com`
4. Agregar un sender verificado (p.ej. `info@braintechsolution.com`)

---

## 3. Configurar New Relic

1. Crear cuenta en https://newrelic.com
2. Ir a **Account Settings → API Keys**
3. Crear una key de tipo **"Ingest - License"**
4. Copiar el **Account ID** (número en la URL de tu cuenta)
5. Los eventos aparecerán en **Query Your Data → NRQL** como:
   ```sql
   SELECT * FROM ContactFormSubmission SINCE 1 week ago
   ```

---

## 4. Deploy en Azure Static Web Apps

### Opción A — Azure Portal (manual)

1. Ir a portal.azure.com → **Crear recurso → Static Web App**
2. Conectar tu repositorio GitHub
3. Configurar:
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** *(dejar vacío)*
4. Una vez creado, ir a **Configuration → Application settings** y agregar todas las variables del `.env.example`

### Opción B — Azure CLI

```bash
# Instalar Azure CLI si no lo tienes
# https://learn.microsoft.com/cli/azure/install-azure-cli

az login

az staticwebapp create \
  --name braintech-contacto \
  --resource-group braintech-rg \
  --source https://github.com/TU_ORG/TU_REPO \
  --location "eastus2" \
  --branch main \
  --app-location "/" \
  --api-location "api" \
  --output-location ""

# Agregar variables de entorno
az staticwebapp appsettings set \
  --name braintech-contacto \
  --resource-group braintech-rg \
  --setting-names \
    MJ_API_KEY="xxxx" \
    MJ_SECRET_KEY="xxxx" \
    MJ_FROM_EMAIL="info@braintechsolution.com" \
    MJ_FROM_NAME="Braintech Solution SRL" \
    MJ_TO_EMAILS="aner@braintechsolution.com,ventas@braintechsolution.com" \
    NR_ACCOUNT_ID="1234567" \
    NR_INSERT_KEY="xxxx" \
    ENVIRONMENT="production"
```

---

## 5. Probar localmente

```bash
# Instalar Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# En la carpeta /api
cd api
npm install

# Crear archivo de configuración local
cp ../.env.example local.settings.json
# Editar local.settings.json con este formato:
# {
#   "IsEncrypted": false,
#   "Values": {
#     "AzureWebJobsStorage": "",
#     "FUNCTIONS_WORKER_RUNTIME": "node",
#     "MJ_API_KEY": "...",
#     ...
#   }
# }

func start
```

La función estará disponible en: `http://localhost:7071/api/contact`

---

## 6. Endpoint de la Azure Function

```
POST /api/contact
Content-Type: application/json

{
  "name": "María Rodríguez",
  "company": "Mi Empresa SRL",
  "email": "maria@empresa.com",
  "phone": "809-555-0000",
  "service": "Facturación Electrónica (e-CF)",
  "message": "Necesito información sobre sus planes."
}
```

**Respuesta exitosa (200):**
```json
{ "ok": true, "message": "Mensaje recibido. Te contactaremos pronto." }
```

**Error de validación (400):**
```json
{ "ok": false, "errors": ["valid email is required"] }
```

---

## 7. Dashboard New Relic — queries útiles

```sql
-- Total de contactos últimos 30 días
SELECT count(*) FROM ContactFormSubmission SINCE 30 days ago

-- Contactos por servicio de interés
SELECT count(*) FROM ContactFormSubmission
FACET serviceInterest SINCE 30 days ago

-- Tendencia diaria
SELECT count(*) FROM ContactFormSubmission
TIMESERIES 1 day SINCE 30 days ago
```

---

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `MJ_API_KEY` | Mailjet API Key |
| `MJ_SECRET_KEY` | Mailjet Secret Key |
| `MJ_FROM_EMAIL` | Email remitente (verificado en Mailjet) |
| `MJ_FROM_NAME` | Nombre del remitente |
| `MJ_TO_EMAILS` | Destinatarios separados por coma |
| `NR_ACCOUNT_ID` | Account ID de New Relic |
| `NR_INSERT_KEY` | Ingest License Key de New Relic |
| `ENVIRONMENT` | `production` o `staging` |
