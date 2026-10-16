
"""
Q-Guard operational inference.

Models:
    - Fraud V3 (LightGBM)
    - AML Context V2 (LightGBM)
    - Protection Context V2 (LightGBM)

Input:
    Prepared account-feature CSV (63 columns).

Missing numerical values:
    - Preserved as NaN for the trained LightGBM models.
    - Replaced with zero only during derived ratio calculation,
      matching the original training feature engineering.

Unsupported non-numeric text, unknown categorical values,
and infinite numeric values are rejected.
"""

import json

from functools import lru_cache
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


# ============================================================
# PATHS
# ============================================================

ROOT = Path(__file__).resolve().parents[2]

BUNDLE = ROOT / "qguard_dashboard_bundle"

MODEL_FILES = {
    "fraud": (
        BUNDLE / "models/fraud_v3/fraud_weight_4.txt"
    ),
    "aml": (
        BUNDLE / "models/context_v2/aml_lightgbm.txt"
    ),
    "protection": (
        BUNDLE / "models/context_v2/protection_lightgbm.txt"
    ),
}


# ============================================================
# FEATURE ENGINEERING
# ============================================================

RATIOS = {
    "wager_growth_ratio": (
        "wager_last30",
        "wager_first30",
    ),
    "deposit_growth_ratio": (
        "deposit_last30",
        "deposit_first30",
    ),
    "wager_share_recent": (
        "wager_last30",
        "wager_total",
    ),
    "deposit_share_recent": (
        "deposit_last30",
        "deposit_total",
    ),
    "withdraw_to_deposit": (
        "withdrawal_total",
        "deposit_total",
    ),
    "wager_to_deposit": (
        "wager_total",
        "deposit_total",
    ),
    "avg_wager_growth": (
        "avg_wager_last30",
        "avg_wager_first30",
    ),
    "away_session_share": (
        "away_region_sessions",
        "session_count",
    ),
    "deposit_per_session": (
        "deposit_count",
        "session_count",
    ),
}

CATEGORICAL = (
    "home_region",
    "income_band",
)


class InputSchemaError(ValueError):
    """Incompatible model input data."""


# ============================================================
# LOAD SAVED MODELS
# ============================================================

@lru_cache(maxsize=1)
def load_models() -> dict[str, lgb.Booster]:
    models = {}

    for name, path in MODEL_FILES.items():

        if not path.is_file():
            raise FileNotFoundError(
                f"Missing {name} model: {path}"
            )

        models[name] = lgb.Booster(
            model_file=str(path)
        )

    reference = models["fraud"]

    # Validate identical feature schemas.
    for name, model in models.items():

        if (
            model.feature_name()
            != reference.feature_name()
        ):
            raise RuntimeError(
                f"Model feature schema mismatch: {name}"
            )

        if (
            model.pandas_categorical
            != reference.pandas_categorical
        ):
            raise RuntimeError(
                f"Categorical vocabulary mismatch: {name}"
            )

    return models


# ============================================================
# REQUIRED INPUT COLUMNS
# ============================================================

def required_csv_columns() -> list[str]:

    features = (
        load_models()["fraud"].feature_name()
    )

    return ["account_id"] + [
        name
        for name in features
        if name not in RATIOS
    ]


# ============================================================
# OPERATIONAL INFERENCE
# ============================================================

def predict_prepared_frame(
    frame: pd.DataFrame,
) -> pd.DataFrame:

    models = load_models()

    reference = models["fraud"]

    expected = reference.feature_name()

    # --------------------------------------------------------
    # Validate required columns
    # --------------------------------------------------------

    missing_columns = [
        name
        for name in required_csv_columns()
        if name not in frame.columns
    ]

    if missing_columns:
        raise InputSchemaError(
            "Missing required columns: "
            + ", ".join(missing_columns[:12])
            + (
                " ..."
                if len(missing_columns) > 12
                else ""
            )
        )

    if frame.empty:
        raise InputSchemaError(
            "Dataset contains no account rows"
        )

    # --------------------------------------------------------
    # Validate account IDs
    # --------------------------------------------------------

    identifiers = (
        frame["account_id"]
        .astype("string")
        .str.strip()
    )

    if (
        identifiers.isna().any()
        or identifiers.eq("").any()
        or identifiers.duplicated().any()
    ):
        raise InputSchemaError(
            "Account identifiers must be "
            "non-empty and unique"
        )

    # --------------------------------------------------------
    # Validate saved categorical vocabularies
    # --------------------------------------------------------

    categorical_levels = (
        reference.pandas_categorical
    )

    if (
        not categorical_levels
        or len(categorical_levels) != len(CATEGORICAL)
    ):
        raise RuntimeError(
            "Saved categorical encodings "
            "are missing or incomplete"
        )

    features = pd.DataFrame(
        index=frame.index
    )

    # --------------------------------------------------------
    # Categorical features
    # --------------------------------------------------------

    for name, levels in zip(
        CATEGORICAL,
        categorical_levels,
    ):

        values = (
            frame[name]
            .astype("string")
            .str.strip()
        )

        unknown = (
            values.notna()
            & ~values.isin(levels)
        )

        if (
            values.isna().any()
            or unknown.any()
        ):
            raise InputSchemaError(
                f"{name} contains missing "
                "or unknown categories"
            )

        features[name] = pd.Categorical(
            values,
            categories=levels,
        )

    # --------------------------------------------------------
    # Numerical features
    # --------------------------------------------------------

    for name in expected:

        if (
            name in CATEGORICAL
            or name in RATIOS
        ):
            continue

        raw = frame[name]

        values = pd.to_numeric(
            raw,
            errors="coerce",
        )

        # Reject unexpected text rather than silently
        # converting it into missing data.
        invalid = (
            raw.notna()
            & values.isna()
        )

        if invalid.any():

            affected = (
                identifiers.loc[invalid]
                .head(3)
                .tolist()
            )

            raise InputSchemaError(
                f"Non-numeric text in {name} "
                f"(accounts: {', '.join(affected)})"
            )

        numeric = values.astype(
            "float32"
        )

        # NaN is allowed because LightGBM supports
        # missing numerical values natively.
        #
        # Infinity is NOT allowed.
        if np.isinf(
            numeric.to_numpy()
        ).any():
            raise InputSchemaError(
                f"Infinite or overflowing values in {name}"
            )

        features[name] = numeric

    # --------------------------------------------------------
    # Nine derived ratio features
    # --------------------------------------------------------

    for name, (
        numerator,
        denominator,
    ) in RATIOS.items():

        # Match the original training pipeline:
        # fill missing numerator/denominator values
        # with zero FOR THIS CALCULATION ONLY.
        #
        # Original numerical columns retain NaN.

        top = (
            features[numerator]
            .fillna(0)
            .to_numpy(dtype=np.float32)
        )

        bottom = (
            features[denominator]
            .fillna(0)
            .to_numpy(dtype=np.float32)
        )

        ratio = (
            top
            / (bottom + np.float32(1.0))
        )

        if not np.isfinite(
            ratio
        ).all():
            raise InputSchemaError(
                f"Invalid derived ratio: {name}"
            )

        features[name] = ratio.astype(
            "float32"
        )

    # Restore exact trained feature order.
    features = features[expected]

    # --------------------------------------------------------
    # Load alert thresholds
    # --------------------------------------------------------

    manifest_path = (
        BUNDLE / "dashboard_manifest.json"
    )

    manifest = json.loads(
        manifest_path.read_text(
            encoding="utf-8"
        )
    )

    thresholds = manifest["thresholds"]

    # --------------------------------------------------------
    # Run real LightGBM inference
    # --------------------------------------------------------

    output = pd.DataFrame({
        "account_id": identifiers.to_numpy(),
    })

    for name, model in models.items():

        scores = np.asarray(
            model.predict(
                features,
                validate_features=True,
                num_threads=4,
            ),
            dtype=np.float64,
        )

        if (
            scores.ndim != 1
            or scores.size != len(frame)
            or not np.isfinite(scores).all()
        ):
            raise RuntimeError(
                f"Invalid {name} model output"
            )

        output[f"{name}_score"] = scores

        output[f"{name}_alert"] = (
            scores >= float(
                thresholds[name]
            )
        )

    return output
