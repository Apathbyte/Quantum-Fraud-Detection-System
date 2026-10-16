
import csv
import hashlib
import json

from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, open_db


ROOT = Path(__file__).resolve().parents[2]

MANIFEST = (
    ROOT
    / "qguard_dashboard_bundle"
    / "dashboard_manifest.json"
)

UPLOAD_DIR = ROOT / "backend" / "storage" / "uploads"

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_CSV_COLUMNS = 256
MAX_CSV_RECORDS = 2_000_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with closing(open_db()) as conn:
        with conn:
            conn.execute(
                """
                UPDATE scans
                SET status='interrupted',
                    error='Server restarted during scan',
                    completed_at=?
                WHERE status IN ('queued', 'running')
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                ),
            )

    yield


app = FastAPI(
    title="Q-Guard API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# --------------------------------------------------
# Existing endpoints
# --------------------------------------------------

@app.get("/api/health")
def health():
    with closing(open_db()) as conn:
        conn.execute("SELECT 1").fetchone()

    return {
        "status": "ok",
        "database": "connected",
    }


@app.get("/api/overview")
def overview():
    if not MANIFEST.is_file():
        raise HTTPException(
            status_code=503,
            detail="Q-Guard dashboard manifest not found",
        )

    try:
        manifest = json.loads(
            MANIFEST.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to read dashboard manifest",
        ) from exc

    return {
        "source": "saved_snapshot",
        "account_count": manifest.get("account_count"),
        "alerted_accounts": manifest.get(
            "unique_alerted_accounts"
        ),
        "alert_counts": manifest.get("alert_counts"),
        "operational_models": manifest.get(
            "operational_models"
        ),
        "warning": manifest.get("warning"),
    }


# --------------------------------------------------
# CSV validation
# --------------------------------------------------

class CsvValidationError(ValueError):
    pass


def inspect_csv(path: Path) -> tuple[list[str], int]:
    """
    Validate CSV structure without loading the entire
    dataset into memory.
    """

    try:
        with path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as source:

            reader = csv.reader(
                source,
                strict=True,
            )

            raw_headers = next(reader, None)

            if raw_headers is None:
                raise CsvValidationError(
                    "The CSV is empty"
                )

            headers = [
                value.strip()
                for value in raw_headers
            ]

            if not (
                2 <= len(headers) <= MAX_CSV_COLUMNS
            ):
                raise CsvValidationError(
                    "CSV must have between 2 and "
                    f"{MAX_CSV_COLUMNS} columns"
                )

            if any(
                not value or "\x00" in value
                for value in headers
            ):
                raise CsvValidationError(
                    "CSV headers must be non-empty "
                    "and contain no null bytes"
                )

            if len({
                value.casefold()
                for value in headers
            }) != len(headers):
                raise CsvValidationError(
                    "CSV contains duplicate column names"
                )

            count = 0

            for row in reader:
                if not row:
                    continue

                if len(row) != len(headers):
                    raise CsvValidationError(
                        f"Row {reader.line_num} has "
                        f"{len(row)} fields; "
                        f"expected {len(headers)}"
                    )

                if any(
                    "\x00" in value
                    for value in row
                ):
                    raise CsvValidationError(
                        f"Row {reader.line_num} "
                        "contains null bytes"
                    )

                count += 1

                if count > MAX_CSV_RECORDS:
                    raise CsvValidationError(
                        "CSV exceeds "
                        f"{MAX_CSV_RECORDS:,} records"
                    )

            if count == 0:
                raise CsvValidationError(
                    "CSV has a header but no data rows"
                )

            return headers, count

    except (UnicodeError, csv.Error) as exc:
        raise CsvValidationError(
            f"Invalid UTF-8 CSV: {exc}"
        ) from exc


def classify_csv(headers: list[str]) -> str:
    """
    Identify likely input formats.

    This is a schema hint, not confirmation that
    the file is compatible with a trained model.
    """

    names = {
        header.casefold()
        for header in headers
    }

    if (
        "account_id" in names
        and {
            "fraud_v3_score",
            "aml_v2_score",
            "protection_v2_score",
        } <= names
    ):
        return "saved_predictions_candidate"

    has_time = bool(
        names & {
            "timestamp",
            "date",
            "datetime",
            "transaction_time",
            "event_time",
            "created_at",
            "event_date",
        }
    )

    has_event = bool(
        names & {
            "amount",
            "transaction_amount",
            "event_type",
            "transaction_type",
            "deposit_amount",
            "wager_amount",
        }
    )

    if (
        "account_id" in names
        and has_time
        and has_event
    ):
        return "timestamped_events_candidate"

    aggregate_features = {
        "tx_count",
        "deposit_total",
        "wager_total",
        "withdrawal_total",
        "distinct_devices",
        "session_count",
    }

    if (
        "account_id" in names
        and len(names & aggregate_features) >= 2
    ):
        return "account_features_candidate"

    return "requires_schema_mapping"


# --------------------------------------------------
# Dataset upload
# --------------------------------------------------

@app.post("/api/datasets", status_code=201)
def upload_dataset(
    file: UploadFile = File(...)
):
    # Never use a user-supplied filename
    # as the stored filesystem path.

    display_name = Path(
        (file.filename or "").replace("\\", "/")
    ).name

    if not display_name.lower().endswith(".csv"):
        raise HTTPException(
            status_code=415,
            detail="Only .csv files are supported",
        )

    dataset_id = uuid4().hex

    stored_file = (
        UPLOAD_DIR
        / f"{dataset_id}.csv"
    )

    sha256 = hashlib.sha256()
    written = 0

    try:
        # Stream to private storage.
        with stored_file.open("xb") as target:

            while chunk := file.file.read(
                1024 * 1024
            ):
                written += len(chunk)

                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "CSV exceeds the "
                            f"{MAX_UPLOAD_BYTES // (1024 * 1024)} "
                            "MiB upload limit"
                        ),
                    )

                target.write(chunk)
                sha256.update(chunk)

        # Check file structure.
        try:
            columns, record_count = inspect_csv(
                stored_file
            )
        except CsvValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail=str(exc),
            ) from exc

        data_kind = classify_csv(columns)

        now = datetime.now(
            timezone.utc
        ).isoformat()

        digest = sha256.hexdigest()

        # Persist the registered dataset.
        with closing(open_db()) as conn:
            with conn:
                conn.execute(
                    """
                    INSERT INTO datasets (
                        id,
                        filename,
                        sha256,
                        file_size,
                        status,
                        uploaded_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dataset_id,
                        display_name,
                        digest,
                        written,
                        "validated_csv",
                        now,
                    ),
                )

        return {
            "id": dataset_id,
            "filename": display_name,
            "file_size": written,
            "sha256": digest,
            "status": "validated_csv",
            "row_count": record_count,
            "columns": columns,
            "detected_format": data_kind,
            "ready_for_inference": False,
            "message": (
                "CSV structure validated. "
                "Model-specific feature compatibility "
                "is not verified yet."
            ),
        }

    except Exception:
        # Do not leave invalid or failed uploads
        # on the filesystem.
        stored_file.unlink(
            missing_ok=True
        )
        raise


# --------------------------------------------------
# Dataset metadata
# --------------------------------------------------

@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str):

    with closing(open_db()) as conn:
        row = conn.execute(
            """
            SELECT
                id,
                filename,
                sha256,
                file_size,
                status,
                uploaded_at
            FROM datasets
            WHERE id = ?
            """,
            (dataset_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found",
        )

    return dict(row)


from .inference import load_models, required_csv_columns
@app.get("/api/models")
def model_status():
    try:
        models = load_models()
        required = required_csv_columns()

    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return {
        "status": "ready",
        "inference_type": "prepared_account_features",
        "operational_models": {
            name: {
                "loaded": True,
                "feature_count": model.num_feature(),
            }
            for name, model in models.items()
        },
        "required_csv_columns": required,
        "supports_raw_events": False,
        "supports_temporal_scoring": False,
    }

from .scans import router as scans_router

app.include_router(scans_router)