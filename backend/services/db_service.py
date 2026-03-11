import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "dbname": os.getenv("DB_NAME", "gestion_lots"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "arh$2017"),
}


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def test_connection():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT NOW()")
        now = cur.fetchone()[0]
        cur.close()
        conn.close()
        print(f"Database connected successfully at: {now}")
        return True
    except Exception as e:
        print(f"Database connection error: {e}")
        return False


def fetch_all(query: str, params: tuple = None) -> list[dict]:
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(row) for row in rows]


def fetch_one(query: str, params: tuple = None) -> dict | None:
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(query, params)
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None


def execute(query: str, params: tuple = None) -> int:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(query, params)
    rowcount = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return rowcount


def bulk_insert(data: list[dict]) -> dict:
    """Insert records in chunks of 500 using a transaction."""
    if not data:
        return {"success": 0, "errors": []}

    CHUNK_SIZE = 500
    success_count = 0
    errors = []

    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute("BEGIN")

        for i in range(0, len(data), CHUNK_SIZE):
            chunk = data[i : i + CHUNK_SIZE]

            valid_chunk = []
            for item in chunk:
                try:
                    num_lot = int(item["Num_lot"])
                    valid_chunk.append(item)
                except (ValueError, TypeError):
                    errors.append(
                        {"record": item, "error": "Num_lot must be a valid integer"}
                    )

            if not valid_chunk:
                continue

            # Build multi-row VALUES clause
            placeholders = []
            flat_values = []
            for idx, item in enumerate(valid_chunk):
                offset = idx * 12
                placeholders.append(
                    f"(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                )
                flat_values.extend(
                    [
                        item["Num_lot"],
                        item.get("arborescence"),
                        item.get("login_controleur", "agent de controle"),
                        item.get("login_scan", "agent de scan"),
                        item.get("date_debut"),
                        item.get("date_fin"),
                        item.get("nb_actes_traites", 0),
                        item.get("nb_actes_rejets", 0),
                        item.get("tentative", 0),
                        item.get("doublons", 0),
                        item.get("baseline", 0),
                        item.get("source_file"),
                    ]
                )

            values_str = ",".join(placeholders)
            query = f"""
                INSERT INTO controle
                ("Num_lot", arborescence, login_controleur, login_scan, date_debut, date_fin,
                 nb_actes_traites, nb_actes_rejets, tentative, doublons, baseline, source_file)
                VALUES {values_str}
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
                    baseline = EXCLUDED.baseline,
                    source_file = EXCLUDED.source_file
            """
            cur.execute(query, flat_values)
            success_count += len(valid_chunk)

        cur.execute("COMMIT")
    except Exception as e:
        cur.execute("ROLLBACK")
        raise e
    finally:
        cur.close()
        conn.close()

    return {"success": success_count, "errors": errors}
