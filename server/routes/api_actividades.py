from flask import Blueprint, request, jsonify, session
import sqlite3

api_acts = Blueprint("api_actividades", __name__)

DB_PATH = "agenda.db"  # ajusta si tu DB vive en otra ruta

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def table_exists(con, name):
    cur = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None

def cols(con, table):
    return {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}

def _estado(val):
    s = ("" if val is None else str(val)).strip().lower()
    return "completado" if s in ("1","true","t","yes","y") else "pendiente"

def _hhmm(v):
    if v is None: return ""
    s = str(v)
    return s[:5] if len(s) >= 5 else s

def _get(row, *names):
    for n in names:
        if n in row.keys():
            return row[n]
    return None

@api_acts.get("/api/actividades")
def api_listar_actividades():
    # Filtros
    q       = (request.args.get("q") or "").strip().lower()
    tipo_f  = (request.args.get("tipo") or "").strip().lower()            # rutina|tarea|cita
    estadof = (request.args.get("estado") or "").strip().lower()          # pendiente|completado
    desde   = (request.args.get("desde") or "").strip()                   # YYYY-MM-DD
    hasta   = (request.args.get("hasta") or "").strip()                   # YYYY-MM-DD
    usuario = (request.args.get("usuario")
               or session.get("username")
               or session.get("email")
               or "").strip()

    con = db()
    try:
        out = []

        # Candidatas: (tabla, tipo)
        candidates = [
            ("routines", "rutina"), ("rutinas", "rutina"),
            ("tasks", "tarea"),     ("tareas", "tarea"),
            ("appointments", "cita"), ("citas", "cita"),
        ]

        for table, tipo in candidates:
            if not table_exists(con, table):
                continue

            cset = cols(con, table)
            for row in con.execute(f"SELECT * FROM {table}"):
                # Campos por nombre (soporta ES/EN)
                desc  = _get(row, "description", "descripcion", "titulo", "name")
                fecha = _get(row, "date", "due_date", "fecha")
                hi    = _get(row, "start_time", "hora_inicio")
                hf    = _get(row, "end_time", "hora_fin")
                # completed / is_completed / estado
                raw_estado = _get(row, "is_completed", "completed", "estado")
                user = _get(row, "usuario", "user", "username", "owner", "owner_id")

                item = {
                    "id": row["id"],
                    "tipo": tipo,
                    "descripcion": desc,
                    "fecha": fecha if (fecha or "") != "" else None,
                    "hora_inicio": _hhmm(hi),
                    "hora_fin": _hhmm(hf),
                    "estado": _estado(raw_estado),
                    "usuario": user,
                    "grupo_id": _get(row, "grupo_id", "group_id"),
                }
                out.append(item)
    finally:
        con.close()

    # Filtros robustos
    def ok(it):
        if q and q not in (it["descripcion"] or "").lower(): return False
        if tipo_f and it["tipo"] != tipo_f: return False
        if estadof and it["estado"] != estadof: return False
        if usuario and it["usuario"] != usuario: return False
        f = it["fecha"]
        if desde and f and f < desde: return False
        if hasta and f and f > hasta: return False
        return True

    out = [x for x in out if ok(x)]

    # Orden: hora ASC dentro de cada fecha, fechas DESC (vacías al final)
    out.sort(key=lambda i: (i["hora_inicio"] or "99:99"))
    out.sort(key=lambda i: (i["fecha"] or "0000-00-00"), reverse=True)

    return jsonify(out)
