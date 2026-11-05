// =====================================================================
// Sistema operativo Camill Droguería · app.js
// Una sola página. Cada pantalla es un objeto en VISTAS con:
//   titulo, tablas (para refrescar en tiempo real), montar(el), cargar(el)
// montar() dibuja la estructura y los formularios; cargar() solo las listas,
// así un cambio de otra persona no borra lo que estás escribiendo.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const TZ = 'America/Bogota';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const entero = v => parseInt(String(v ?? '').replace(/\D/g, ''), 10) || 0;
const fmtMiles = v => { const d = String(v).replace(/\D/g, ''); return d ? parseInt(d, 10).toLocaleString('es-CO') : ''; };

// ---------- Fechas en hora de Colombia ----------
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const horaCol = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()), 10);
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00-05:00'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = iso => new Date(iso + 'T12:00:00-05:00').getUTCDay(); // 0 domingo
const fFecha = iso => new Date(iso + 'T12:00:00-05:00').toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fHora = ts => new Date(ts).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fFechaHora = ts => new Date(ts).toLocaleString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fechaDe = ts => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00-05:00') - new Date(a + 'T12:00:00-05:00')) / 86400000);
const inicioDia = iso => iso + 'T00:00:00-05:00';
const haceDias = iso => { const n = diasEntre(iso, hoy()); return n <= 0 ? 'hoy' : n === 1 ? 'hace 1 día' : `hace ${n} días`; };
const esFinde = iso => [0, 6].includes(diaSemana(iso));
const turnoSugerido = () => esFinde(hoy()) ? 'Fin de semana' : (horaCol() < 14 ? 'Mañana' : 'Tarde');

// ---------- Estado global ----------
let sb = null, YO = null, EMP = {}, AJ = {}, vistaActual = null, pendienteRefresco = false;
const nombre = id => EMP[id]?.nombre ?? '—';
const esAdmin = () => YO?.rol === 'admin';
const activos = () => Object.values(EMP).filter(e => e.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));

// ---------- Utilidades de interfaz ----------
function aviso(txt, mal = false) {
  const a = $('#aviso'); a.textContent = txt; a.className = 'aviso' + (mal ? ' mal' : ''); a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), mal ? 5000 : 2500);
}
function errorTxt(e) {
  const m = e?.message || String(e);
  if (e?.code === '23505') return 'Ya existe un registro igual (por ejemplo, un cierre para ese mismo turno y fecha).';
  if (e?.code === '23514') return 'Hay un valor que no cumple las reglas. Revisa los números.';
  if (e?.code === '42501') return 'No tienes permiso para hacer esto.';
  return m;
}
async function q(promesa) {
  const { data, error } = await promesa;
  if (error) { aviso(errorTxt(error), true); throw error; }
  return data;
}
function chips(nombreGrupo, opciones, actual, clase = '') {
  return `<div class="chips ${clase}" data-grupo="${nombreGrupo}">${opciones.map(o => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return `<button type="button" class="chip${v === actual ? ' act' : ''}" data-valor="${esc(v)}">${esc(t)}</button>`;
  }).join('')}</div>`;
}
function activarChips(el, alCambiar) {
  $$('.chips', el).forEach(g => g.addEventListener('click', ev => {
    const c = ev.target.closest('.chip'); if (!c) return;
    $$('.chip', g).forEach(x => x.classList.remove('act')); c.classList.add('act');
    alCambiar?.(g.dataset.grupo, c.dataset.valor);
  }));
}
const valorChip = (el, grupo) => $(`.chips[data-grupo="${grupo}"] .chip.act`, el)?.dataset.valor ?? null;
function camposDinero(el, alCambiar) {
  $$('input[data-dinero]', el).forEach(i => i.addEventListener('input', () => { i.value = fmtMiles(i.value); alCambiar?.(); }));
}
const opcionesEmp = (sel, conVacio = '') => (conVacio ? `<option value="">${esc(conVacio)}</option>` : '') +
  activos().map(e => `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');

function abrirHoja(titulo, html, montar) {
  const h = $('#hoja');
  h.innerHTML = `<div class="cab"><h2>${esc(titulo)}</h2><button class="cerrar" aria-label="Cerrar">×</button></div>${html}`;
  $('#velo').hidden = false;
  $('.cerrar', h).onclick = cerrarHoja;
  montar?.(h);
}
function cerrarHoja() {
  $('#velo').hidden = true; $('#hoja').innerHTML = '';
  if (pendienteRefresco) { pendienteRefresco = false; refrescar(); }
}
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo') cerrarHoja(); });

// Confirmación dentro de la app (reemplaza confirm/prompt del navegador).
// Devuelve true, el texto escrito (si se pide motivo) o false si se cancela.
function confirmar(titulo, html, { motivo = false, boton = 'Confirmar', valor = '' } = {}) {
  return new Promise(ok => {
    let resuelto = false;
    abrirHoja(titulo, `<div class="card">${html}${motivo ? `<label>${esc(motivo)}</label><textarea id="cf-motivo" rows="2">${esc(valor)}</textarea>` : ''}</div>
      <button class="btn pri" id="cf-si">${esc(boton)}</button><button class="btn lin" id="cf-no">Cancelar</button>`, h => {
      $('#cf-si', h).onclick = () => {
        const r = motivo ? $('#cf-motivo', h).value.trim() : true;
        if (motivo && !r) return aviso('Completa el campo para continuar', true);
        resuelto = true; cerrarHoja(); ok(r);
      };
      $('#cf-no', h).onclick = cerrarHoja;
    });
    const obs = new MutationObserver(() => { if ($('#velo').hidden) { obs.disconnect(); if (!resuelto) ok(false); } });
    obs.observe($('#velo'), { attributes: true });
  });
}

// Historial de cambios de un registro (tabla auditoria)
const DINERO = ['total', 'efectivo', 'nequi', 'llave', 'base', 'efectivo_ventas', 'pago_domicilios', 'retirado', 'valor_domicilio'];
const fmtVal = (k, v) => v == null || v === '' ? '—' : DINERO.includes(k) ? cop(v) : typeof v === 'boolean' ? (v ? 'sí' : 'no') : EMP[v]?.nombre ?? v;
async function historialHtml(tabla, id) {
  const filas = await q(sb.from('auditoria').select('*').eq('tabla', tabla).eq('registro_id', String(id)).order('en', { ascending: false }).limit(30));
  if (!filas.length) return '<p class="vacio">Sin historial</p>';
  const ignorar = ['actualizado_en', 'registrado_en'];
  return filas.map(f => {
    let cambios = '';
    if (f.accion === 'UPDATE' && f.antes && f.despues) {
      cambios = Object.keys(f.despues).filter(k => !ignorar.includes(k) && JSON.stringify(f.antes[k]) !== JSON.stringify(f.despues[k]))
        .map(k => `${esc(k.replace(/_/g, ' '))}: <b>${esc(fmtVal(k, f.antes[k]))}</b> → <b>${esc(fmtVal(k, f.despues[k]))}</b>`).join('<br>');
    }
    const acc = { INSERT: 'Creado', UPDATE: 'Modificado', DELETE: 'Eliminado' }[f.accion];
    return `<div class="hist">${acc} · ${esc(f.usuario ?? 'sistema')} · ${fFechaHora(f.en)}${cambios ? '<br>' + cambios : ''}</div>`;
  }).join('');
}
function botonHistorial(h, tabla, id) {
  const b = $('[data-historial]', h); if (!b) return;
  b.onclick = async () => { b.outerHTML = `<div>${await historialHtml(tabla, id)}</div>`; };
}

// =====================================================================
// PANTALLAS
// =====================================================================
const VISTAS = {};

// ---------------- INICIO ----------------
VISTAS.inicio = {
  titulo: 'Inicio', tablas: ['cierres_caja', 'novedades', 'domicilios', 'faltantes', 'vencimientos', 'correcciones', 'mantenimiento', 'tareas_marcadas'],
  montar(el) {
    const h = horaCol(), saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    el.innerHTML = `<h2 class="tit">${saludo}, ${esc(YO.nombre.split(' ')[0])}</h2><p class="sub">Esto es lo que necesita atención</p>
      <div id="i-alertas"></div>
      <div class="acciones">
        <a class="accion" href="#domicilios"><i>＋</i>Nuevo domicilio</a>
        <a class="accion v" href="#caja"><i>$</i>Cierre de caja</a>
        <a class="accion" href="#faltantes"><i>!</i>Reportar faltante</a>
        <a class="accion v" href="#entrega"><i>✎</i>Entrega de turno</a>
      </div>
      <a class="card" href="#turno" style="display:block;text-decoration:none;color:inherit"><h3>Mi turno</h3><div class="prog"><div id="i-prog" style="width:0"></div></div><small id="i-progtx" style="color:var(--suave)">…</small></a>
      <div class="grid2" id="i-kpis"></div>`;
  },
  async cargar(el) {
    const d0 = sumarDias(hoy(), -6);
    const limite = sumarDias(hoy(), 30);
    const [cierres, primero, novs, domHoy, falt, venc, corr, mant, tareas, marcas] = await Promise.all([
      q(sb.from('cierres_caja').select('fecha,turno').eq('anulado', false).gte('fecha', d0)),
      q(sb.from('cierres_caja').select('fecha').order('fecha').limit(1)),
      q(sb.from('novedades').select('*').eq('resuelta', false).order('creado_en', { ascending: false })),
      q(sb.from('domicilios').select('id', { count: 'exact', head: false }).gte('fecha_hora', inicioDia(hoy())).neq('estado', 'Cancelado')),
      q(sb.from('faltantes').select('id,prioridad').eq('estado', 'Pendiente de pedir')),
      q(sb.from('vencimientos').select('id').eq('estado', 'Vigente').lte('fecha_vencimiento', limite)),
      q(sb.from('correcciones').select('id').not('estado', 'in', '("Solucionado","No procede")')),
      q(sb.from('mantenimiento').select('id').neq('estado', 'Resuelto')),
      q(sb.from('tareas').select('id,turno').eq('activa', true)),
      q(sb.from('tareas_marcadas').select('tarea_id').eq('fecha', hoy()).eq('empleado_id', YO.id)),
    ]);
    // Cierres que faltan
    const faltan = [];
    if (primero.length) {
      const inicio = primero[0].fecha;
      for (let i = 6; i >= 0; i--) {
        const d = sumarDias(hoy(), -i); if (d < inicio) continue;
        const delDia = cierres.filter(c => c.fecha === d).map(c => c.turno);
        if (delDia.includes('Fin de semana')) continue; // festivo o fin de semana
        const esHoy = d === hoy(), hr = horaCol();
        if (esFinde(d)) { if (!esHoy || hr >= 15) faltan.push([d, 'Fin de semana']); continue; }
        if (!delDia.includes('Mañana') && (!esHoy || hr >= 15)) faltan.push([d, 'Mañana']);
        if (!delDia.includes('Tarde') && !esHoy) faltan.push([d, 'Tarde']);
      }
    }
    const misNov = novs.filter(n => !n.para_id || n.para_id === YO.id);
    $('#i-alertas', el).innerHTML =
      faltan.map(([d, t]) => `<a class="alerta mal" href="#caja?fecha=${d}&turno=${encodeURIComponent(t)}"><span class="ic">●</span><div><b>Falta el cierre de caja: ${esc(t)}</b>${fFecha(d)} · toca para registrarlo</div></a>`).join('') +
      (misNov.length ? `<a class="alerta av" href="#entrega"><span class="ic">●</span><div><b>${misNov.length} novedad${misNov.length > 1 ? 'es' : ''} sin resolver</b>${esc(misNov[0].texto.slice(0, 70))}${misNov[0].texto.length > 70 ? '…' : ''}</div></a>` : '') +
      (!faltan.length && !misNov.length ? `<div class="alerta ok"><span class="ic">✓</span><div><b>Todo al día</b>No hay cierres ni novedades pendientes</div></div>` : '');
    const t = turnoSugerido() === 'Tarde' ? 'Turno 2' : 'Turno 1';
    const delTurno = tareas.filter(x => x.turno === t).map(x => x.id), hechas = marcas.filter(m => delTurno.includes(m.tarea_id)).length;
    $('#i-prog', el).style.width = (delTurno.length ? hechas / delTurno.length * 100 : 0) + '%';
    $('#i-progtx', el).textContent = `${t} · ${hechas} de ${delTurno.length} tareas hechas`;
    const alta = falt.filter(f => f.prioridad === 'Alta').length;
    $('#i-kpis', el).innerHTML = `
      <a class="kpi" href="#domicilios"><span>Domicilios hoy</span><b>${domHoy.length}</b></a>
      <a class="kpi" href="#faltantes"><span>Faltantes por pedir${alta ? ` · ${alta} urgentes` : ''}</span><b class="${alta ? 'rojo' : ''}">${falt.length}</b></a>
      <a class="kpi" href="#vencimientos"><span>Vencen en 30 días</span><b class="${venc.length ? 'rojo' : ''}">${venc.length}</b></a>
      <a class="kpi" href="#correcciones"><span>Correcciones abiertas</span><b>${corr.length}</b></a>
      <a class="kpi" href="#mantenimiento"><span>Mantenimiento pendiente</span><b>${mant.length}</b></a>`;
  }
};

// ---------------- CIERRE DE CAJA ----------------
VISTAS.caja = {
  titulo: 'Cierre de caja', tablas: [],
  montar(el, p) {
    const fecha = p.get('fecha') || hoy(), turno = p.get('turno') || turnoSugerido();
    el.innerHTML = `<h2 class="tit">Cierre de caja</h2><p class="sub">Copia los totales del turno desde Odoo</p>
      <div class="card">
        <label>Turno</label>${chips('turno', ['Mañana', 'Tarde', 'Fin de semana'], turno)}
        <div class="grid2"><div><label>Fecha</label><input type="date" id="c-fecha" value="${fecha}" max="${hoy()}"></div>
        <div><label>Responsable</label><input value="${esc(YO.nombre)}" disabled></div></div>
      </div>
      <div class="card"><h3>Lo que dice Odoo</h3>
        <label>Total vendido en el turno</label><input data-dinero inputmode="numeric" id="c-total" placeholder="0">
        <label>Efectivo</label><input data-dinero inputmode="numeric" id="c-ef" placeholder="0">
        <label>Nequi</label><input data-dinero inputmode="numeric" id="c-ne" placeholder="0">
        <label>Llave</label><input data-dinero inputmode="numeric" id="c-ll" placeholder="0">
        <div id="c-suma"></div>
        <label>Órdenes pagadas en efectivo <i>(números de Odoo, separados por coma)</i></label><input id="c-ord" placeholder="S00412, S00415">
        <label>Observaciones <i>(opcional)</i></label><textarea id="c-obs" rows="2"></textarea>
      </div>
      <button class="btn pri" id="c-guardar" disabled>Guardar cierre</button>
      <a class="btn lin" href="#resumen">Ver cierres anteriores</a>`;
    activarChips(el);
    const validar = () => {
      const t = entero($('#c-total').value), s = entero($('#c-ef').value) + entero($('#c-ne').value) + entero($('#c-ll').value);
      const ok = t > 0 && s === t;
      $('#c-suma').innerHTML = !t ? '' : ok
        ? `<div class="alerta ok" style="margin:12px 0 0"><span class="ic">✓</span><div>Efectivo + Nequi + Llave = ${cop(t)}</div></div>`
        : `<div class="alerta mal" style="margin:12px 0 0"><span class="ic">!</span><div><b>La suma no da el total</b>Suman ${cop(s)} y Odoo dice ${cop(t)}. Revisa si una transferencia quedó como efectivo o al revés.</div></div>`;
      $('#c-guardar').disabled = !ok;
    };
    camposDinero(el, validar);
    $('#c-guardar').onclick = async () => {
      $('#c-guardar').disabled = true;
      try {
        await q(sb.from('cierres_caja').insert({
          fecha: $('#c-fecha').value || hoy(), turno: valorChip(el, 'turno'),
          total: entero($('#c-total').value), efectivo: entero($('#c-ef').value), nequi: entero($('#c-ne').value), llave: entero($('#c-ll').value),
          ordenes_efectivo: $('#c-ord').value.trim() || null, observaciones: $('#c-obs').value.trim() || null,
        }));
        aviso('Cierre guardado ✓'); location.hash = '#resumen';
      } catch { validar(); }
    };
  }
};

// ---------------- RESUMEN DE CAJA ----------------
VISTAS.resumen = {
  titulo: 'Resumen de caja', tablas: ['cierres_caja'],
  montar(el) {
    el.innerHTML = `<h2 class="tit">Resumen de caja</h2>
      <div class="filtros"><input type="date" id="r-desde" value="${sumarDias(hoy(), -6)}" max="${hoy()}"><input type="date" id="r-hasta" value="${hoy()}" max="${hoy()}"></div>
      <div id="r-tot"></div><div id="r-lista"></div>`;
    $('#r-desde').onchange = $('#r-hasta').onchange = () => this.cargar(el);
  },
  async cargar(el) {
    const desde = $('#r-desde', el).value, hasta = $('#r-hasta', el).value;
    const filas = await q(sb.from('cierres_caja').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).order('registrado_en', { ascending: false }));
    const val = filas.filter(f => !f.anulado), sum = k => val.reduce((a, f) => a + f[k], 0);
    $('#r-tot', el).innerHTML = `<div class="card"><h3>Total del periodo</h3><div class="res">
      <div class="l"><span>Efectivo</span><b>${cop(sum('efectivo'))}</b></div><div class="l"><span>Nequi</span><b>${cop(sum('nequi'))}</b></div>
      <div class="l"><span>Llave</span><b>${cop(sum('llave'))}</b></div><div class="l tot"><span>Total</span><span>${cop(sum('total'))}</span></div></div></div>`;
    const dias = [...new Set(filas.map(f => f.fecha))];
    $('#r-lista', el).innerHTML = dias.length ? dias.map(d => {
      const del = filas.filter(f => f.fecha === d), v = del.filter(f => !f.anulado);
      return `<div class="card"><h3>${fFecha(d)} · ${cop(v.reduce((a, f) => a + f.total, 0))}</h3>${del.map(f => `
        <div class="fila" data-id="${f.id}"><div>${esc(f.turno)} · ${esc(nombre(f.responsable_id))}
        <small>${f.anulado ? 'Anulado: ' + esc(f.motivo_anulacion) : `Efectivo ${cop(f.efectivo)} · Nequi ${cop(f.nequi)} · Llave ${cop(f.llave)}`}</small></div>
        <div class="der">${f.anulado ? '<span class="est gr">Anulado</span>' : `<b>${cop(f.total)}</b>`}${f.recogida_id ? '<small>Recogido</small>' : ''}</div></div>`).join('')}</div>`;
    }).join('') : '<p class="vacio">No hay cierres en estas fechas</p>';
    $$('.fila', el).forEach(r => r.onclick = () => this.detalle(filas.find(f => f.id == r.dataset.id)));
  },
  detalle(f) {
    const bloqueado = f.recogida_id && !esAdmin();
    abrirHoja(`${f.turno} · ${fFecha(f.fecha)}`, `
      <div class="card">
        <label>Total</label><input data-dinero inputmode="numeric" id="e-total" value="${fmtMiles(f.total)}" ${f.anulado || bloqueado ? 'disabled' : ''}>
        <div class="grid2"><div><label>Efectivo</label><input data-dinero inputmode="numeric" id="e-ef" value="${fmtMiles(f.efectivo)}" ${f.anulado || bloqueado ? 'disabled' : ''}></div>
        <div><label>Nequi</label><input data-dinero inputmode="numeric" id="e-ne" value="${fmtMiles(f.nequi)}" ${f.anulado || bloqueado ? 'disabled' : ''}></div></div>
        <label>Llave</label><input data-dinero inputmode="numeric" id="e-ll" value="${fmtMiles(f.llave)}" ${f.anulado || bloqueado ? 'disabled' : ''}>
        <div id="e-suma"></div>
        <label>Órdenes en efectivo</label><input id="e-ord" value="${esc(f.ordenes_efectivo)}" ${f.anulado || bloqueado ? 'disabled' : ''}>
        <label>Observaciones</label><textarea id="e-obs" rows="2" ${f.anulado || bloqueado ? 'disabled' : ''}>${esc(f.observaciones)}</textarea>
        <p class="ejemplo">Registrado por ${esc(nombre(f.responsable_id))} · ${fFechaHora(f.registrado_en)}</p>
      </div>
      ${bloqueado ? '<div class="alerta az"><span class="ic">i</span><div>Este cierre ya entró en la recogida semanal. Solo un administrador puede corregirlo.</div></div>' : ''}
      ${!f.anulado && !bloqueado ? `<button class="btn pri" id="e-guardar">Guardar corrección</button>
      <button class="btn lin" id="e-anular">Anular este cierre</button>` : ''}
      <button class="btn sec" data-historial>Ver historial de cambios</button>`, h => {
      const validar = () => {
        const t = entero($('#e-total', h).value), s = entero($('#e-ef', h).value) + entero($('#e-ne', h).value) + entero($('#e-ll', h).value);
        $('#e-suma', h).innerHTML = s === t ? '' : `<div class="alerta mal" style="margin:10px 0 0"><span class="ic">!</span><div>Suman ${cop(s)} y el total es ${cop(t)}</div></div>`;
        if ($('#e-guardar', h)) $('#e-guardar', h).disabled = s !== t || !t;
      };
      camposDinero(h, validar); botonHistorial(h, 'cierres_caja', f.id);
      if ($('#e-guardar', h)) $('#e-guardar', h).onclick = async () => {
        await q(sb.from('cierres_caja').update({
          total: entero($('#e-total', h).value), efectivo: entero($('#e-ef', h).value), nequi: entero($('#e-ne', h).value), llave: entero($('#e-ll', h).value),
          ordenes_efectivo: $('#e-ord', h).value.trim() || null, observaciones: $('#e-obs', h).value.trim() || null,
        }).eq('id', f.id));
        aviso('Corrección guardada ✓'); cerrarHoja(); refrescar();
      };
      if ($('#e-anular', h)) $('#e-anular', h).onclick = async () => {
        const motivo = await confirmar('Anular cierre', `<p>El cierre de ${esc(f.turno)} del ${fFecha(f.fecha)} seguirá visible, marcado como anulado. Queda registrado quién lo anuló y por qué.</p>`, { motivo: '¿Por qué se anula?', boton: 'Anular cierre' });
        if (!motivo) return;
        await q(sb.from('cierres_caja').update({ anulado: true, motivo_anulacion: motivo }).eq('id', f.id));
        aviso('Cierre anulado'); cerrarHoja(); refrescar();
      };
    });
  }
};

// ---------------- DOMICILIOS ----------------
const ESTADOS_DOM = { Enviado: 'az', Entregado: 'ok', Devuelto: 'av', Cancelado: 'gr' };
VISTAS.domicilios = {
  titulo: 'Domicilios', tablas: ['domicilios'],
  async montar(el) {
    const gratis = AJ.conjunto_gratis || 'AquaNova', tarifa = entero(AJ.tarifa_domicilio);
    const quienPorDefecto = activos().find(e => e.nombre === 'Luis')?.id || YO.id;
    el.innerHTML = `<h2 class="tit">Domicilios</h2>
      <div class="card"><h3>Registrar domicilio</h3>
        <label>Número de orden (Odoo)</label><input id="d-orden" placeholder="S00419" autocomplete="off">
        <label>¿A dónde fue?</label>${chips('dest', [[gratis, gratis], ['otro', 'Otro conjunto']], gratis)}
        <input id="d-nombre" list="d-conjuntos" placeholder="Escribe el conjunto" style="margin-top:8px" hidden><datalist id="d-conjuntos"></datalist>
        <div id="d-cobro"></div>
        <label>¿Quién lo lleva?</label><select id="d-quien">${opcionesEmp(quienPorDefecto)}</select>
        <label>Pago</label>${chips('pago', ['Efectivo', 'Nequi', 'Llave'], 'Efectivo')}
        <label>Observaciones <i>(opcional)</i></label><input id="d-obs">
        <button class="btn pri" id="d-guardar">Guardar · queda como Enviado</button>
      </div>
      <div class="filtros"><input type="date" id="f-fecha" value="${hoy()}" max="${hoy()}">
        <select id="f-quien">${opcionesEmp('', 'Todas las personas')}</select>
        <select id="f-estado"><option value="">Todos los estados</option>${Object.keys(ESTADOS_DOM).map(s => `<option>${s}</option>`).join('')}</select>
        <input id="f-conj" placeholder="Buscar conjunto"></div>
      <div class="card" id="d-lista"></div>`;
    const pintarCobro = () => {
      const otro = valorChip(el, 'dest') === 'otro';
      $('#d-nombre').hidden = !otro;
      $('#d-cobro').innerHTML = otro
        ? `<div class="alerta av" style="margin-top:10px"><span class="ic">$</span><div><b>Se cobra domicilio: ${cop(tarifa)}</b>Fuera de ${esc(gratis)}</div></div>`
        : `<div class="alerta ok" style="margin-top:10px"><span class="ic">✓</span><div><b>Domicilio gratis</b>Dentro de ${esc(gratis)} no se cobra</div></div>`;
    };
    activarChips(el, g => g === 'dest' && pintarCobro()); pintarCobro();
    // Sugerencias de conjuntos ya escritos
    const usados = await q(sb.from('domicilios').select('destino').neq('destino', gratis).order('fecha_hora', { ascending: false }).limit(500));
    $('#d-conjuntos').innerHTML = [...new Set(usados.map(u => u.destino))].map(c => `<option value="${esc(c)}">`).join('');
    $('#d-guardar').onclick = async () => {
      const orden = $('#d-orden').value.trim().toUpperCase();
      const destino = valorChip(el, 'dest') === 'otro' ? $('#d-nombre').value.trim() : gratis;
      if (!orden) return aviso('Escribe el número de orden', true);
      if (!destino) return aviso('Escribe a qué conjunto fue', true);
      const rep = await q(sb.from('domicilios').select('id').eq('orden', orden).neq('estado', 'Cancelado').limit(1));
      if (rep.length && !(await confirmar('Orden repetida', `<p>Ya hay un domicilio con la orden <b>${esc(orden)}</b>. ¿Registrarlo de todas formas?</p>`, { boton: 'Sí, registrar' }))) return;
      $('#d-guardar').disabled = true;
      try {
        await q(sb.from('domicilios').insert({ orden, destino, domiciliario_id: $('#d-quien').value, medio_pago: valorChip(el, 'pago'), observaciones: $('#d-obs').value.trim() || null }));
        aviso('Domicilio guardado ✓');
        $('#d-orden').value = ''; $('#d-nombre').value = ''; $('#d-obs').value = '';
        $('.chips[data-grupo="dest"] .chip', el).click(); // vuelve a AquaNova
        this.cargar(el);
      } finally { $('#d-guardar').disabled = false; }
    };
    ['f-fecha', 'f-quien', 'f-estado'].forEach(id => $('#' + id).onchange = () => this.cargar(el));
    $('#f-conj').oninput = () => { clearTimeout(this.t); this.t = setTimeout(() => this.cargar(el), 300); };
  },
  async cargar(el) {
    const f = $('#f-fecha', el).value;
    let consulta = sb.from('domicilios').select('*').order('fecha_hora', { ascending: false }).limit(200);
    if (f) consulta = consulta.gte('fecha_hora', inicioDia(f)).lt('fecha_hora', inicioDia(sumarDias(f, 1)));
    if ($('#f-quien', el).value) consulta = consulta.eq('domiciliario_id', $('#f-quien', el).value);
    if ($('#f-estado', el).value) consulta = consulta.eq('estado', $('#f-estado', el).value);
    if ($('#f-conj', el).value.trim()) consulta = consulta.ilike('destino', `%${$('#f-conj', el).value.trim()}%`);
    const filas = await q(consulta);
    $('#d-lista', el).innerHTML = filas.length ? `<h3>${filas.length} domicilio${filas.length > 1 ? 's' : ''}</h3>` + filas.map(d => `
      <div class="fila" data-id="${d.id}"><div><b>${esc(d.orden)}</b> · ${esc(d.destino)}
      <small>${f ? fHora(d.fecha_hora) : fFechaHora(d.fecha_hora)} · ${esc(nombre(d.domiciliario_id))} · ${esc(d.medio_pago)}${d.valor_domicilio ? ' · cobro ' + cop(d.valor_domicilio) : ''}</small></div>
      <span class="est ${ESTADOS_DOM[d.estado]}">${esc(d.estado)}</span></div>`).join('') : '<p class="vacio">No hay domicilios con estos filtros</p>';
    $$('.fila', el).forEach(r => r.onclick = () => this.detalle(filas.find(x => x.id == r.dataset.id)));
  },
  detalle(d) {
    abrirHoja(`Orden ${d.orden}`, `<div class="card">
      <label>Estado</label>${chips('estado', Object.keys(ESTADOS_DOM), d.estado)}
      <label>Conjunto</label><input id="x-dest" value="${esc(d.destino)}">
      <label>Quién lo llevó</label><select id="x-quien">${opcionesEmp(d.domiciliario_id)}</select>
      <label>Pago</label>${chips('pago', ['Efectivo', 'Nequi', 'Llave'], d.medio_pago)}
      <label>Observaciones</label><input id="x-obs" value="${esc(d.observaciones)}">
      <p class="ejemplo">${fFechaHora(d.fecha_hora)} · registrado por ${esc(nombre(d.registrado_por))}${d.recogida_id ? ' · ya pagado en la recogida semanal' : ''}</p></div>
      <button class="btn pri" id="x-guardar">Guardar cambios</button><button class="btn sec" data-historial>Ver historial de cambios</button>`, h => {
      activarChips(h); botonHistorial(h, 'domicilios', d.id);
      $('#x-guardar', h).onclick = async () => {
        await q(sb.from('domicilios').update({ estado: valorChip(h, 'estado'), destino: $('#x-dest', h).value.trim() || d.destino, domiciliario_id: $('#x-quien', h).value, medio_pago: valorChip(h, 'pago'), observaciones: $('#x-obs', h).value.trim() || null }).eq('id', d.id));
        aviso('Domicilio actualizado ✓'); cerrarHoja(); refrescar();
      };
    });
  }
};

// ---------------- MI TURNO ----------------
VISTAS.turno = {
  titulo: 'Mi turno', tablas: ['tareas_marcadas', 'tareas'],
  montar(el) {
    this.turno = this.turno || (turnoSugerido() === 'Tarde' ? 'Turno 2' : 'Turno 1');
    el.innerHTML = `<h2 class="tit">Mi turno</h2><p class="sub">${fFecha(hoy())} · marca lo que vas haciendo</p>
      ${chips('turno', [['Turno 1', 'Turno 1 · Apertura'], ['Turno 2', 'Turno 2 · Cierre']], this.turno, 'vino')}
      <div class="card" style="margin-top:12px"><div class="prog"><div id="t-prog"></div></div><small id="t-tx" style="color:var(--suave)"></small></div>
      <div class="card" id="t-lista"></div>
      <a class="btn lin" href="#entrega">Anotar una novedad para el siguiente turno</a>`;
    activarChips(el, (g, v) => { this.turno = v; this.cargar(el); });
  },
  async cargar(el) {
    const [tareas, marcas] = await Promise.all([
      q(sb.from('tareas').select('*').eq('activa', true).eq('turno', this.turno).order('orden')),
      q(sb.from('tareas_marcadas').select('*').eq('fecha', hoy()).eq('empleado_id', YO.id)),
    ]);
    const hecha = id => marcas.find(m => m.tarea_id === id);
    let sec = '';
    $('#t-lista', el).innerHTML = tareas.length ? tareas.map(t => {
      const m = hecha(t.id), cab = t.seccion !== sec ? `<h3 style="margin-top:${sec ? 12 : 0}px">${esc(t.seccion)}</h3>` : ''; sec = t.seccion;
      return `${cab}<div class="check${m ? ' hecho' : ''}" data-id="${t.id}"><div class="box">✓</div><div><div class="tx">${esc(t.texto)}</div>${m ? `<small>Hecha a las ${fHora(m.hecha_en)}</small>` : ''}</div></div>`;
    }).join('') : '<p class="vacio">No hay tareas para este turno. Un administrador puede agregarlas en Ajustes.</p>';
    const n = tareas.filter(t => hecha(t.id)).length;
    $('#t-prog', el).style.width = (tareas.length ? n / tareas.length * 100 : 0) + '%';
    $('#t-tx', el).textContent = `${n} de ${tareas.length} tareas hechas`;
    $$('.check', el).forEach(c => c.onclick = async () => {
      const id = Number(c.dataset.id), m = hecha(id);
      if (m) await q(sb.from('tareas_marcadas').delete().eq('id', m.id));
      else await q(sb.from('tareas_marcadas').insert({ tarea_id: id }));
      this.cargar(el);
    });
  }
};

// ---------------- ENTREGA DE TURNO ----------------
VISTAS.entrega = {
  titulo: 'Entrega de turno', tablas: ['novedades'],
  montar(el) {
    el.innerHTML = `<h2 class="tit">Entrega de turno</h2><p class="sub">Lo que el siguiente turno debe saber</p>
      <div class="card"><label>Novedad o pendiente</label><textarea id="n-tx" rows="3" placeholder="Ej.: el cliente de la orden S00409 pasa a pagar mañana"></textarea>
      <label>Para</label><select id="n-para"><option value="">Siguiente turno (todos)</option>${activos().filter(e => e.id !== YO.id).map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select>
      <button class="btn pri" id="n-guardar">Dejar novedad</button></div>
      <div id="n-lista"></div>`;
    $('#n-guardar').onclick = async () => {
      const texto = $('#n-tx').value.trim(); if (!texto) return aviso('Escribe la novedad', true);
      await q(sb.from('novedades').insert({ texto, para_id: $('#n-para').value || null }));
      $('#n-tx').value = ''; aviso('Novedad guardada ✓'); this.cargar(el);
    };
  },
  async cargar(el) {
    const [abiertas, cerradas] = await Promise.all([
      q(sb.from('novedades').select('*').eq('resuelta', false).order('creado_en', { ascending: false })),
      q(sb.from('novedades').select('*').eq('resuelta', true).order('resuelta_en', { ascending: false }).limit(15)),
    ]);
    const fila = n => `<div class="fila" style="cursor:default"><div>${esc(n.texto)}<small>${esc(nombre(n.creado_por))} · ${fFechaHora(n.creado_en)}${n.para_id ? ' · para ' + esc(nombre(n.para_id)) : ''}${n.resuelta ? ` · resuelta por ${esc(nombre(n.resuelta_por))} ${fFechaHora(n.resuelta_en)}` : ''}</small></div>
      <div class="der">${n.resuelta ? `<button class="btn lin peq" data-reabrir="${n.id}">Reabrir</button>` : `<button class="btn sec peq" data-resolver="${n.id}">Resuelta</button>`}</div></div>`;
    $('#n-lista', el).innerHTML = `<div class="card"><h3>Sin resolver (${abiertas.length})</h3>${abiertas.map(fila).join('') || '<p class="vacio">Nada pendiente 🙌</p>'}</div>
      <div class="card"><h3>Resueltas recientemente</h3>${cerradas.map(fila).join('') || '<p class="vacio">—</p>'}</div>`;
    $$('[data-resolver]', el).forEach(b => b.onclick = async () => { await q(sb.from('novedades').update({ resuelta: true }).eq('id', b.dataset.resolver)); this.cargar(el); });
    $$('[data-reabrir]', el).forEach(b => b.onclick = async () => { await q(sb.from('novedades').update({ resuelta: false }).eq('id', b.dataset.reabrir)); this.cargar(el); });
  }
};

// ---------------- FALTANTES ----------------
const EST_FALT = ['Pendiente de pedir', 'Pedido', 'Recibido', 'Recibido incompleto', 'Sin existencia en proveedor'];
VISTAS.faltantes = {
  titulo: 'Faltantes', tablas: ['faltantes'],
  montar(el) {
    this.pest = this.pest || 'por';
    el.innerHTML = `<h2 class="tit">Faltantes</h2>
      ${chips('pest', [['por', 'Por pedir'], ['ped', 'Pedidos'], ['fin', 'Cerrados']], this.pest)}
      <div class="card" id="fa-lista" style="margin-top:12px"></div>
      <div class="card"><h3>Reportar faltante</h3>
        <label>Producto</label><input id="fa-prod" autocomplete="off">
        <div id="fa-dup"></div>
        <label>Presentación <i>(opcional)</i></label><input id="fa-pres" placeholder="Ej.: caja x 10, frasco 120 ml">
        <label>Situación</label>${chips('sit', [['Agotado', 'Agotado'], ['Por agotarse', 'Por agotarse'], ['Pedido por cliente', 'Lo pidió un cliente']], 'Agotado')}
        <div class="grid2"><div><label>Quedan <i>(si sabes)</i></label><input id="fa-disp" inputmode="numeric"></div><div><label>Cantidad a pedir</label><input id="fa-ped" inputmode="numeric"></div></div>
        <label>Observaciones <i>(opcional)</i></label><input id="fa-obs">
        <button class="btn pri" id="fa-guardar">Reportar</button></div>`;
    activarChips(el, (g, v) => { if (g === 'pest') { this.pest = v; this.cargar(el); } });
    $('#fa-prod').oninput = () => {
      clearTimeout(this.t); const txt = $('#fa-prod').value.trim();
      this.t = setTimeout(async () => {
        if (txt.length < 3) return ($('#fa-dup').innerHTML = '');
        const ya = await q(sb.from('faltantes').select('producto,estado').ilike('producto', `%${txt}%`).in('estado', ['Pendiente de pedir', 'Pedido']).limit(3));
        $('#fa-dup').innerHTML = ya.length ? `<div class="alerta av" style="margin-top:8px"><span class="ic">!</span><div><b>Ya está en la lista</b>${ya.map(y => esc(y.producto) + ' (' + esc(y.estado) + ')').join(', ')}</div></div>` : '';
      }, 350);
    };
    $('#fa-guardar').onclick = async () => {
      const producto = $('#fa-prod').value.trim(); if (!producto) return aviso('Escribe el producto', true);
      const n = v => v.trim() === '' ? null : entero(v);
      await q(sb.from('faltantes').insert({ producto, presentacion: $('#fa-pres').value.trim() || null, situacion: valorChip(el, 'sit'), cantidad_disponible: n($('#fa-disp').value), cantidad_pedir: n($('#fa-ped').value), observaciones: $('#fa-obs').value.trim() || null }));
      ['fa-prod', 'fa-pres', 'fa-disp', 'fa-ped', 'fa-obs'].forEach(i => $('#' + i).value = ''); $('#fa-dup').innerHTML = '';
      aviso('Faltante reportado ✓'); this.cargar(el);
    };
  },
  async cargar(el) {
    const estados = { por: ['Pendiente de pedir'], ped: ['Pedido'], fin: ['Recibido', 'Recibido incompleto', 'Sin existencia en proveedor'] }[this.pest];
    let c = sb.from('faltantes').select('*').in('estado', estados).order('prioridad').order('reportado_en', { ascending: false });
    if (this.pest === 'fin') c = c.limit(50);
    const filas = await q(c);
    $('#fa-lista', el).innerHTML = filas.length ? filas.map(f => `<div class="fila" data-id="${f.id}"><div>
      <b>${this.pest !== 'fin' ? `<span class="punto ${f.prioridad === 'Alta' ? 'mal' : 'av'}"></span>` : ''}${esc(f.producto)}</b>${f.presentacion ? ' · ' + esc(f.presentacion) : ''}
      <small>${esc(f.situacion === 'Pedido por cliente' ? 'Lo pidió un cliente' : f.situacion)}${f.cantidad_disponible != null ? ' · quedan ' + f.cantidad_disponible : ''}${f.cantidad_pedir != null ? ' · pedir ' + f.cantidad_pedir : ''}${f.proveedor ? ' · ' + esc(f.proveedor) : ''} · ${esc(nombre(f.reportado_por))} · ${fFecha(fechaDe(f.reportado_en))}</small></div>
      <span class="est ${this.pest === 'fin' ? (f.estado === 'Recibido' ? 'ok' : 'av') : (f.prioridad === 'Alta' ? 'mal' : 'av')}">${this.pest === 'fin' ? esc(f.estado) : esc(f.prioridad)}</span></div>`).join('')
      : '<p class="vacio">No hay productos en esta lista</p>';
    $$('.fila', el).forEach(r => r.onclick = () => this.detalle(filas.find(x => x.id == r.dataset.id)));
  },
  detalle(f) {
    abrirHoja(f.producto, `<div class="card">
      <label>Estado del pedido</label>${chips('estado', EST_FALT, f.estado)}
      <label>Situación</label>${chips('sit', [['Agotado', 'Agotado'], ['Por agotarse', 'Por agotarse'], ['Pedido por cliente', 'Lo pidió un cliente']], f.situacion)}
      <div class="grid2"><div><label>Quedan</label><input id="y-disp" inputmode="numeric" value="${f.cantidad_disponible ?? ''}"></div><div><label>Cantidad a pedir</label><input id="y-ped" inputmode="numeric" value="${f.cantidad_pedir ?? ''}"></div></div>
      <label>Proveedor</label><input id="y-prov" value="${esc(f.proveedor)}">
      <label>Observaciones</label><input id="y-obs" value="${esc(f.observaciones)}">
      <p class="ejemplo">Reportado por ${esc(nombre(f.reportado_por))} · ${fFechaHora(f.reportado_en)}</p></div>
      <button class="btn pri" id="y-guardar">Guardar cambios</button><button class="btn sec" data-historial>Ver historial de cambios</button>`, h => {
      activarChips(h); botonHistorial(h, 'faltantes', f.id);
      const n = v => v.trim() === '' ? null : entero(v);
      $('#y-guardar', h).onclick = async () => {
        await q(sb.from('faltantes').update({ estado: valorChip(h, 'estado'), situacion: valorChip(h, 'sit'), cantidad_disponible: n($('#y-disp', h).value), cantidad_pedir: n($('#y-ped', h).value), proveedor: $('#y-prov', h).value.trim() || null, observaciones: $('#y-obs', h).value.trim() || null }).eq('id', f.id));
        aviso('Actualizado ✓'); cerrarHoja(); refrescar();
      };
    });
  }
};

// ---------------- CORRECCIONES ODOO ----------------
const TIPOS_CORR = ['Fraccionamiento', 'Fecha de vencimiento', 'Producto no aparece', 'Ficha con información incorrecta', 'Falla de Odoo', 'Otro'];
const EST_CORR = { 'Nuevo': 'av', 'Enviado al ingeniero': 'az', 'En revisión': 'az', 'Solucionado': 'ok', 'No procede': 'gr' };
VISTAS.correcciones = {
  titulo: 'Correcciones Odoo', tablas: ['correcciones'],
  montar(el) {
    this.pest = this.pest || 'abiertas';
    el.innerHTML = `<h2 class="tit">Correcciones de Odoo</h2><p class="sub">Sandra o Juan Camilo las envían al ingeniero</p>
      ${chips('pest', [['abiertas', 'Abiertas'], ['cerradas', 'Cerradas']], this.pest)}
      <div class="card" id="co-lista" style="margin-top:12px"></div>
      <div class="card"><h3>Reportar corrección</h3>
        <label>Tipo</label><select id="co-tipo">${TIPOS_CORR.map(t => `<option>${t}</option>`).join('')}</select>
        <label>Producto o sección afectada</label><input id="co-prod">
        <label>¿Qué pasa?</label><textarea id="co-desc" rows="3"></textarea>
        <label>Prioridad</label>${chips('prio', ['Alta', 'Media', 'Baja'], 'Media')}
        <label>Captura <i>(opcional, máx. 5 MB)</i></label><input type="file" id="co-foto" accept="image/*">
        <button class="btn pri" id="co-guardar">Reportar</button></div>`;
    activarChips(el, (g, v) => { if (g === 'pest') { this.pest = v; this.cargar(el); } });
    $('#co-guardar').onclick = async () => {
      const prod = $('#co-prod').value.trim(), desc = $('#co-desc').value.trim();
      if (!prod || !desc) return aviso('Escribe el producto y qué pasa', true);
      $('#co-guardar').disabled = true;
      try {
        let evidencia = null; const file = $('#co-foto').files[0];
        if (file) {
          if (file.size > 5242880) throw aviso('La imagen pesa más de 5 MB', true);
          evidencia = `${hoy()}/${Date.now()}-${file.name.replace(/[^\w.]/g, '_')}`;
          await q(sb.storage.from('evidencias').upload(evidencia, file));
        }
        await q(sb.from('correcciones').insert({ tipo: $('#co-tipo').value, producto_seccion: prod, descripcion: desc, prioridad: valorChip(el, 'prio'), evidencia }));
        ['co-prod', 'co-desc', 'co-foto'].forEach(i => $('#' + i).value = '');
        aviso('Corrección reportada ✓'); this.cargar(el);
      } finally { $('#co-guardar').disabled = false; }
    };
  },
  async cargar(el) {
    let c = sb.from('correcciones').select('*').order('reportado_en', { ascending: false });
    c = this.pest === 'abiertas' ? c.not('estado', 'in', '("Solucionado","No procede")') : c.in('estado', ['Solucionado', 'No procede']).limit(50);
    const filas = await q(c);
    $('#co-lista', el).innerHTML = filas.length ? filas.map(f => `<div class="fila" data-id="${f.id}"><div>${esc(f.tipo)} · ${esc(f.producto_seccion)}
      <small>${f.prioridad === 'Alta' ? '<b style="color:var(--carmesi)">Alta</b> · ' : ''}${esc(nombre(f.reportado_por))} · ${fFecha(fechaDe(f.reportado_en))}${this.pest === 'abiertas' ? ' · ' + haceDias(fechaDe(f.reportado_en)) : ''}${f.evidencia ? ' · 📎' : ''}</small></div>
      <span class="est ${EST_CORR[f.estado]}">${esc(f.estado)}</span></div>`).join('') : '<p class="vacio">No hay correcciones aquí</p>';
    $$('.fila', el).forEach(r => r.onclick = () => this.detalle(filas.find(x => x.id == r.dataset.id)));
  },
  detalle(f) {
    abrirHoja(f.producto_seccion, `<div class="card"><p><b>${esc(f.tipo)}</b></p><p style="margin-top:6px;white-space:pre-wrap">${esc(f.descripcion)}</p>
      <div id="z-foto"></div>
      <label>Estado</label>${chips('estado', Object.keys(EST_CORR), f.estado)}
      <label>Prioridad</label>${chips('prio', ['Alta', 'Media', 'Baja'], f.prioridad)}
      <label>Respuesta u observaciones del ingeniero</label><textarea id="z-resp" rows="3">${esc(f.respuesta)}</textarea>
      <p class="ejemplo">Reportado por ${esc(nombre(f.reportado_por))} · ${fFechaHora(f.reportado_en)}${f.fecha_solucion ? ' · cerrado ' + fFechaHora(f.fecha_solucion) : ''}</p></div>
      <button class="btn pri" id="z-guardar">Guardar cambios</button><button class="btn sec" data-historial>Ver historial de cambios</button>`, async h => {
      activarChips(h); botonHistorial(h, 'correcciones', f.id);
      $('#z-guardar', h).onclick = async () => {
        await q(sb.from('correcciones').update({ estado: valorChip(h, 'estado'), prioridad: valorChip(h, 'prio'), respuesta: $('#z-resp', h).value.trim() || null }).eq('id', f.id));
        aviso('Actualizado ✓'); cerrarHoja(); refrescar();
      };
      if (f.evidencia) {
        const { data } = await sb.storage.from('evidencias').createSignedUrl(f.evidencia, 600);
        if (data?.signedUrl) $('#z-foto', h).innerHTML = `<a href="${data.signedUrl}" target="_blank" rel="noopener"><img src="${data.signedUrl}" alt="Captura" style="width:100%;border-radius:12px;margin-top:10px"></a>`;
      }
    });
  }
};

// ---------------- VENCIMIENTOS ----------------
VISTAS.vencimientos = {
  titulo: 'Próximos a vencer', tablas: ['vencimientos'],
  montar(el) {
    el.innerHTML = `<h2 class="tit">Próximos a vencer</h2><p class="sub">Anota los productos que notes cerca de su fecha</p>
      <div class="card" id="v-lista"></div>
      <div class="card"><h3>Anotar producto</h3>
        <label>Producto</label><input id="v-prod">
        <div class="grid2"><div><label>Ubicación <i>(ej. A3D)</i></label><input id="v-ubi"></div><div><label>Cantidad</label><input id="v-cant" inputmode="numeric"></div></div>
        <label>Fecha de vencimiento</label><input type="date" id="v-fecha" min="${sumarDias(hoy(), -365)}">
        <button class="btn pri" id="v-guardar">Guardar</button></div>`;
    $('#v-guardar').onclick = async () => {
      const producto = $('#v-prod').value.trim(), fecha = $('#v-fecha').value;
      if (!producto || !fecha) return aviso('Escribe el producto y la fecha', true);
      await q(sb.from('vencimientos').insert({ producto, ubicacion: $('#v-ubi').value.trim().toUpperCase() || null, cantidad: $('#v-cant').value ? entero($('#v-cant').value) : null, fecha_vencimiento: fecha }));
      ['v-prod', 'v-ubi', 'v-cant', 'v-fecha'].forEach(i => $('#' + i).value = ''); aviso('Guardado ✓'); this.cargar(el);
    };
  },
  async cargar(el) {
    const filas = await q(sb.from('vencimientos').select('*').eq('estado', 'Vigente').order('fecha_vencimiento'));
    $('#v-lista', el).innerHTML = filas.length ? filas.map(v => {
      const d = diasEntre(hoy(), v.fecha_vencimiento), cls = d <= 30 ? 'mal' : d <= 60 ? 'av' : 'az';
      return `<div class="fila" data-id="${v.id}"><div>${esc(v.producto)}<small>${v.ubicacion ? 'Ubicación ' + esc(v.ubicacion) + ' · ' : ''}${v.cantidad != null ? v.cantidad + ' und · ' : ''}vence ${fFecha(v.fecha_vencimiento)}</small></div>
        <span class="est ${cls}">${d < 0 ? 'Vencido' : d === 0 ? 'Hoy' : d + ' días'}</span></div>`;
    }).join('') : '<p class="vacio">No hay productos anotados</p>';
    $$('.fila', el).forEach(r => r.onclick = () => {
      const v = filas.find(x => x.id == r.dataset.id);
      abrirHoja(v.producto, `<div class="card"><p>Vence ${fFecha(v.fecha_vencimiento)}${v.ubicacion ? ' · ' + esc(v.ubicacion) : ''}</p>
        <label>¿Qué se hizo?</label>${chips('estado', ['Vigente', 'Vendido', 'Retirado', 'Devuelto'], v.estado)}
        <label>Observaciones</label><input id="w-obs" value="${esc(v.observaciones)}"></div>
        <button class="btn pri" id="w-guardar">Guardar</button><button class="btn sec" data-historial>Ver historial de cambios</button>`, h => {
        activarChips(h); botonHistorial(h, 'vencimientos', v.id);
        $('#w-guardar', h).onclick = async () => { await q(sb.from('vencimientos').update({ estado: valorChip(h, 'estado'), observaciones: $('#w-obs', h).value.trim() || null }).eq('id', v.id)); aviso('Guardado ✓'); cerrarHoja(); refrescar(); };
      });
    });
  }
};

// ---------------- MANTENIMIENTO ----------------
const EST_MANT = { 'Pendiente': 'av', 'En proceso': 'az', 'Resuelto': 'ok' };
VISTAS.mantenimiento = {
  titulo: 'Mantenimiento', tablas: ['mantenimiento'],
  montar(el) {
    el.innerHTML = `<h2 class="tit">Mantenimiento</h2><p class="sub">Equipos y local</p>
      <div class="card" id="m-lista"></div>
      <div class="card"><h3>Reportar</h3>
        <label>Equipo o área</label>${chips('area', ['Nevera', 'Computador', 'Celular', 'Local', 'Otro'], 'Nevera')}
        <label>¿Qué pasa?</label><textarea id="m-desc" rows="2"></textarea>
        <button class="btn pri" id="m-guardar">Reportar</button></div>`;
    activarChips(el);
    $('#m-guardar').onclick = async () => {
      const descripcion = $('#m-desc').value.trim(); if (!descripcion) return aviso('Describe qué pasa', true);
      await q(sb.from('mantenimiento').insert({ area: valorChip(el, 'area'), descripcion }));
      $('#m-desc').value = ''; aviso('Reportado ✓'); this.cargar(el);
    };
  },
  async cargar(el) {
    const filas = await q(sb.from('mantenimiento').select('*').order('reportado_en', { ascending: false }).limit(60));
    const orden = filas.sort((a, b) => (a.estado === 'Resuelto') - (b.estado === 'Resuelto'));
    $('#m-lista', el).innerHTML = orden.length ? orden.map(m => `<div class="fila" data-id="${m.id}"><div>${esc(m.area)} · ${esc(m.descripcion)}<small>${esc(nombre(m.reportado_por))} · ${fFecha(fechaDe(m.reportado_en))}${m.resuelto_en ? ' · resuelto ' + fFecha(fechaDe(m.resuelto_en)) : ''}</small></div><span class="est ${EST_MANT[m.estado]}">${esc(m.estado)}</span></div>`).join('') : '<p class="vacio">Sin reportes</p>';
    $$('.fila', el).forEach(r => r.onclick = () => {
      const m = filas.find(x => x.id == r.dataset.id);
      abrirHoja(m.area, `<div class="card"><p style="white-space:pre-wrap">${esc(m.descripcion)}</p>
        <label>Estado</label>${chips('estado', Object.keys(EST_MANT), m.estado)}
        <label>Observaciones</label><input id="mm-obs" value="${esc(m.observaciones)}"></div>
        <button class="btn pri" id="mm-guardar">Guardar</button><button class="btn sec" data-historial>Ver historial de cambios</button>`, h => {
        activarChips(h); botonHistorial(h, 'mantenimiento', m.id);
        $('#mm-guardar', h).onclick = async () => { await q(sb.from('mantenimiento').update({ estado: valorChip(h, 'estado'), observaciones: $('#mm-obs', h).value.trim() || null }).eq('id', m.id)); aviso('Guardado ✓'); cerrarHoja(); refrescar(); };
      });
    });
  }
};

// ---------------- CIERRE SEMANAL (admin) ----------------
VISTAS.semana = {
  titulo: 'Cierre semanal', tablas: ['cierres_caja', 'domicilios'], admin: true,
  montar(el) {
    el.innerHTML = `<h2 class="tit">Cierre semanal</h2><p class="sub">Pago de domicilios y recogida del efectivo</p><div id="s-prev"></div><div id="s-hist"></div>
      <button class="btn lin" id="s-resp">Descargar respaldo en Excel</button>`;
    $('#s-resp').onclick = descargarRespaldo;
  },
  async cargar(el) {
    const [v, hist] = await Promise.all([q(sb.rpc('vista_recogida')), q(sb.from('recogidas').select('*').order('fecha_hora', { ascending: false }).limit(10))]);
    const pago = v.pagos.reduce((a, p) => a + p.valor, 0), retiro = v.efectivo_ventas - pago;
    $('#s-prev', el).innerHTML = `
      <div class="card"><h3>Pago de domicilios${v.desde ? ' · desde ' + fFecha(v.desde) : ''}</h3>
        ${v.pagos.map(p => `<div class="fila" style="cursor:default"><div>${esc(p.nombre)}<small>${p.cantidad} domicilio${p.cantidad > 1 ? 's' : ''} fuera de ${esc(AJ.conjunto_gratis)}</small></div><b>${cop(p.valor)}</b></div>`).join('') || '<p class="vacio">No hay domicilios cobrados pendientes de pago</p>'}
        <div class="res"><div class="l tot"><span>Total a pagar</span><span>${cop(pago)}</span></div></div></div>
      <div class="card"><h3>Recogida del efectivo</h3>
        <div class="res" style="background:var(--az-bg);color:var(--atlantico);margin-top:0">
          <div class="l"><span>Base</span><b>${cop(v.base)}</b></div>
          <div class="l"><span>+ Efectivo vendido (${v.cierres} cierres)</span><b>${cop(v.efectivo_ventas)}</b></div>
          <div class="l"><span>= Debería haber en el cajón</span><b>${cop(v.base + v.efectivo_ventas)}</b></div>
          <div class="l"><span>− Pago de domicilios</span><b>${cop(pago)}</b></div>
          <div class="l"><span>− Base que se queda</span><b>${cop(v.base)}</b></div>
          <div class="l tot"><span>Se retira</span><span>${cop(retiro)}</span></div></div>
        <label>Quién recoge</label><select id="s-quien">${activos().filter(e => e.rol === 'admin').map(e => `<option value="${e.id}"${e.id === YO.id ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>
        <label>Observaciones <i>(opcional)</i></label><input id="s-obs">
        <button class="btn pri" id="s-reg" ${!v.cierres && !v.pagos.length ? 'disabled' : ''}>Registrar recogida y pago</button></div>`;
    $('#s-reg', el).onclick = async () => {
      if (!(await confirmar('Registrar recogida', `<p>Se pagan <b>${cop(pago)}</b> de domicilios y se retiran <b>${cop(retiro)}</b>. En el cajón quedan ${cop(v.base)} de base.</p>`, { boton: 'Confirmar recogida' }))) return;
      await q(sb.rpc('registrar_recogida', { p_recogido_por: $('#s-quien', el).value, p_observaciones: $('#s-obs', el).value.trim() || null }));
      aviso('Recogida registrada ✓'); this.cargar(el);
    };
    $('#s-hist', el).innerHTML = `<div class="card"><h3>Recogidas anteriores</h3>${hist.map(r => `<div class="fila" style="cursor:default"><div>${fFechaHora(r.fecha_hora)} · ${esc(nombre(r.recogido_por))}
      <small>${r.anulado ? 'Anulada: ' + esc(r.motivo_anulacion) : `Efectivo ${cop(r.efectivo_ventas)} · domicilios ${cop(r.pago_domicilios)}${r.detalle_pagos.length ? ' (' + r.detalle_pagos.map(p => esc(p.nombre) + ' ' + cop(p.valor)).join(', ') + ')' : ''}`}</small></div><b>${cop(r.retirado)}</b></div>`).join('') || '<p class="vacio">Aún no hay recogidas</p>'}</div>`;
  }
};

// ---------------- MÁS ----------------
VISTAS.mas = {
  titulo: 'Más', tablas: [],
  montar(el) {
    el.innerHTML = `<h2 class="tit">Más secciones</h2>
      <div class="card menu">
        <a href="#resumen">Resumen de caja</a><a href="#entrega">Entrega de turno</a><a href="#faltantes">Faltantes</a>
        <a href="#correcciones">Correcciones de Odoo</a><a href="#vencimientos">Próximos a vencer</a><a href="#mantenimiento">Mantenimiento</a>
      </div>
      ${esAdmin() ? `<div class="card menu"><a href="#semana">Cierre semanal y pago de domicilios</a><a href="#ajustes">Ajustes: empleados, tareas y valores</a></div>` : ''}
      <div class="card"><p>Sesión: <b>${esc(YO.nombre)}</b> · ${esc(YO.correo)}${esAdmin() ? ' · administrador' : ''}</p><button class="btn lin" id="salir">Cerrar sesión</button></div>`;
    $('#salir').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  }
};

// ---------------- AJUSTES (admin) ----------------
VISTAS.ajustes = {
  titulo: 'Ajustes', tablas: ['empleados', 'tareas', 'ajustes'], admin: true,
  montar(el) { el.innerHTML = `<h2 class="tit">Ajustes</h2><div id="a-emp"></div><div id="a-val"></div><div id="a-tar"></div>`; },
  async cargar(el) {
    const [emps, tareas, ajustes] = await Promise.all([q(sb.from('empleados').select('*').order('nombre')), q(sb.from('tareas').select('*').order('turno').order('orden')), q(sb.from('ajustes').select('*'))]);
    EMP = Object.fromEntries(emps.map(e => [e.id, e])); AJ = Object.fromEntries(ajustes.map(a => [a.clave, a.valor]));
    $('#a-emp', el).innerHTML = `<div class="card"><h3>Empleados</h3>${emps.map(e => `<div class="fila" data-emp="${e.id}"><div>${esc(e.nombre)}<small>${esc(e.correo)}</small></div><span class="est ${e.activo ? (e.rol === 'admin' ? 'az' : 'ok') : 'gr'}">${e.activo ? (e.rol === 'admin' ? 'Administrador' : 'Empleado') : 'Inactivo'}</span></div>`).join('')}
      <button class="btn sec" id="a-nuevo">Agregar empleado</button></div>`;
    $('#a-val', el).innerHTML = `<div class="card"><h3>Valores</h3>${ajustes.map(a => `<div class="fila" data-aj="${esc(a.clave)}"><div>${esc(a.nota || a.clave)}</div><b>${/^\d+$/.test(a.valor) ? cop(a.valor) : esc(a.valor)}</b></div>`).join('')}</div>`;
    let t0 = '';
    $('#a-tar', el).innerHTML = `<div class="card"><h3>Tareas de los turnos</h3>${tareas.map(t => { const cab = t.turno !== t0 ? `<p style="margin-top:10px"><b>${esc(t.turno)}</b></p>` : ''; t0 = t.turno; return `${cab}<div class="fila" data-tar="${t.id}"><div>${esc(t.texto)}<small>${esc(t.seccion)} · orden ${t.orden}</small></div>${t.activa ? '' : '<span class="est gr">Oculta</span>'}</div>`; }).join('')}
      <button class="btn sec" id="a-ntar">Agregar tarea</button></div>`;
    const formEmp = (e = {}) => abrirHoja(e.id ? e.nombre : 'Nuevo empleado', `<div class="card">
      <label>Nombre</label><input id="ae-nom" value="${esc(e.nombre)}"><label>Correo de Gmail</label><input id="ae-cor" type="email" value="${esc(e.correo)}">
      <label>Rol</label>${chips('rol', [['empleado', 'Empleado'], ['admin', 'Administrador']], e.rol || 'empleado')}
      <label>Estado</label>${chips('act', [['si', 'Activo'], ['no', 'Inactivo (ya no entra)']], e.activo === false ? 'no' : 'si')}</div>
      <button class="btn pri" id="ae-g">Guardar</button>`, h => {
      activarChips(h);
      $('#ae-g', h).onclick = async () => {
        const fila = { nombre: $('#ae-nom', h).value.trim(), correo: $('#ae-cor', h).value.trim().toLowerCase(), rol: valorChip(h, 'rol'), activo: valorChip(h, 'act') === 'si' };
        if (!fila.nombre || !fila.correo.includes('@')) return aviso('Escribe nombre y correo', true);
        if (e.id === YO.id && (!fila.activo || fila.rol !== 'admin')) return aviso('No puedes quitarte a ti mismo el acceso de administrador', true);
        await q(e.id ? sb.from('empleados').update(fila).eq('id', e.id) : sb.from('empleados').insert(fila));
        aviso('Guardado ✓'); cerrarHoja(); this.cargar(el);
      };
    });
    const formTar = (t = {}) => abrirHoja(t.id ? 'Editar tarea' : 'Nueva tarea', `<div class="card">
      <label>Turno</label>${chips('turno', ['Turno 1', 'Turno 2'], t.turno || 'Turno 1')}
      <label>Sección</label><input id="at-sec" value="${esc(t.seccion || 'Durante la jornada')}" list="at-secs"><datalist id="at-secs">${[...new Set(tareas.map(x => x.seccion))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Tarea</label><textarea id="at-tx" rows="3">${esc(t.texto)}</textarea>
      <label>Orden <i>(número; las menores salen primero)</i></label><input id="at-ord" inputmode="numeric" value="${t.orden ?? 200}">
      <label>Visible</label>${chips('act', [['si', 'Sí'], ['no', 'Ocultar']], t.activa === false ? 'no' : 'si')}</div>
      <button class="btn pri" id="at-g">Guardar</button>`, h => {
      activarChips(h);
      $('#at-g', h).onclick = async () => {
        const fila = { turno: valorChip(h, 'turno'), seccion: $('#at-sec', h).value.trim(), texto: $('#at-tx', h).value.trim(), orden: entero($('#at-ord', h).value), activa: valorChip(h, 'act') === 'si' };
        if (!fila.seccion || !fila.texto) return aviso('Escribe la sección y la tarea', true);
        await q(t.id ? sb.from('tareas').update(fila).eq('id', t.id) : sb.from('tareas').insert(fila));
        aviso('Guardado ✓'); cerrarHoja(); this.cargar(el);
      };
    });
    $('#a-nuevo', el).onclick = () => formEmp();
    $('#a-ntar', el).onclick = () => formTar();
    $$('[data-emp]', el).forEach(r => r.onclick = () => formEmp(EMP[r.dataset.emp]));
    $$('[data-tar]', el).forEach(r => r.onclick = () => formTar(tareas.find(t => t.id == r.dataset.tar)));
    $$('[data-aj]', el).forEach(r => r.onclick = async () => {
      const a = ajustes.find(x => x.clave === r.dataset.aj);
      const nuevo = await confirmar('Cambiar valor', `<p>${esc(a.nota || a.clave)}</p>`, { motivo: 'Nuevo valor', boton: 'Guardar', valor: a.valor });
      if (!nuevo || nuevo === a.valor) return;
      await q(sb.from('ajustes').update({ valor: nuevo }).eq('clave', a.clave)); aviso('Guardado ✓'); this.cargar(el);
    });
  }
};

// ---------------- RESPALDO ----------------
async function descargarRespaldo() {
  aviso('Preparando respaldo…');
  if (!window.XLSX) await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
  const tablas = ['cierres_caja', 'domicilios', 'recogidas', 'faltantes', 'correcciones', 'novedades', 'vencimientos', 'mantenimiento', 'tareas', 'tareas_marcadas', 'empleados', 'ajustes', 'auditoria'];
  const libro = XLSX.utils.book_new();
  for (const t of tablas) {
    let todo = [], desde = 0;
    for (;;) { const lote = await q(sb.from(t).select('*').range(desde, desde + 999)); todo = todo.concat(lote); if (lote.length < 1000) break; desde += 1000; }
    const filas = todo.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : (EMP[v]?.nombre ?? v)])));
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas.length ? filas : [{ sin_datos: '' }]), t.slice(0, 31));
  }
  XLSX.writeFile(libro, `RESPALDO CAMILL ${hoy()}.xlsx`);
  aviso('Respaldo descargado ✓');
}

// =====================================================================
// NAVEGACIÓN, SESIÓN Y TIEMPO REAL
// =====================================================================
async function refrescar() {
  const v = VISTAS[vistaActual]; if (!v?.cargar) return;
  try { await v.cargar($('#pantalla')); } catch (e) { console.error(e); }
}
async function navegar() {
  const [ruta, qs] = (location.hash.slice(1) || 'inicio').split('?');
  const nombreVista = VISTAS[ruta] && (!VISTAS[ruta].admin || esAdmin()) ? ruta : 'inicio';
  vistaActual = nombreVista; const v = VISTAS[nombreVista], el = $('#pantalla');
  if ($('#velo').hidden === false) cerrarHoja();
  $('#barra-sub').textContent = `${fFecha(hoy())} · ${v.titulo}`;
  $$('#nav a').forEach(a => a.classList.toggle('act', a.dataset.v === nombreVista));
  window.scrollTo(0, 0);
  try { await v.montar(el, new URLSearchParams(qs || '')); await v.cargar?.(el); }
  catch (e) { console.error(e); }
}

function pantallaIngreso(mensaje = '') {
  $('#barra').hidden = true; $('#nav').hidden = true;
  $('#pantalla').innerHTML = `<div class="login"><img src="logo.png" alt="Camill Droguería"><h2>Sistema operativo</h2>
    <p>${mensaje || 'Entra con tu cuenta de Google.<br>Solo pueden entrar los correos autorizados.'}</p>
    <button class="google" id="g"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>${mensaje ? 'Entrar con otra cuenta' : 'Entrar con Google'}</button></div>`;
  $('#g').onclick = async () => {
    if (mensaje) await sb.auth.signOut();
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
  };
}

async function iniciar() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    $('#pantalla').innerHTML = `<div class="card" style="margin-top:30px"><h3>Falta conectar la base de datos</h3><p>Abre <b>config.js</b> y pega la URL y la "anon key" del proyecto de Supabase. Ver la guía <b>GUIA DE INSTALACION.md</b>.</p></div>`;
    return;
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaIngreso();
  const correo = session.user.email.toLowerCase();
  const { data: emps, error } = await sb.from('empleados').select('*');
  if (error) return pantallaIngreso('No se pudo conectar: ' + esc(error.message));
  EMP = Object.fromEntries(emps.map(e => [e.id, e]));
  YO = emps.find(e => e.correo === correo && e.activo);
  if (!YO) return pantallaIngreso(`El correo <b>${esc(correo)}</b> no está autorizado.<br>Pide a un administrador que te agregue.`);
  AJ = Object.fromEntries((await q(sb.from('ajustes').select('*'))).map(a => [a.clave, a.valor]));
  $('#barra').hidden = false; $('#nav').hidden = false;
  $('#avatar').textContent = YO.nombre[0].toUpperCase(); $('#avatar').onclick = () => (location.hash = '#mas');
  if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  window.addEventListener('hashchange', navegar);
  // Tiempo real: si otra persona registra algo, la lista visible se actualiza sola
  let t;
  sb.channel('cambios').on('postgres_changes', { event: '*', schema: 'public' }, p => {
    if (!VISTAS[vistaActual]?.tablas.includes(p.table)) return;
    if (!$('#velo').hidden) { pendienteRefresco = true; return; }
    clearTimeout(t); t = setTimeout(refrescar, 400);
  }).subscribe();
  // Al volver a la app después de un rato, refrescar
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  navegar();
}
iniciar();
