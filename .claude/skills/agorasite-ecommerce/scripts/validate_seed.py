#!/usr/bin/env python3
"""Validate the reusable AgoraSite demo product JSON seed contract.

Usage: python validate_seed.py path/to/products.json
Accepts either a top-level product array or {"products": [...]}.
No third-party dependencies, file writes, or network access.
"""
import json
import sys
from pathlib import Path


def non_empty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(data):
    errors = []
    products = data.get("products") if isinstance(data, dict) else data
    if not isinstance(products, list):
        return ["Root must be a product list or an object containing a 'products' list."]
    if not products:
        errors.append("At least one product is required.")

    product_ids = set()
    variant_skus = set()
    for index, product in enumerate(products):
        key = f"products[{index}]"
        if not isinstance(product, dict):
            errors.append(f"{key} must be an object.")
            continue
        pid = product.get("id")
        if not non_empty(pid):
            errors.append(f"{key}.id must be a nonempty string.")
        elif pid in product_ids:
            errors.append(f"{key}.id is duplicated: {pid}")
        else:
            product_ids.add(pid)

        for field in ("name", "categoryId"):
            if not non_empty(product.get(field)):
                errors.append(f"{key}.{field} must be a nonempty string.")

        price = product.get("priceCents")
        if type(price) is not int or price < 0:
            errors.append(f"{key}.priceCents must be an integer >= 0.")

        images = product.get("images")
        if not isinstance(images, list) or not images or any(not non_empty(img) for img in images):
            errors.append(f"{key}.images must be a nonempty list of image URL/path strings.")

        variants = product.get("variants")
        if not isinstance(variants, list) or not variants:
            errors.append(f"{key}.variants must be a nonempty list.")
            continue
        option_combinations = set()
        for j, variant in enumerate(variants):
            vkey = f"{key}.variants[{j}]"
            if not isinstance(variant, dict):
                errors.append(f"{vkey} must be an object.")
                continue
            sku = variant.get("sku")
            if not non_empty(sku):
                errors.append(f"{vkey}.sku must be a nonempty string.")
            elif sku in variant_skus:
                errors.append(f"{vkey}.sku is duplicated: {sku}")
            else:
                variant_skus.add(sku)

            stock = variant.get("stock")
            if type(stock) is not int or stock < 0:
                errors.append(f"{vkey}.stock must be an integer >= 0.")

            options = variant.get("options")
            if options is None:
                # Convenient shorthand for fashion demos.
                options = {k: variant[k] for k in ("size", "color") if k in variant}
            if not isinstance(options, dict) or not options:
                errors.append(f"{vkey} requires at least one option (e.g., size/color), or an options object.")
                continue
            if any(not non_empty(k) or not non_empty(v) for k, v in options.items()):
                errors.append(f"{vkey} option keys and values must be nonempty strings.")
                continue
            option_tuple = tuple(sorted(options.items()))
            if option_tuple in option_combinations:
                errors.append(f"{vkey} repeats an option combination for its product.")
            option_combinations.add(option_tuple)
    return errors


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate_seed.py path/to/products.json", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cannot read JSON: {exc}", file=sys.stderr)
        return 2
    problems = validate(data)
    if problems:
        print("INVALID product seed:")
        for problem in problems:
            print(f" - {problem}")
        return 1
    products = data["products"] if isinstance(data, dict) else data
    print(f"VALID product seed: {len(products)} products")
    return 0


if __name__ == "__main__":
    sys.exit(main())
