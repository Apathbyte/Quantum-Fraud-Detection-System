
"""Generate artificial feature rows for API smoke testing."""

from pathlib import Path

import pandas as pd

from backend.app.inference import required_csv_columns


columns = required_csv_columns()

records = []

for index in range(3):
    record = {
        column: 0.0
        for column in columns
    }

    record.update(
        {
            "account_id": f"TEST-{index + 1:04d}",
            "home_region": "GTA",
            "income_band": "30k_60k",
            "account_age_days": 90 + index,
            "tx_count": 30 + index,
            "session_count": 6,
        }
    )

    records.append(record)

output = Path(
    "backend/examples/prepared_smoke_test.csv"
)

pd.DataFrame(
    records,
    columns=columns,
).to_csv(output, index=False)

print("Created:", output)
print("Rows:", len(records))
print("Columns:", len(columns))
print("Synthetic test data only.")
