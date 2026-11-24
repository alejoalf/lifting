// Edge Function "correos": envía los avisos por mail de los partes diarios y resuelve
// las salidas excepcionales desde el enlace del mail (especificación, Módulo A).
//
// Secretos (Edge Functions > Secrets):
//   RESEND_API_KEY     clave de https://resend.com
//   CORREOS_REMITENTE  ej. "Lifting Patagonia <avisos@tudominio.com>" (dominio verificado en Resend)
//   CORREOS_CLAVE      texto largo al azar; la misma que el secreto 'correos_clave' de Vault
//   APP_URL            dirección de la app, ej. https://lifting.vercel.app
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles en todas las funciones.
//
// Publicar sin verificación de JWT (la llaman la base y la página pública de autorización):
//   supabase functions deploy correos --no-verify-jwt
//
// Pedidos:
//   POST { id }               con header x-clave-correos -> envía ese mail de la cola
//   POST { pendientes: true } con header x-clave-correos -> reintenta los pendientes
//   POST { accion: "ver" | "autorizar" | "frenar", parte, op, exp, firma, motivo? }
//                             -> desde la página /autorizar-salida (enlace firmado del mail)
import { createClient } from "npm:@supabase/supabase-js@^2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-clave-correos",
};

/** Validez de los enlaces de autorización. */
const VIGENCIA_ENLACE_HORAS = 72;
const MAX_INTENTOS = 5;

const env = (nombre: string) => Deno.env.get(nombre) ?? "";
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function escapar(texto: unknown) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Compara sin filtrar por tiempo cuántos caracteres coinciden. */
function iguales(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let distinto = 0;
  for (let i = 0; i < a.length; i++) distinto |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return distinto === 0;
}

async function firmar(parte: string, op: string, exp: string) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("CORREOS_CLAVE")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${parte}|${op}|${exp}`));
  return btoa(String.fromCharCode(...new Uint8Array(firma))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- Armado y envío de mails ----------

interface DatosCorreo {
  id: number;
  tipo: "excepcion" | "en_curso";
  para: string;
  operador_id: string | null;
  enviado_en: string | null;
  destinatario: string | null;
  parte: {
    id: string; numero: number; estado: string; fecha: string; operador: string; vehiculo: string; tarea: string;
    origen: string; destino: string; cliente: string; motivos: string[] | null; riesgo_estado: string | null;
    viento_kmh: number | null; rafaga_kmh: number | null; salida_en: string | null; autorizado_por: string | null;
  };
}

function fila(etiqueta: string, valor: unknown) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#64737a">${escapar(etiqueta)}</td><td style="padding:4px 0"><strong>${escapar(valor)}</strong></td></tr>`;
}

function plantilla(titulo: string, cuerpo: string) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f2;font-family:Arial,sans-serif;color:#1a2024">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border-top:6px solid #008047">
<p style="margin:0 0 4px;color:#64737a;font-size:12px;letter-spacing:.1em">LIFTING PATAGONIA SAS</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapar(titulo)}</h1>${cuerpo}
<p style="margin:24px 0 0;color:#64737a;font-size:12px">Aviso automático del sistema de gestión operativa.</p></div></body></html>`;
}

async function armarCorreo(d: DatosCorreo) {
  const p = d.parte;
  const datos = `<table style="border-collapse:collapse;margin:0 0 16px">${[
    fila("Parte", `N° ${p.numero}`), fila("Operador", p.operador), fila("Unidad", p.vehiculo), fila("Tarea", p.tarea),
    fila("Cliente", p.cliente), fila("Recorrido", `${p.origen} → ${p.destino}`),
    ...(p.viento_kmh !== null ? [fila("Viento", `${Math.round(p.viento_kmh)} km/h · ráfagas ${Math.round(p.rafaga_kmh ?? 0)} km/h`)] : []),
  ].join("")}</table>`;
  const enlaceParte = `${env("APP_URL")}/partes/${p.id}`;

  if (d.tipo === "excepcion") {
    const exp = String(Date.now() + VIGENCIA_ENLACE_HORAS * 3_600_000);
    const op = d.operador_id ?? "";
    const firma = await firmar(p.id, op, exp);
    const base = `${env("APP_URL")}/autorizar-salida?parte=${p.id}&op=${op}&exp=${exp}&firma=${firma}`;
    const boton = (texto: string, accion: string, color: string) =>
      `<a href="${escapar(`${base}&accion=${accion}`)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:6px;background:${color};color:#fff;font-weight:bold;text-decoration:none">${texto}</a>`;
    const motivos = (p.motivos ?? []).map((m) => `<li>${escapar(m)}</li>`).join("");
    return {
      asunto: `Parte N° ${p.numero}: pedido de salida excepcional (${p.vehiculo})`,
      html: plantilla("Pedido de salida excepcional", `
<p>${escapar(p.operador)} quiere salir con <strong>${escapar(p.vehiculo)}</strong> y el sistema bloqueó la salida:</p>
<ul style="color:#b3261e">${motivos}</ul>${datos}
<p>${boton("SÍ, AUTORIZAR SALIDA EXCEPCIONAL", "autorizar", "#008047")}${boton("NO, FRENAR UNIDAD", "frenar", "#b3261e")}</p>
<p style="color:#64737a;font-size:13px">Los botones son personales de ${escapar(d.destinatario)} y valen ${VIGENCIA_ENLACE_HORAS} horas.
Queda registrado quién autorizó o frenó. También podés resolverlo en la app: <a href="${escapar(enlaceParte)}">ver el parte</a>.</p>`),
    };
  }

  return {
    asunto: `Parte N° ${p.numero}: ${p.vehiculo} en tránsito hacia ${p.destino}`,
    html: plantilla("Operación en curso", `
<p>La unidad <strong>${escapar(p.vehiculo)}</strong> está en tránsito hacia la locación${p.autorizado_por ? ` (salida excepcional autorizada por ${escapar(p.autorizado_por)})` : ""}.</p>
${datos}<p><a href="${escapar(enlaceParte)}">Ver el parte en la app</a></p>`),
  };
}

async function enviarCorreo(id: number) {
  const { data, error } = await supabase.rpc("datos_correo", { p_id: id });
  if (error) throw new Error(error.message);
  const d = data as DatosCorreo | null;
  if (!d || d.enviado_en) return "sin cambios";

  try {
    const { asunto, html } = await armarCorreo(d);
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("CORREOS_REMITENTE"), to: [d.para], subject: asunto, html }),
    });
    if (!respuesta.ok) throw new Error(`Resend respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
    await supabase.from("correos").update({ enviado_en: new Date().toISOString(), error: null }).eq("id", id);
    await supabase.rpc("sumar_intento_correo", { p_id: id });
    return "enviado";
  } catch (fallo) {
    const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
    console.error(`Correo ${id}: ${mensaje}`);
    await supabase.from("correos").update({ error: mensaje }).eq("id", id);
    await supabase.rpc("sumar_intento_correo", { p_id: id });
    return "error";
  }
}

// ---------- Resolución desde el enlace del mail ----------

async function verificarEnlace(p: Record<string, unknown>) {
  const [parte, op, exp, firma] = [p.parte, p.op, p.exp, p.firma].map((v) => (typeof v === "string" ? v : ""));
  if (!parte || !op || !exp || !firma) return "El enlace está incompleto.";
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return "El enlace venció. Resolvé la excepción desde la app.";
  if (!iguales(firma, await firmar(parte, op, exp))) return "El enlace no es válido.";
  return "";
}

async function resolverDesdeEnlace(pedido: Record<string, unknown>) {
  const invalido = await verificarEnlace(pedido);
  if (invalido) return responder({ error: invalido }, 403);
  const parteId = String(pedido.parte);

  if (pedido.accion === "ver") {
    const { data, error } = await supabase.from("partes_diarios")
      .select("nro_parte, estado, origen, destino, tipo_tarea, documentos_vencidos, vehiculos(dominio), operadores!partes_diarios_operador_id_fkey(nombre)")
      .eq("id", parteId).maybeSingle();
    if (error || !data) return responder({ error: "El parte ya no existe." }, 404);
    const { data: admin } = await supabase.from("operadores").select("nombre").eq("id", String(pedido.op)).maybeSingle();
    return responder({ parte: data, administrador: admin?.nombre ?? "" });
  }

  if (pedido.accion !== "autorizar" && pedido.accion !== "frenar") return responder({ error: "Acción no válida." }, 400);
  const { data, error } = await supabase.rpc("resolver_excepcion_por_enlace", {
    p_id: parteId,
    p_autorizar: pedido.accion === "autorizar",
    p_motivo: typeof pedido.motivo === "string" ? pedido.motivo : "",
    p_operador_id: String(pedido.op),
  });
  if (error) return responder({ error: error.message }, 400);
  return responder({ mensaje: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido." }, 405);
  if (!env("CORREOS_CLAVE") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("Faltan secretos: CORREOS_CLAVE");
    return responder({ error: "Los correos no están configurados." }, 503);
  }

  let pedido: Record<string, unknown>;
  try {
    pedido = await req.json();
  } catch {
    return responder({ error: "Pedido inválido." }, 400);
  }

  // Enlaces firmados del mail (página pública /autorizar-salida).
  if (typeof pedido.accion === "string") return resolverDesdeEnlace(pedido);

  // Envíos: solo la base (o un reintento manual) con la clave compartida.
  if (!iguales(req.headers.get("x-clave-correos") ?? "", env("CORREOS_CLAVE"))) return responder({ error: "No autorizado." }, 401);
  if (!env("RESEND_API_KEY") || !env("CORREOS_REMITENTE") || !env("APP_URL")) {
    return responder({ error: "Faltan secretos: RESEND_API_KEY, CORREOS_REMITENTE o APP_URL." }, 503);
  }

  if (typeof pedido.id === "number") return responder({ resultado: await enviarCorreo(pedido.id) });

  if (pedido.pendientes === true) {
    const { data, error } = await supabase.from("correos").select("id")
      .is("enviado_en", null).lt("intentos", MAX_INTENTOS).order("creado_en").limit(20);
    if (error) return responder({ error: error.message }, 500);
    const resultados = [];
    for (const { id } of data ?? []) resultados.push({ id, resultado: await enviarCorreo(id) });
    return responder({ resultados });
  }

  return responder({ error: "Pedido inválido." }, 400);
});
