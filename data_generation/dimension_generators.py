from __future__ import annotations

import random
from typing import Any

SUBREGION_BANDS: dict[str, dict[str, Any]] = {
    "UpperTexasCoast": {
        "label": "Upper Texas Coast",
        "facilities": [
            ("Houston Ship Channel", 29.7350, -95.0800),
            ("Beaumont", 30.0802, -94.1266),
            ("Freeport", 28.9541, -95.3597),
        ],
        "customers": [
            ("Dallas-Fort Worth", 32.7767, -96.7970),
            ("San Antonio", 29.4241, -98.4936),
            ("Austin Industrial Park", 30.2672, -97.7431),
            ("East Texas Fuels Rack", 32.5007, -94.7405),
            ("Shreveport Bulk Terminal", 32.5252, -93.7502),
        ],
    },
    "SouthTexasCoast": {
        "label": "South Texas Coast",
        "facilities": [
            ("Corpus Christi", 27.8006, -97.3964),
            ("Ingleside", 27.8778, -97.2117),
            ("Brownsville", 25.9017, -97.4975),
        ],
        "customers": [
            ("Laredo Industrial Park", 27.5036, -99.5076),
            ("McAllen Energy Terminal", 26.2034, -98.2300),
            ("Monterrey Industrial Corridor", 25.6866, -100.3161),
            ("San Antonio Refining Complex", 29.4241, -98.4936),
            ("Victoria Chemicals Hub", 28.8053, -97.0036),
        ],
    },
    "PermianBasin": {
        "label": "Permian Basin",
        "facilities": [
            ("Midland", 31.9973, -102.0779),
            ("Odessa", 31.8457, -102.3676),
            ("Pecos", 31.4229, -103.4932),
        ],
        "customers": [
            ("Cushing Storage Hub", 35.9851, -96.7664),
            ("Fort Worth Fuels Rack", 32.7555, -97.3308),
            ("El Paso Refining", 31.7619, -106.4850),
            ("San Angelo Industrial Gas", 31.4638, -100.4370),
            ("Waco Distribution Terminal", 31.5493, -97.1467),
        ],
    },
    "LouisianaIndustrial": {
        "label": "Louisiana Industrial Corridor",
        "facilities": [
            ("Lake Charles", 30.2266, -93.2174),
            ("Baton Rouge", 30.4515, -91.1871),
            ("Cameron", 29.7977, -93.3252),
        ],
        "customers": [
            ("New Orleans Marine Fuels", 29.9511, -90.0715),
            ("Jackson Refining Market", 32.2988, -90.1848),
            ("Mobile Bay Chemicals", 30.6954, -88.0399),
            ("Memphis Products Terminal", 35.1495, -90.0490),
            ("Pascagoula LNG Corridor", 30.3658, -88.5561),
        ],
    },
}

INDUSTRIES = [
    "Refining",
    "Petrochemicals",
    "LNG Export",
    "Midstream",
    "Refined Products",
    "Offshore Production",
    "Marine Fuels",
    "Power Generation",
]
TIERS = ["Strategic", "Enterprise", "Merchant"]
PRODUCTS = ["CRD", "NGL", "LNG"]
CUSTOMERS_BY_INDUSTRY: dict[str, list[str]] = {
    "Refining": [
        "GulfOps Refining Alpha",
        "GulfOps Refining Beta",
        "GulfOps Refining Gamma",
    ],
    "Petrochemicals": [
        "GulfOps Petrochem Alpha",
        "GulfOps Petrochem Bravo",
        "GulfOps Petrochem Charlie",
    ],
    "LNG Export": [
        "GulfOps LNG Alpha",
        "GulfOps LNG Bravo",
        "GulfOps LNG Charlie",
    ],
    "Midstream": [
        "GulfOps Midstream Alpha",
        "GulfOps Pipeline Bravo",
        "GulfOps Storage Charlie",
    ],
    "Refined Products": [
        "GulfOps Fuels Alpha",
        "GulfOps Products Bravo",
        "GulfOps Terminals Charlie",
    ],
    "Offshore Production": [
        "GulfOps Offshore Alpha",
        "GulfOps Shelf Bravo",
        "GulfOps Production Charlie",
    ],
    "Marine Fuels": [
        "GulfOps Bunkering Alpha",
        "GulfOps Marine Fuels Bravo",
        "GulfOps Harbor Supply Charlie",
    ],
    "Power Generation": [
        "GulfOps Power Alpha",
        "GulfOps Grid Bravo",
        "GulfOps Peaker Charlie",
    ],
}


def _jittered_point(rng: random.Random, lat: float, lng: float, lat_spread: float, lng_spread: float) -> tuple[float, float]:
    return round(lat + rng.uniform(-lat_spread, lat_spread), 4), round(lng + rng.uniform(-lng_spread, lng_spread), 4)


def _distance_score(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Fast planar score is sufficient for relative ordering.
    return (lat1 - lat2) ** 2 + (lng1 - lng2) ** 2


def generate_dim_assets_rows(cfg) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 11)
    rows: list[dict[str, Any]] = []
    band_keys = list(SUBREGION_BANDS.keys())
    band_counts: dict[str, int] = {k: 0 for k in band_keys}
    for idx in range(1, cfg.num_assets + 1):
        band_key = band_keys[(idx - 1) % len(band_keys)]
        band = SUBREGION_BANDS[band_key]
        local_idx = band_counts[band_key]
        band_counts[band_key] += 1
        anchor_name, base_lat, base_lng = band["facilities"][local_idx % len(band["facilities"])]
        lat, lng = _jittered_point(rng, base_lat, base_lng, lat_spread=0.42, lng_spread=0.55)
        max_capacity = rng.randint(500, 2000)
        min_run_rate = min(rng.randint(100, 400), max_capacity - 30)
        is_primary_hub = (idx - 1) % len(band_keys) == 0
        asset_commission_year = rng.randint(1998, 2024)
        depreciation_years = rng.choice([15, 18, 20])
        overbuild_ratio = round(rng.uniform(1.08, 1.38), 3)
        capex_usd = round(max_capacity * rng.uniform(25_000.0, 90_000.0), 2)
        rows.append(
            {
                "asset_id": f"HUB-{idx:03d}",
                "asset_name": f"{anchor_name} Terminal {idx:03d}",
                "region": band["label"],
                "subregion": band_key,
                "is_primary_hub": is_primary_hub,
                "lat": lat,
                "lng": lng,
                "max_capacity_tpd": max_capacity,
                "min_run_rate_tpd": min_run_rate,
                "base_specific_energy_kwh": rng.randint(200, 300),
                "asset_commission_year": asset_commission_year,
                "depreciation_years": depreciation_years,
                "overbuild_ratio": overbuild_ratio,
                "capex_usd": capex_usd,
            }
        )
    return rows


def generate_dim_customers_rows(cfg) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 23)
    rows: list[dict[str, Any]] = []
    band_keys = list(SUBREGION_BANDS.keys())
    band_counts: dict[str, int] = {k: 0 for k in band_keys}
    industry_counts: dict[str, int] = {k: 0 for k in INDUSTRIES}
    for idx in range(1, cfg.num_customers + 1):
        band_key = band_keys[(idx - 1) % len(band_keys)]
        band = SUBREGION_BANDS[band_key]
        industry = INDUSTRIES[(idx - 1) % len(INDUSTRIES)]
        customer_pool = CUSTOMERS_BY_INDUSTRY.get(industry, ["Industrial Customer"])
        industry_local_idx = industry_counts[industry]
        industry_counts[industry] += 1
        account_name = customer_pool[industry_local_idx % len(customer_pool)]
        tier_roll = rng.random()
        tier = "Strategic" if tier_roll < 0.1 else ("Enterprise" if tier_roll < 0.4 else "Merchant")
        local_idx = band_counts[band_key]
        band_counts[band_key] += 1
        anchor_name, base_lat, base_lng = band["customers"][local_idx % len(band["customers"])]
        # Keep demand sites in distinct downstream markets so map lanes have visible arc spans.
        lat, lng = _jittered_point(rng, base_lat, base_lng, lat_spread=0.20, lng_spread=0.28)
        rows.append(
            {
                "customer_id": f"CUST-{idx:04d}",
                "customer_name": f"{account_name} - {anchor_name} Site",
                "contact_email": f"ops+{idx:04d}@example.com",
                "industry": industry,
                "tier": tier,
                "region": band["label"],
                "subregion": band_key,
                "lat": lat,
                "lng": lng,
            }
        )
    return rows


TECHNICIAN_NAMES = [
    "Marcus Rivera", "Alyssa Nguyen", "Caleb Broussard", "Tanya Williams", "Diego Alvarez",
    "Priya Shah", "Evan McCall", "Jasmine Carter", "Owen Landry", "Maya Thompson",
    "Luis Hernandez", "Riley Brooks", "Nora Bennett", "Andre Collins", "Sofia Ramirez",
    "Grant Wilson", "Elena Torres", "Darius Johnson", "Leah Martin", "Cole Parker",
    "Naomi Clark", "Victor Reed", "Harper Davis", "Eli Morgan", "Avery Campbell",
    "Mason Walker", "Iris Flores", "Jalen Price", "Amelia Foster", "Noah Jenkins",
]

TECHNICIAN_ROLES = [
    "Rotating Equipment Specialist",
    "Instrument Technician",
    "Reliability Engineer",
    "Vibration Analyst",
    "Pipeline Technician",
    "Electrical Technician",
]

PART_TYPES = [
    ("PUMP-BRG", "Transfer Pump Bearing Assembly", "Rotating Equipment"),
    ("PUMP-SEAL", "Transfer Pump Mechanical Seal", "Rotating Equipment"),
    ("INST-PRS", "Pressure Transmitter", "Instrumentation"),
    ("INST-TMP", "Thermocouple Assembly", "Instrumentation"),
    ("ELEC-VFD", "Variable Frequency Drive Module", "Electrical"),
    ("ELEC-CTR", "Motor Control Contactor", "Electrical"),
    ("PIPING-GK", "Hydrocarbon Service Gasket Set", "Piping"),
    ("PIPING-VLV", "Pipeline Block Valve", "Piping"),
]

VENDOR_LOCATIONS = [
    ("GulfOps Emergency Logistics", 29.7350, -95.0800),
    ("GulfOps Midstream Supply", 30.2266, -93.2174),
    ("GulfOps Tanker Services", 29.8849, -93.9399),
    ("GulfOps Spot Supply", 30.0802, -94.1266),
    ("GulfOps Barge Dispatch", 30.4515, -91.1871),
    ("GulfOps Inventory Exchange", 27.8006, -97.3964),
    ("GulfOps Emergency Supply", 28.9541, -95.3597),
    ("GulfOps Terminal Partners", 29.7977, -93.3252),
]

VENDOR_PRODUCTS = [
    ["CRD", "NGL"],
    ["CRD", "NGL", "LNG"],
    ["CRD", "LNG"],
    ["NGL", "LNG"],
    ["CRD", "NGL"],
    ["CRD", "NGL", "LNG"],
    ["NGL"],
    ["CRD", "NGL"],
]


def generate_dim_technicians_rows(cfg, asset_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 51)
    rows: list[dict[str, Any]] = []
    name_pool = list(TECHNICIAN_NAMES)
    rng.shuffle(name_pool)
    name_idx = 0
    for asset in asset_rows:
        for t_idx in range(cfg.num_technicians_per_asset):
            name = name_pool[name_idx % len(name_pool)]
            name_idx += 1
            role = TECHNICIAN_ROLES[(t_idx + hash(asset["asset_id"])) % len(TECHNICIAN_ROLES)]
            cert_level = rng.choice(["Level I", "Level II", "Level III"])
            available = rng.random() < 0.70
            rows.append({
                "tech_id": f"TECH-{asset['asset_id'][-3:]}-{t_idx + 1:02d}",
                "name": name,
                "role": role,
                "asset_id": asset["asset_id"],
                "region": asset["region"],
                "available": available,
                "certification_level": cert_level,
            })
    return rows


def generate_dim_parts_inventory_rows(cfg, asset_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 63)
    rows: list[dict[str, Any]] = []
    for asset in asset_rows:
        asset_num = int(asset["asset_id"].split("-")[1])
        stock_modifier = 0.5 if asset_num <= 4 else 1.0
        for p_idx, (sku_prefix, part_name, category) in enumerate(PART_TYPES):
            qty_on_hand = max(0, int(rng.randint(0, 8) * stock_modifier))
            rows.append({
                "part_id": f"PART-{asset['asset_id'][-3:]}-{p_idx + 1:02d}",
                "sku": f"{sku_prefix}-{asset['asset_id'][-3:]}",
                "name": part_name,
                "category": category,
                "asset_id": asset["asset_id"],
                "qty_on_hand": qty_on_hand,
                "qty_needed": rng.choice([1, 1, 1, 2]),
                "lead_time_days": rng.randint(0, 14),
            })
    return rows


def generate_dim_vendors_rows(cfg) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 77)
    rows: list[dict[str, Any]] = []
    for v_idx in range(min(cfg.num_vendors, len(VENDOR_LOCATIONS))):
        name, lat, lng = VENDOR_LOCATIONS[v_idx]
        products = VENDOR_PRODUCTS[v_idx]
        rows.append({
            "vendor_id": f"VEND-{v_idx + 1:03d}",
            "name": name,
            "lat": lat,
            "lng": lng,
            "products": ",".join(products),
            "capacity_tpd": rng.randint(30, 80),
            "price_premium_pct": round(rng.uniform(5.0, 25.0), 1),
            "eta_hours": round(rng.uniform(4.0, 18.0), 1),
        })
    return rows


def generate_dim_contracts_rows(cfg, asset_rows: list[dict[str, Any]], customer_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rng = random.Random(cfg.seed + 37)
    priority_rng = random.Random(cfg.seed + 73)
    assets_by_subregion: dict[str, list[dict[str, Any]]] = {}
    for asset in asset_rows:
        assets_by_subregion.setdefault(asset["subregion"], []).append(asset)
    contract_indices = list(range(1, cfg.num_contracts + 1))
    priority_rng.shuffle(contract_indices)
    critical_count = min(2, cfg.num_contracts)
    remaining_after_critical = max(0, cfg.num_contracts - critical_count)
    watch_count = min(max(5, cfg.num_contracts // 6), remaining_after_critical)
    critical_indices = set(contract_indices[:critical_count])
    watch_indices = set(contract_indices[critical_count : critical_count + watch_count])

    def choose_asset_for_customer(customer: dict[str, Any], contract_idx: int) -> dict[str, Any]:
        subregion_assets = assets_by_subregion.get(customer["subregion"]) or asset_rows
        primary_hubs = [a for a in subregion_assets if a.get("is_primary_hub")]
        primary_hub = primary_hubs[0] if primary_hubs else subregion_assets[0]
        nearest_asset = min(
            subregion_assets,
            key=lambda a: _distance_score(
                float(a["lat"]),
                float(a["lng"]),
                float(customer["lat"]),
                float(customer["lng"]),
            ),
        )
        # Backbone contracts originate from hub; branch contracts use nearest asset.
        if contract_idx % 3 == 0:
            return primary_hub
        return nearest_asset

    rows: list[dict[str, Any]] = []
    for idx in range(1, cfg.num_contracts + 1):
        customer = customer_rows[(idx - 1) % len(customer_rows)]
        selected_asset = choose_asset_for_customer(customer, idx)
        asset_id = selected_asset["asset_id"]
        industry = customer["industry"]
        dist_score = _distance_score(
            float(selected_asset["lat"]),
            float(selected_asset["lng"]),
            float(customer["lat"]),
            float(customer["lng"]),
        )
        pipeline_industries = {"Refining", "Petrochemicals", "LNG Export", "Midstream"}
        PIPELINE_DIST_THRESHOLD = 8.0  # low dist_score = nearer long-haul trunk distance
        mode = "pipeline" if industry in pipeline_industries and dist_score < PIPELINE_DIST_THRESHOLD else "truck"
        product = PRODUCTS[(idx - 1) % len(PRODUCTS)]
        story_chain = (idx - 1) % 9
        if idx in critical_indices:
            lane_priority = "critical"
        elif idx in watch_indices:
            lane_priority = "watch"
        else:
            lane_priority = "stable"
        lane_id = f"{asset_id}-{customer['customer_id']}-{product}"
        is_anchor_pipeline = mode == "pipeline" and (lane_priority == "critical" or rng.random() < 0.45)
        contract_type = "anchor_pipeline" if is_anchor_pipeline else "merchant_bulk"
        if contract_type == "anchor_pipeline":
            take_or_pay_min_tpd = rng.randint(35, 140)
            price_per_ton_usd = round(rng.uniform(95.0, 165.0), 2)
            energy_pass_through_pct = round(rng.uniform(0.75, 0.95), 3)
            overage_price_multiplier = round(rng.uniform(1.02, 1.08), 3)
            contract_term_years = rng.choice([15, 18, 20])
        else:
            take_or_pay_min_tpd = rng.randint(8, 70)
            price_per_ton_usd = round(rng.uniform(130.0, 285.0), 2)
            energy_pass_through_pct = round(rng.uniform(0.15, 0.50), 3)
            overage_price_multiplier = round(rng.uniform(1.12, 1.35), 3)
            contract_term_years = rng.choice([3, 5, 7, 10])
        rows.append(
            {
                "contract_id": f"CTR-{idx:04d}",
                "lane_id": lane_id,
                "customer_id": customer["customer_id"],
                "asset_id": asset_id,
                "product": product,
                "mode": mode,
                "contract_type": contract_type,
                "contract_term_years": contract_term_years,
                "take_or_pay_min_tpd": take_or_pay_min_tpd,
                "price_per_ton_usd": price_per_ton_usd,
                "energy_pass_through_pct": energy_pass_through_pct,
                "overage_price_multiplier": overage_price_multiplier,
                "ld_penalty_rate_usd": rng.choice([10000, 50000, 100000]),
                "story_chain_id": f"CHAIN-{story_chain:02d}",
                "lane_priority": lane_priority,
            }
        )

    # Capacity-aware scaling: total contracted demand per asset ~85-105% of expected supply
    asset_to_capacity = {a["asset_id"]: a["max_capacity_tpd"] for a in asset_rows}
    by_asset: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_asset.setdefault(row["asset_id"], []).append(row)
    for asset_id, contract_rows in by_asset.items():
        current_sum = sum(r["take_or_pay_min_tpd"] for r in contract_rows)
        if current_sum <= 0:
            continue
        capacity = asset_to_capacity.get(asset_id, 1000)
        expected_supply = capacity * 0.6  # typical utilization
        target_total = expected_supply * rng.uniform(0.85, 1.05)
        scale = target_total / current_sum
        for r in contract_rows:
            raw = max(5, round(r["take_or_pay_min_tpd"] * scale))
            r["take_or_pay_min_tpd"] = raw

    return rows

