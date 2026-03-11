import json
import os
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime


def parse_qualite_acte(qualite_acte) -> dict:
    """Extract doublons and baseline counts from qualite_acte data."""
    if isinstance(qualite_acte, str):
        try:
            qualite_acte = json.loads(qualite_acte)
        except (json.JSONDecodeError, TypeError):
            return {"doublons": 0, "baseline": 0}

    doublons = 0
    baseline = 0

    if qualite_acte and isinstance(qualite_acte, dict):
        if isinstance(qualite_acte.get("doublon"), list):
            doublons = sum(
                len(item.get("images", [])) for item in qualite_acte["doublon"]
            )
        if isinstance(qualite_acte.get("baseline"), list):
            baseline = sum(
                len(item.get("images", [])) for item in qualite_acte["baseline"]
            )

    return {"doublons": doublons, "baseline": baseline}


def _parse_int(value, default=0) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def process_single_json(json_content: str, entry_name: str, source_file: str) -> dict:
    """Parse a single JSON file's content and return structured data."""
    try:
        json_data = json.loads(json_content)
        data_array = json_data if isinstance(json_data, list) else [json_data]
        results = []

        for item in data_array:
            # Extract arborescence from file path
            path_parts = entry_name.split("/")
            path_parts.pop()  # Remove filename
            arborescence = "/".join(path_parts)

            # Parse quality data
            doublons = 0
            baseline = 0
            if item.get("qualite_acte"):
                quality = parse_qualite_acte(item["qualite_acte"])
                doublons = quality["doublons"]
                baseline = quality["baseline"]

            # Extract Num_lot with fallback to filename
            num_lot = item.get("Num_lot") or item.get("num_lot") or item.get("numero_lot")
            if not num_lot or str(num_lot) in ("null", "undefined", "None"):
                filename = os.path.splitext(os.path.basename(entry_name))[0]
                num_lot = _parse_int(filename, None)

            num_lot_int = _parse_int(num_lot, None)
            if num_lot_int is None:
                continue

            results.append(
                {
                    "Num_lot": num_lot_int,
                    "arborescence": item.get("arborescence") or arborescence or None,
                    "login_controleur": item.get("login_controleur")
                    or item.get("controleur")
                    or "agent de controle",
                    "login_scan": item.get("login_scan")
                    or item.get("agent_scan")
                    or "agent de scan",
                    "date_debut": _parse_datetime(item.get("date_debut")),
                    "date_fin": _parse_datetime(item.get("date_fin")),
                    "nb_actes_traites": _parse_int(item.get("nb_actes_traites")),
                    "nb_actes_rejets": _parse_int(item.get("nb_actes_rejets")),
                    "tentative": _parse_int(item.get("tentative")),
                    "doublons": doublons,
                    "baseline": baseline,
                    "source_file": source_file,
                }
            )

        return {"success": True, "data": results, "entry_name": entry_name}
    except Exception as e:
        return {"success": False, "error": str(e), "entry_name": entry_name}


def process_zip_file(zip_path: str, source_file: str, max_workers: int = 4) -> dict:
    """Extract and process JSON files from a ZIP archive by streaming reads into a thread pool."""
    all_data = []
    errors = []

    with zipfile.ZipFile(zip_path, "r") as zf:
        json_files = [
            name
            for name in zf.namelist()
            if name.lower().endswith(".json") and not name.startswith("__MACOSX")
        ]

        total = len(json_files)
        print(f"[ZIP IMPORT] Found {total} JSON files to process")

        # Stream: read each file and submit for parsing immediately
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for name in json_files:
                try:
                    content = zf.read(name).decode("utf-8")
                    future = executor.submit(
                        process_single_json, content, name, source_file
                    )
                    futures[future] = name
                except Exception as e:
                    errors.append({"file": name, "error": str(e)})

            processed = 0
            for future in as_completed(futures):
                processed += 1
                result = future.result()

                if result["success"]:
                    all_data.extend(result["data"])
                else:
                    errors.append(
                        {"file": result["entry_name"], "error": result["error"]}
                    )

                if processed % 50 == 0 or processed == total:
                    pct = round(processed / total * 100)
                    print(
                        f"[ZIP IMPORT] Processed {processed}/{total} files ({pct}%)"
                    )

    return {
        "all_data": all_data,
        "errors": errors,
        "total_json_files": len(json_files),
    }
