import argparse
import requests
from datetime import datetime
from collections import defaultdict

API_URL = "http://165.1.123.182/api/tent/readings/history"
EXPECTED_PER_BUCKET = 20  # 10min bucket, 30s interval = 20 readings
BUCKET_STEP = 600         # 10 minutes in seconds

WINDOWS = {
    "30m": 30 * 60,
    "1h":  1  * 3600,
    "6h":  6  * 3600,
    "24h": 24 * 3600,
    "7d":  7  * 86400,
    "all": None,
}

parser = argparse.ArgumentParser(description="Sensor uptime report")
parser.add_argument(
    "window",
    nargs="?",
    default="all",
    choices=WINDOWS.keys(),
    help="Time window to report on (default: all)",
)
args = parser.parse_args()

res = requests.get(API_URL)
data = res.json()

if not data:
    print("No data returned from API.")
    exit(1)

data.sort(key=lambda x: x["bucket"])

# Apply time window filter
now_ts = int(datetime.now().timestamp())
window_seconds = WINDOWS[args.window]

if window_seconds is not None:
    cutoff = now_ts - window_seconds
    data = [d for d in data if d["bucket"] >= cutoff]

if not data:
    print(f"No data found in the last {args.window} window.")
    exit(0)

first_ts = data[0]["bucket"]
last_ts  = data[-1]["bucket"]

# If a window is set, extend the expected range forward to now
# so that a fully-offline tail is also counted
if window_seconds is not None:
    range_end = now_ts
else:
    range_end = last_ts

print(f"Window : {args.window}")
print(f"Range  : {datetime.fromtimestamp(first_ts if window_seconds is None else now_ts - window_seconds).strftime('%Y-%m-%d %H:%M')} -> {datetime.fromtimestamp(range_end).strftime('%Y-%m-%d %H:%M')}")
print()

# Build lookup of received readings keyed by bucket timestamp
received = {entry["bucket"]: entry["count"] for entry in data}

# Walk every expected 10-min slot in the full range
range_start = first_ts if window_seconds is None else (now_ts - window_seconds)
# Floor range_start to the nearest bucket boundary
range_start = (range_start // BUCKET_STEP) * BUCKET_STEP

hours = defaultdict(lambda: {"count": 0, "expected": 0})

ts = range_start
while ts <= range_end:
    hour_ts = (ts // 3600) * 3600
    hours[hour_ts]["expected"] += EXPECTED_PER_BUCKET
    hours[hour_ts]["count"]    += received.get(ts, 0)
    ts += BUCKET_STEP

# Print sorted by time
print(f"{'Hour':<22} {'Readings':>10} {'Expected':>10} {'Uptime':>10}")
print("-" * 55)

for ts in sorted(hours.keys()):
    h = hours[ts]
    uptime = min(100, (h["count"] / h["expected"]) * 100) if h["expected"] else 0
    time_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    marker = "  <<< OFFLINE" if uptime < 10 else ("  < low" if uptime < 90 else "")
    print(f"{time_str:<22} {h['count']:>10} {h['expected']:>10} {uptime:>9.1f}%{marker}")

# Total
total_count    = sum(h["count"]    for h in hours.values())
total_expected = sum(h["expected"] for h in hours.values())
total_uptime   = min(100, (total_count / total_expected) * 100) if total_expected else 0
print("-" * 55)
print(f"{'TOTAL':<22} {total_count:>10} {total_expected:>10} {total_uptime:>9.1f}%")
