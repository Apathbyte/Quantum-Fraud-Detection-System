
"""Q-Guard operational model inference."""

import json
from functools import lru_cache
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


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

# Same derived features as the original training pipeline.
RATIOS = {
    "wager_growth_ratio": ("wager_last30", "wager_first30"),
    "deposit_growth_ratio": ("deposit_last30", "deposit_first30"),
    "wager_share_recent": ("wager_last30", "wager_total"),
    "deposit_share_recent": ("deposit_last30", "deposit_total"),
    "withdraw_to_deposit": ("withdrawal_total", "deposit_total"),
    "wager_to_deposit": ("wager_total", "deposit_total"),
    "avg_wager_growth": ("avg_wager_last30", "avg_wager_first30"),
    "away_session_share": ("away_region_sessions", "session_count"),
    "deposit_per_session": ("deposit_count", "session_count"),
}

CATEGORICAL = ("home_region", "income_band")


class InputSchemaError(ValueError):
    pass


@lru_cache(maxsize=1)
def load_models() -> dict[str, lgb.Booster]:
    """Load and cache the three operational models."""

    models = {}

    for name, path in MODEL_FILES.items():
        if not path.is_file():
            raise FileNotFoundError(
                f"Missing {name} model: {path}"
            )

        models[name] = lgb.Booster(
            model_file=str(path)
        )

    schemas = [
        model.feature_name()
        for model in models.values()
    ]

    if not all(
        schema == schemas[0]
        for schema in schemas[1:]
    ):
        raise RuntimeError(
            "Operational model feature schemas do not match"
        )

    vocabularies = [
        model.pandas_categorical
        for model in models.values()
    ]

    if not all(
        vocabulary == vocabularies[0]
        for vocabulary in vocabularies[1:]
    ):
        raise RuntimeError(
            "Operational model categorical encodings do not match"
        )

    return models


def required_csv_columns() -> list[str]:
    models = load_models()

    features = next(
        iter(models.values())
    ).feature_name()

    return ["account_id"] + [
        name
        for name in features
        if name not in RATIOS
    ]


def predict_prepared_frame(
    frame: pd.DataFrame,
) -> pd.DataFrame:
    """
    Execute operational inference on prepared account features.

    Input: one row per account, with required source features.
    Output: three scores and corresponding alert indicators.

    Raw transaction preprocessing is not performed here.
    """

    models = load_models()

    expected = next(
        iter(models.values())
    ).feature_name()

    missing = [
        col
        for col in required_csv_columns()
        if col not in frame.columns
    ]

    if missing:
        raise InputSchemaError(
            "Missing required columns: "
            + ", ".join(missing[:12])
            + (" ..." if len(missing) > 12 else "")
        )

    if frame.empty:
        raise InputSchemaError(
            "Dataset contains no account rows"
        )

    ids = (
        frame["account_id"]
        .astype("string")
        .str.strip()
    )

    if (
        ids.isna().any()
        or (ids == "").any()
        or ids.duplicated().any()
    ):
        raise InputSchemaError(
            "Account identifiers must be non-empty and unique"
        )

    features = pd.DataFrame(index=frame.index)

    vocabularies = next(
        iter(models.values())
    ).pandas_categorical

    if not vocabularies or len(vocabularies) != 2:
        raise RuntimeError(
            "Expected two saved categorical vocabularies"
        )

    # Preserve the categories used during model training.
    for category, levels in zip(
        CATEGORICAL, vocabularies
    ):
        values = (
            frame[category]
            .astype("string")
            .str.strip()
        )

        unknown = (
            values.notna()
            & ~values.isin(levels)
        )

        if values.isna().any() or unknown.any():
            raise InputSchemaError(
                f"{category} contains missing or unknown values"
            )

        features[category] = pd.Categorical(
            values,
            categories=levels,
        )

    # Validate original numerical features.
    for column in expected:
        if column in CATEGORICAL or column in RATIOS:
            continue

        numeric = pd.to_numeric(
            frame[column],
            errors="coerce",
        ).astype("float32")

        if not np.isfinite(
            numeric.to_numpy()
        ).all():
            raise InputSchemaError(
                f"Invalid numerical values in {column}"
            )

        features[column] = numeric

    # Recalculate training-time ratio features.
    for name, (
        numerator,
        denominator,
    ) in RATIOS.items():

        features[name] = (
            features[numerator]
            / (features[denominator] + np.float32(1.0))
        ).astype("float32")

        if not np.isfinite(
            features[name].to_numpy()
        ).all():
            raise InputSchemaError(
                f"Invalid derived ratio: {name}"
            )

    # Match the exact saved model feature order.
    features = features[expected]

    manifest = json.loads(
        (BUNDLE / "dashboard_manifest.json")
        .read_text(encoding="utf-8")
    )

    thresholds = manifest["thresholds"]

    output = pd.DataFrame({
        "account_id": ids.to_numpy(),
    })

    for name, model in models.items():

        scores = np.asarray(
            model.predict(
                features,
                validate_features=True,
                num_threads=4,
            ),
            dtype="float64",
        )

        if (
            scores.ndim != 1
            or len(scores) != len(frame)
            or not np.isfinite(scores).all()
        ):
            raise RuntimeError(
                f"Invalid {name} model output"
            )

        output[f"{name}_score"] = scores
        output[f"{name}_alert"] = (
            scores >= float(thresholds[name])
        )

    return output

