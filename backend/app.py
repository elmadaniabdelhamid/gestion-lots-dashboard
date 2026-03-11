import json
import os
import shutil
import time
from collections import defaultdict
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from services import db_service, export_service, zip_service

app = FastAPI(title="Gestion Lots Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.on_event("startup")
def startup():
    db_service.test_connection()


# ---------- Health ----------

@app.get("/api/health")
def health():
    return {"status": "OK", "message": "Server is running"}


@app.get("/api/db-health")
def db_health():
    try:
        row = db_service.fetch_one("SELECT COUNT(*) as count FROM controle")
        return {
            "status": "OK",
            "message": "Database connected",
            "record_count": int(row["count"]),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "status": "Error",
            "message": "Database connection failed",
            "error": str(e),
        })


# ---------- CRUD ----------

@app.get("/api/controle")
def get_controle():
    try:
        rows = db_service.fetch_all(
            'SELECT * FROM controle ORDER BY date_debut DESC'
        )
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch controle data")


@app.get("/api/controle/{num_lot}")
def get_controle_by_lot(num_lot: str):
    try:
        row = db_service.fetch_one(
            'SELECT * FROM controle WHERE "Num_lot" = %s', (num_lot,)
        )
        if not row:
            raise HTTPException(status_code=404, detail="Controle record not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch controle record")


# ---------- Stats ----------

@app.get("/api/stats/controleur")
def stats_controleur():
    try:
        return db_service.fetch_all("""
            SELECT
                login_controleur,
                COUNT(*) as nb_lots,
                SUM(nb_actes_traites) as total_actes_traites,
                SUM(nb_actes_rejets) as total_actes_rejets,
                AVG(nb_actes_traites) as avg_actes_traites,
                AVG(nb_actes_rejets) as avg_actes_rejets
            FROM controle
            GROUP BY login_controleur
            ORDER BY nb_lots DESC
        """)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to fetch controleur statistics"
        )


@app.get("/api/stats/general")
def stats_general():
    try:
        return db_service.fetch_one("""
            SELECT
                COUNT(*) as total_lots,
                SUM(nb_actes_traites) as total_actes_traites,
                SUM(nb_actes_rejets) as total_actes_rejets,
                COUNT(DISTINCT login_controleur) as nb_controleurs,
                MIN(date_debut) as first_date,
                MAX(date_fin) as last_date
            FROM controle
        """)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Failed to fetch general statistics"
        )


# ---------- Import ----------

def _import_single_item(item: dict) -> dict | None:
    """Insert/upsert a single JSON item. Returns error dict on failure, None on success."""
    quality = zip_service.parse_qualite_acte(item.get("qualite_acte"))

    query = """
        INSERT INTO controle (
            "Num_lot", arborescence, login_controleur, login_scan,
            date_debut, date_fin, nb_actes_traites, nb_actes_rejets,
            tentative, doublons, baseline
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("Num_lot") DO UPDATE SET
            arborescence = EXCLUDED.arborescence,
            login_controleur = EXCLUDED.login_controleur,
            login_scan = EXCLUDED.login_scan,
            date_debut = EXCLUDED.date_debut,
            date_fin = EXCLUDED.date_fin,
            nb_actes_traites = EXCLUDED.nb_actes_traites,
            nb_actes_rejets = EXCLUDED.nb_actes_rejets,
            tentative = EXCLUDED.tentative,
            doublons = EXCLUDED.doublons,
            baseline = EXCLUDED.baseline
    """
    params = (
        item.get("Num_lot"),
        item.get("arborescence"),
        item.get("login_controleur", "agent de controle"),
        item.get("login_scan", "agent de scan"),
        item.get("date_debut"),
        item.get("date_fin"),
        item.get("nb_actes_traites", 0),
        item.get("nb_actes_rejets", 0),
        item.get("tentative", 0),
        quality["doublons"],
        quality["baseline"],
    )
    db_service.execute(query, params)
    return None


@app.post("/api/import")
async def import_json_file(jsonFile: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, f"{int(time.time())}-{jsonFile.filename}")
    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(jsonFile.file, f)

        with open(file_path, "r", encoding="utf-8") as f:
            json_data = json.load(f)

        data = json_data if isinstance(json_data, list) else [json_data]

        success_count = 0
        error_count = 0
        errors = []

        for item in data:
            try:
                _import_single_item(item)
                success_count += 1
            except Exception as e:
                error_count += 1
                errors.append({"Num_lot": item.get("Num_lot"), "error": str(e)})

        return {
            "message": "Import completed",
            "total_records": len(data),
            "success_count": success_count,
            "error_count": error_count,
            "errors": errors,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail={"error": "Failed to import data", "details": str(e)}
        )
    finally:
        if os.path.exists(file_path):
            os.unlink(file_path)


@app.post("/api/import/json")
async def import_json_body(request: Request):
    try:
        json_data = await request.json()
        if not json_data:
            raise HTTPException(status_code=400, detail="No JSON data provided")

        data = json_data if isinstance(json_data, list) else [json_data]

        success_count = 0
        error_count = 0
        errors = []

        for item in data:
            try:
                _import_single_item(item)
                success_count += 1
            except Exception as e:
                error_count += 1
                errors.append({"Num_lot": item.get("Num_lot"), "error": str(e)})

        return {
            "message": "Import completed",
            "total_records": len(data),
            "success_count": success_count,
            "error_count": error_count,
            "errors": errors,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to import JSON data", "details": str(e)},
        )


@app.post("/api/import/zip")
async def import_zip(zipFile: UploadFile = File(...)):
    start_time = time.time()

    # Validate file type
    if not (
        zipFile.content_type in ("application/zip", "application/x-zip-compressed")
        or (zipFile.filename and zipFile.filename.lower().endswith(".zip"))
    ):
        raise HTTPException(status_code=400, detail="Only ZIP files are allowed")

    file_path = os.path.join(UPLOAD_DIR, f"{int(time.time())}-{zipFile.filename}")

    try:
        # Save uploaded file
        with open(file_path, "wb") as f:
            shutil.copyfileobj(zipFile.file, f)

        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        print(f"[ZIP IMPORT] Processing file: {file_path} ({file_size_mb:.2f} MB)")

        max_workers = min(os.cpu_count() or 4, 8)
        result = zip_service.process_zip_file(file_path, zipFile.filename, max_workers)

        all_data = result["all_data"]
        file_errors = result["errors"]
        total_json = result["total_json_files"]

        print(
            f"[ZIP IMPORT] Extraction complete. Inserting {len(all_data)} records into database..."
        )

        import_result = {"success": 0, "errors": []}
        if all_data:
            import_result = db_service.bulk_insert(all_data)

        total_time = round(time.time() - start_time, 2)
        print(
            f"[ZIP IMPORT] Completed in {total_time}s. Success: {import_result['success']}, Errors: {len(file_errors)}"
        )

        return {
            "success": True,
            "message": "ZIP import completed",
            "processing_time_seconds": total_time,
            "zip_info": {
                "total_json_files": total_json,
                "processed_files": total_json - len(file_errors),
                "error_files": len(file_errors),
                "file_errors": file_errors[:10] if file_errors else [],
            },
            "import_info": {
                "total_records": len(all_data),
                "success_count": import_result["success"],
                "error_count": len(import_result["errors"]),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ZIP IMPORT] FATAL ERROR: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": "Failed to import ZIP file",
                "details": str(e),
                "suggestion": "Check if the file is a valid ZIP archive and not corrupted.",
            },
        )
    finally:
        if os.path.exists(file_path):
            os.unlink(file_path)


# ---------- Files / Browse ----------

@app.get("/api/files")
def get_files():
    try:
        rows = db_service.fetch_all(
            'SELECT * FROM controle ORDER BY arborescence, "Num_lot"'
        )

        grouped = defaultdict(list)
        for row in rows:
            grouped[row.get("arborescence") or "root"].append(row)

        return {
            "path": "",
            "total_files": len(rows),
            "grouped_files": grouped,
            "files": rows,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch files")


@app.get("/api/files/{path:path}")
def get_files_by_path(path: str):
    try:
        rows = db_service.fetch_all(
            'SELECT * FROM controle WHERE arborescence LIKE %s ORDER BY arborescence, "Num_lot"',
            (f"{path}%",),
        )

        grouped = defaultdict(list)
        for row in rows:
            grouped[row.get("arborescence") or "root"].append(row)

        return {
            "path": path,
            "total_files": len(rows),
            "grouped_files": grouped,
            "files": rows,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch files")


@app.get("/api/browse")
def browse(path: str = Query("", alias="path"), level: int = Query(1)):
    try:
        rows = db_service.fetch_all(
            """
            SELECT DISTINCT
                arborescence,
                COUNT(*) as file_count,
                COUNT(DISTINCT login_controleur) as controleur_count,
                SUM(nb_actes_traites) as total_actes,
                SUM(nb_actes_rejets) as total_rejets,
                SUM(doublons) as total_doublons,
                SUM(baseline) as total_baseline
            FROM controle
            WHERE arborescence LIKE %s
            GROUP BY arborescence
            ORDER BY arborescence
            """,
            (f"{path}%" if path else "%",),
        )

        def build_tree(items):
            tree = {}
            for item in items:
                arbo = item.get("arborescence")
                stats = {
                    "file_count": item["file_count"],
                    "controleur_count": item["controleur_count"],
                    "total_actes": item["total_actes"],
                    "total_rejets": item["total_rejets"],
                    "total_doublons": item["total_doublons"],
                    "total_baseline": item["total_baseline"],
                }
                if not arbo:
                    tree["root"] = {**stats, "path": "", "children": {}}
                else:
                    parts = [p for p in arbo.split("/") if p]
                    current = tree
                    for idx, part in enumerate(parts):
                        part_path = "/".join(parts[: idx + 1])
                        if part not in current:
                            current[part] = {
                                "path": part_path,
                                "file_count": 0,
                                "controleur_count": 0,
                                "total_actes": 0,
                                "total_rejets": 0,
                                "total_doublons": 0,
                                "total_baseline": 0,
                                "children": {},
                            }
                        if arbo == part_path:
                            current[part].update(stats)
                        current = current[part]["children"]
            return tree

        return {
            "current_path": path,
            "total_arborescences": len(rows),
            "tree": build_tree(rows),
            "flat_list": rows,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to browse arborescence")


# ---------- Export ----------

def _get_report_data():
    """Fetch the three datasets needed for report generation."""
    general = db_service.fetch_one("""
        SELECT
            COUNT(*) as total_lots,
            SUM(nb_actes_traites) as total_actes_traites,
            SUM(nb_actes_rejets) as total_actes_rejets,
            MIN(date_debut) as date_premiere,
            MAX(date_fin) as date_derniere
        FROM controle
    """)

    controleur = db_service.fetch_all("""
        SELECT
            COALESCE(login_controleur, 'Non spécifié') as controleur,
            SUM(nb_actes_traites) as total_actes_controlees,
            SUM(nb_actes_rejets) as total_erreurs,
            ROUND(CAST(
                CASE
                    WHEN SUM(nb_actes_traites) > 0
                    THEN (SUM(nb_actes_rejets)::float / SUM(nb_actes_traites) * 100)
                    ELSE 0
                END AS numeric
            ), 3) as taux_erreur
        FROM controle
        GROUP BY login_controleur
        ORDER BY controleur
    """)

    daily = db_service.fetch_all("""
        SELECT
            COALESCE(login_controleur, 'Non spécifié') as controleur,
            DATE(date_debut) as date_lot,
            COUNT(DISTINCT "Num_lot") as total_lots,
            SUM(nb_actes_traites) as total_actes
        FROM controle
        WHERE date_debut IS NOT NULL
        GROUP BY login_controleur, DATE(date_debut)
        ORDER BY DATE(date_debut), login_controleur
    """)

    return general, controleur, daily


@app.get("/api/export/report")
def export_report(format: str = Query("csv")):
    try:
        general, controleur, daily = _get_report_data()

        if format == "csv":
            csv_content = export_service.generate_csv(general, controleur, daily)
            return Response(
                content=csv_content,
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": 'attachment; filename="rapport_gestion_lots.csv"'
                },
            )

        if format in ("excel", "xlsx"):
            excel_bytes = export_service.generate_excel(general, controleur, daily)
            return Response(
                content=excel_bytes,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": 'attachment; filename="rapport_gestion_lots.xlsx"'
                },
            )

        # JSON format
        report = export_service.generate_json_report(general, controleur, daily)
        return JSONResponse(
            content=report,
            headers={
                "Content-Disposition": 'attachment; filename="rapport_gestion_lots.json"'
            },
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to generate report", "details": str(e)},
        )
