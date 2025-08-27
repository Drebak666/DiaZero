# server/routes/html_routes.py
from flask import Blueprint, render_template, session, redirect, url_for, request, current_app
from datetime import datetime, timedelta


html_bp = Blueprint("html", __name__)

@html_bp.route('/login')
def serve_login():
    return render_template('login.html')

@html_bp.route("/despensa")
def despensa():
    return render_template("despensa.html")

@html_bp.route("/reproductor")
def reproductor():
    return render_template("reproductor.html")

@html_bp.route('/calendario')
def calendario():
    return render_template('calendario.html')

@html_bp.route('/gestor-actividades', endpoint='gestor_actividades')
def gestor_actividades():
    return render_template('gestor_actividades.html')

        
    
@html_bp.route('/citas')
def serve_citas():
    return render_template('citas.html')

@html_bp.route("/lista-compra")
def lista_compra():
    return render_template("lista_compra.html")

@html_bp.route("/alimentacion")
def alimentacion():
    return render_template('alimentacion.html', cargar_add_activity=False)

@html_bp.route('/notas')
def notas():
    return render_template('notas.html')

@html_bp.route("/mejoras")
def mejoras():
    return render_template("mejoras.html")

@html_bp.route("/documentos")
def documentos():
    return render_template('documentos.html')

@html_bp.route('/ejercicio')
def ejercicio():
    return render_template('ejercicio.html')

@html_bp.route('/registro')
def registro():
    return render_template('registro.html')

@html_bp.route('/registro-usuario')
def serve_registro_usuario():
    return render_template('registro_usuario.html')

@html_bp.route('/menu')
def menu():
    fechas_con_dias = []
    today = datetime.now()
    start_of_today = today.replace(hour=0, minute=0, second=0, microsecond=0)
    nombres_dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

    for i in range(7):
        current_date = start_of_today + timedelta(days=i)
        day_of_week_index = current_date.weekday()
        day_name = nombres_dias[day_of_week_index]
        fechas_con_dias.append({'fecha': current_date, 'dia_nombre': day_name})

    return render_template('menu.html', fechas_con_dias=fechas_con_dias)

# --------- RUTA ESPECIAL: ADMIN ---------
@html_bp.route("/admin")
def admin():
    role = (session.get("role") or "user").lower()
    if role != "admin":
        if request.args.get("plain") == "1":
            return "Acceso denegado", 403
        return redirect(url_for("html.serve_index"))
    # ⬇️ Pasamos la VAPID pública al template
    from flask import current_app
    return render_template("admin.html", vapid_public=current_app.config.get("VAPID_PUBLIC", ""))


# ----------------------------------------

@html_bp.route('/')
def serve_index():
    # Si /?plain=1 => sirve la portada "normal"
    if request.args.get('plain') == '1':
        return render_template('index.html', cargar_add_activity=True)
    # por defecto, usa el shell que mete la página en un iframe
    return redirect(url_for('html.app_mode') + '?to=/')

@html_bp.get("/app")
def app_mode():
    return render_template("app_shell.html")
