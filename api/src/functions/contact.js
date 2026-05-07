const { app } = require("@azure/functions");
const https = require("https");

// ─────────────────────────────────────────────────────────────────────────────
// Security config
// ─────────────────────────────────────────────────────────────────────────────

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter
// ─────────────────────────────────────────────────────────────────────────────

const rateMap = new Map();
const WINDOW_MS   = 10 * 60 * 1000;
const MAX_REQUESTS = 5;

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) return true;
  entry.count++;
  rateMap.set(ip, entry);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap.entries()) {
    if (now - entry.windowStart > WINDOW_MS * 2) rateMap.delete(ip);
  }
}, WINDOW_MS);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parseRecipients(envVar) {
  return (envVar || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("client-ip") ||
    "unknown"
  );
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// reCAPTCHA v3
// ─────────────────────────────────────────────────────────────────────────────

async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.warn("[reCAPTCHA] RECAPTCHA_SECRET_KEY not set — skipping");
    return true;
  }
  if (!token) return false;

  const body = `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "www.google.com",
        path: "/recaptcha/api/siteverify",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            const MIN_SCORE = parseFloat(process.env.RECAPTCHA_MIN_SCORE || "0.5");
            resolve(result.success && result.score >= MIN_SCORE);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Brevo
// ─────────────────────────────────────────────────────────────────────────────

async function sendBrevo({ name, company, email, phone, service, message }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const FROM_EMAIL    = process.env.BREVO_FROM_EMAIL || "noreply@braintechsolution.com";
  const FROM_NAME     = process.env.BREVO_FROM_NAME  || "Braintech Solution SRL";
  const TO_EMAILS     = parseRecipients(process.env.BREVO_TO_EMAILS);

  if (!BREVO_API_KEY)         throw new Error("BREVO_API_KEY missing");
  if (TO_EMAILS.length === 0) throw new Error("BREVO_TO_EMAILS env var is empty");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
      <div style="background:linear-gradient(135deg,#0F2E6B,#1A56DB);padding:28px 32px;border-radius:10px 10px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Nueva solicitud de contacto</h1>
        <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:14px;">Braintech Solution SRL</p>
      </div>
      <div style="background:#F9FAFB;padding:28px 32px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 10px 10px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;width:140px;">Nombre</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;font-weight:600;">${name}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;">Empresa</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;">${company || "—"}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;">Email</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;"><a href="mailto:${email}" style="color:#1A56DB;">${email}</a></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;">Teléfono</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;">${phone || "—"}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280;">Servicio</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;"><span style="background:#EBF2FF;color:#1A56DB;padding:3px 10px;border-radius:99px;font-size:13px;">${service || "No especificado"}</span></td></tr>
        </table>
        <div style="margin-top:20px;">
          <p style="color:#6B7280;font-size:13px;margin-bottom:8px;">Mensaje</p>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:16px;font-size:14px;line-height:1.6;color:#374151;">${message.replace(/\n/g, "<br>")}</div>
        </div>
        <div style="margin-top:24px;text-align:center;">
          <a href="mailto:${email}" style="display:inline-block;background:linear-gradient(135deg,#1A56DB,#0EA5E9);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Responder a ${name}</a>
        </div>
      </div>
      <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:16px;">Braintech Solution SRL · República Dominicana</p>
    </div>`;

  const result = await httpPost(
    "api.brevo.com",
    "/v3/smtp/email",
    { "api-key": BREVO_API_KEY },
    {
      sender:      { email: FROM_EMAIL, name: FROM_NAME },
      to:          TO_EMAILS.map((e) => ({ email: e })),
      replyTo:     { email, name },
      subject:     `[Contacto] ${name} — ${service || "Consulta general"}`,
      htmlContent: htmlBody,
      textContent: `Nombre: ${name}\nEmpresa: ${company}\nEmail: ${email}\nTeléfono: ${phone}\nServicio: ${service}\n\nMensaje:\n${message}`,
    }
  );

  if (result.status >= 400) throw new Error(`Brevo error ${result.status}: ${result.body}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// New Relic Custom Event
// ─────────────────────────────────────────────────────────────────────────────

async function sendNewRelicEvent({ name, company, email, service }, clientIp) {
  const NR_ACCOUNT_ID = process.env.NR_ACCOUNT_ID;
  const NR_INSERT_KEY = process.env.NR_INSERT_KEY;

  if (!NR_ACCOUNT_ID || !NR_INSERT_KEY) {
    console.warn("[NewRelic] Credentials missing — skipping event");
    return null;
  }

  const result = await httpPost(
    "insights-collector.newrelic.com",
    `/v1/accounts/${NR_ACCOUNT_ID}/events`,
    { "X-Insert-Key": NR_INSERT_KEY },
    {
      eventType:       "ContactFormSubmission",
      appName:         "Braintech-SWA",
      environment:     process.env.ENVIRONMENT || "production",
      leadName:        name,
      leadCompany:     company || "",
      leadEmail:       email,
      serviceInterest: service || "not_specified",
      clientIp,
      timestamp:       Math.floor(Date.now() / 1000),
    }
  );

  if (result.status >= 400) {
    console.error(`[NewRelic] Event error ${result.status}: ${result.body}`);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

function validate({ name, email, message }) {
  const errors = [];
  if (!name || name.trim().length < 2)
    errors.push("name is required (min 2 chars)");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("valid email is required");
  if (!message || message.trim().length < 5)
    errors.push("message is required (min 5 chars)");
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure Function v4 — entry point
// ─────────────────────────────────────────────────────────────────────────────

app.http("contact", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "contact",
  handler: async (request, context) => {
    const clientIp       = getClientIp(request);
    const origin         = request.headers.get("origin") || "";
    const allowedOrigins = getAllowedOrigins();

    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin":
        allowedOrigins.length === 0 || allowedOrigins.includes(origin)
          ? origin || "*"
          : "null",
      "Vary": "Origin",
    };

    // ── Pre-flight ──────────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Origin check ────────────────────────────────────────────────────────
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      context.warn(`[Security] Blocked origin: "${origin}" | IP: ${clientIp}`);
      return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
    }

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (isRateLimited(clientIp)) {
      context.warn(`[Security] Rate limit exceeded for IP: ${clientIp}`);
      return jsonResponse(429,
        { error: "Demasiados intentos. Por favor espera 10 minutos e intenta de nuevo." },
        { ...corsHeaders, "Retry-After": "600" }
      );
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" }, corsHeaders);
    }

    const { name, company, email, phone, service, message, recaptchaToken } = body;

    // ── reCAPTCHA ────────────────────────────────────────────────────────────
    const recaptchaOk = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaOk) {
      context.warn(`[Security] reCAPTCHA failed for IP: ${clientIp}`);
      return jsonResponse(400,
        { error: "Verificación de seguridad fallida. Por favor recarga la página e intenta de nuevo." },
        corsHeaders
      );
    }

    // ── Input validation ─────────────────────────────────────────────────────
    const errors = validate({ name, email, message });
    if (errors.length > 0) {
      return jsonResponse(400, { ok: false, errors }, corsHeaders);
    }

    const payload = {
      name:    name.trim(),
      company: (company || "").trim(),
      email:   email.trim().toLowerCase(),
      phone:   (phone || "").trim(),
      service: (service || "").trim(),
      message: message.trim(),
    };

    // ── Send in parallel ─────────────────────────────────────────────────────
    const [mailResult, nrResult] = await Promise.allSettled([
      sendBrevo(payload),
      sendNewRelicEvent(payload, clientIp),
    ]);

    if (mailResult.status === "rejected") {
      context.error("[Brevo] Failed:", mailResult.reason?.message);
      return jsonResponse(502,
        { ok: false, error: "No se pudo enviar el mensaje. Por favor intenta de nuevo." },
        corsHeaders
      );
    }

    if (nrResult.status === "rejected") {
      context.warn("[NewRelic] Event failed (non-fatal):", nrResult.reason?.message);
    }

    context.log(`[Contact] ✓ Submission from ${payload.email} | IP: ${clientIp}`);

    return jsonResponse(200, { ok: true, message: "Mensaje recibido. Te contactaremos pronto." }, corsHeaders);
  },
});
