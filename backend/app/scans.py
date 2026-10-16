
"""Operational Q-Guard inference jobs."""

import csv
import hashlib
import json

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pandas as pd

from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Path as ApiPath,
    Query,
)
from pydantic import BaseModel, Field

from .db import open_db
from .inference import (
    predict_prepared_frame,
    required_csv_columns,
)


router = APIRouter(
    prefix="/api",
    tags=["Operational Inference"],
)

ROOT = Path(__file__).resolve().parents[2]

UPLOADS = ROOT / "backend/storage/uploads"
RESULTS = ROOT / "backend/storage/results"

CHUNK_ROWS = 2000


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScanRequest(BaseModel):
    dataset_id: str = Field(
        pattern=r"^[0-9a-f]{32}$"
    )


def execute_scan(
    scan_id: str,
    dataset_id: str,
    expected_hash: str,
) -> None:
    """
    Run real LightGBM inference.

    Input: prepared account-feature CSV.
    Output: persisted per-account model predictions.
    """

    source = UPLOADS / f"{dataset_id}.csv"

    output = RESULTS / f"{scan_id}.csv"
    temporary = RESULTS / f"{scan_id}.csv.tmp"
    summary_path = RESULTS / f"{scan_id}.json"

    RESULTS.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        with closing(open_db()) as conn:
            with conn:
                conn.execute(
                    "UPDATE scans SET status=? WHERE id=?",
                    ("running", scan_id),
                )

        # Verify file integrity before scoring.
        sha = hashlib.sha256()

        with source.open("rb") as file:
            for block in iter(
                lambda: file.read(1024 * 1024),
                b"",
            ):
                sha.update(block)

        if sha.hexdigest() != expected_hash:
            raise ValueError(
                "Stored CSV does not match its registered SHA-256"
            )

        total = 0
        alerted = 0

        by_category = {
            "fraud": 0,
            "aml": 0,
            "protection": 0,
        }

        known_ids: set[str] = set()
        first = True

        # Process in bounded batches rather than
        # loading the entire CSV into memory.
        for frame in pd.read_csv(
            source,
            chunksize=CHUNK_ROWS,
            encoding="utf-8-sig",
            dtype={"account_id": "string"},
            on_bad_lines="error",
        ):
            predictions = predict_prepared_frame(
                frame
            )

            identifiers = (
                predictions["account_id"]
                .tolist()
            )

            if any(
                identifier in known_ids
                for identifier in identifiers
            ):
                raise ValueError(
                    "Duplicate account identifiers across batches"
                )

            known_ids.update(identifiers)

            flags = predictions[
                [
                    "fraud_alert",
                    "aml_alert",
                    "protection_alert",
                ]
            ]

            predictions["alert_count"] = (
                flags.sum(axis=1).astype("int8")
            )

            # Transparent preliminary review heuristic.
            # This is NOT a calibrated risk probability.
            predictions["priority_score"] = (
                100 * predictions["alert_count"]
                + 100 * predictions[
                    [
                        "fraud_score",
                        "aml_score",
                        "protection_score",
                    ]
                ].max(axis=1)
            )

            alerted += int(
                (
                    predictions["alert_count"] > 0
                ).sum()
            )

            for name in by_category:
                by_category[name] += int(
                    predictions[f"{name}_alert"].sum()
                )

            total += len(predictions)

            predictions.to_csv(
                temporary,
                mode="w" if first else "a",
                header=first,
                index=False,
            )

            first = False

        if total == 0:
            raise ValueError(
                "Dataset contains no accounts to score"
            )

        temporary.replace(output)

        summary = {
            "scan_id": scan_id,
            "dataset_id": dataset_id,
            "status": "completed",
            "source": "fresh_operational_inference",
            "account_count": total,
            "alerted_accounts": alerted,
            "alert_counts": by_category,
            "priority_policy": (
                "100 * alert category count "
                "+ 100 * maximum model score"
            ),
            "warning": (
                "Scores are not calibrated real-world "
                "risk probabilities. This scan does "
                "not include a historical score series."
            ),
        }

        summary_path.write_text(
            json.dumps(summary, indent=2),
            encoding="utf-8",
        )

        with closing(open_db()) as conn:
            with conn:
                conn.execute(
                    """
                    UPDATE scans
                    SET status=?,
                        completed_at=?,
                        error=NULL
                    WHERE id=?
                    """,
                    ("completed", utcnow(), scan_id),
                )

    except Exception as exc:
        temporary.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        summary_path.unlink(missing_ok=True)

        with closing(open_db()) as conn:
            with conn:
                conn.execute(
                    """
                    UPDATE scans
                    SET status=?,
                        completed_at=?,
                        error=?
                    WHERE id=?
                    """,
                    (
                        "failed",
                        utcnow(),
                        str(exc)[:1000],
                        scan_id,
                    ),
                )


@router.post("/scans", status_code=202)
def start_scan(
    payload: ScanRequest,
    background: BackgroundTasks,
):
    with closing(open_db()) as conn:
        row = conn.execute(
            """
            SELECT id, sha256, status
            FROM datasets
            WHERE id=?
            """,
            (payload.dataset_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found",
        )

    if row["status"] != "validated_csv":
        raise HTTPException(
            status_code=409,
            detail="Dataset is not validated",
        )

    source = (
        UPLOADS
        / f"{payload.dataset_id}.csv"
    )

    if not source.is_file():
        raise HTTPException(
            status_code=409,
            detail="Uploaded CSV is unavailable",
        )

    # Check model schema before creating a job.
    with source.open(
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as file:
        header = next(
            csv.reader(file),
            [],
        )

    required = set(required_csv_columns())
    missing = sorted(required - set(header))

    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    "CSV is missing prepared model features"
                ),
                "missing_count": len(missing),
                "first_missing": missing[:12],
            },
        )

    scan_id = uuid4().hex

    with closing(open_db()) as conn:
        with conn:
            conn.execute(
                """
                INSERT INTO scans (
                    id,
                    dataset_id,
                    status,
                    created_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (
                    scan_id,
                    payload.dataset_id,
                    "queued",
                    utcnow(),
                ),
            )

    background.add_task(
        execute_scan,
        scan_id,
        payload.dataset_id,
        row["sha256"],
    )

    return {
        "scan_id": scan_id,
        "status": "queued",
        "status_url": f"/api/scans/{scan_id}",
    }


@router.get("/scans/{scan_id}")
def scan_status(
    scan_id: str = ApiPath(
        pattern=r"^[0-9a-f]{32}$"
    ),
):
    with closing(open_db()) as conn:
        row = conn.execute(
            "SELECT * FROM scans WHERE id=?",
            (scan_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Scan not found",
        )

    result = dict(row)

    summary_file = RESULTS / f"{scan_id}.json"

    if (
        row["status"] == "completed"
        and summary_file.is_file()
    ):
        result["summary"] = json.loads(
            summary_file.read_text(
                encoding="utf-8"
            )
        )

    return result


@router.get("/scans/{scan_id}/results")
def scan_results(
    scan_id: str = ApiPath(
        pattern=r"^[0-9a-f]{32}$"
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
):
    scan = scan_status(scan_id)

    if scan["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail="Scan is not completed",
        )

    csv_path = RESULTS / f"{scan_id}.csv"

    if not csv_path.is_file():
        raise HTTPException(
            status_code=503,
            detail="Scan results unavailable",
        )

    preview = pd.read_csv(
        csv_path,
        nrows=limit,
        dtype={"account_id": "string"},
    )

    return {
        "scan_id": scan_id,
        "rows": preview.to_dict(
            orient="records"
        ),
    }
