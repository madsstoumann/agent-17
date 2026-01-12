#!/bin/bash

# Generate Batch Summary JSON
# Creates a comprehensive summary.json from batch analysis results

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check arguments
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No batch directory provided${NC}"
    echo "Usage: $0 <batch_directory>"
    exit 1
fi

BATCH_DIR="$1"

if [ ! -d "$BATCH_DIR" ]; then
    echo -e "${RED}Error: Directory not found: $BATCH_DIR${NC}"
    exit 1
fi

# Temporary files for counting
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

TECH_FILE="${TEMP_DIR}/tech_counts.txt"
MISSING_SECURITY_FILE="${TEMP_DIR}/missing_security_counts.txt"
MISSING_FILES_FILE="${TEMP_DIR}/missing_files_counts.txt"
MISSING_META_FILE="${TEMP_DIR}/missing_meta_counts.txt"

# Count JSON files (exclude summary.json)
JSON_FILES=("${BATCH_DIR}"/*.json)
# Filter out summary.json
FILTERED_FILES=()
for file in "${JSON_FILES[@]}"; do
    if [[ "$(basename "$file")" != "summary.json" ]]; then
        FILTERED_FILES+=("$file")
    fi
done
JSON_FILES=("${FILTERED_FILES[@]}")
TOTAL_SITES=${#JSON_FILES[@]}

echo -e "${YELLOW}Analyzing ${TOTAL_SITES} sites...${NC}" >&2

# Process each JSON file
for json_file in "${JSON_FILES[@]}"; do
    # Extract all technologies from technologies section ONLY (not from missing section)
    for category in cms web_frameworks programming_languages javascript_frameworks javascript_libraries ui_frameworks analytics tag_managers cdn caching reverse_proxies font_scripts security cookie_compliance rum performance hosting miscellaneous; do
        sed -n '/"technologies":/,/"meta":/p' "$json_file" | grep "\"${category}\"" | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
            item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
            if [ -n "$item" ]; then
                echo "${category}:${item}" >> "$TECH_FILE"
            fi
        done
    done

    # Extract MISSING security headers (from the "missing" section)
    sed -n '/"missing":/,/^  }/p' "$json_file" | grep '"security"' | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
        item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [ -n "$item" ]; then
            echo "$item" >> "$MISSING_SECURITY_FILE"
        fi
    done

    # Extract MISSING files (from the "missing" section)
    sed -n '/"missing":/,/^  }/p' "$json_file" | grep '"files"' | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
        item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [ -n "$item" ]; then
            echo "$item" >> "$MISSING_FILES_FILE"
        fi
    done

    # Extract MISSING meta tags (from the "missing" section)
    sed -n '/"missing":/,/^  }/p' "$json_file" | grep '"meta_tags"' | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
        item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [ -n "$item" ]; then
            echo "$item" >> "$MISSING_META_FILE"
        fi
    done
done

# Calculate statistics
responsive_count=$(grep -l '"responsive": true' "${JSON_FILES[@]}" | wc -l | tr -d ' ')
ssl_count=$(grep -l '"ssl_enabled": true' "${JSON_FILES[@]}" | wc -l | tr -d ' ')
http2_count=$(grep -l '"http_version": "HTTP/2"' "${JSON_FILES[@]}" | wc -l | tr -d ' ')

# Build JSON summary
BATCH_ID=$(basename "$BATCH_DIR" | sed 's/tech_stack_batch_//')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "{"
echo "  \"batch_id\": \"${BATCH_ID}\","
echo "  \"analyzed_at\": \"${TIMESTAMP}\","
echo "  \"total_sites\": ${TOTAL_SITES},"
echo "  \"statistics\": {"
echo "    \"responsive_design\": {"
echo "      \"count\": ${responsive_count},"
echo "      \"percentage\": $((responsive_count * 100 / TOTAL_SITES))"
echo "    },"
echo "    \"ssl_enabled\": {"
echo "      \"count\": ${ssl_count},"
echo "      \"percentage\": $((ssl_count * 100 / TOTAL_SITES))"
echo "    },"
echo "    \"http2\": {"
echo "      \"count\": ${http2_count},"
echo "      \"percentage\": $((http2_count * 100 / TOTAL_SITES))"
echo "    }"
echo "  },"
echo "  \"common_technologies\": {"

# Output common technologies (>50%)
threshold=$((TOTAL_SITES / 2))
first_category=true

for category in cms javascript_frameworks javascript_libraries ui_frameworks analytics tag_managers cdn font_scripts security cookie_compliance miscellaneous performance; do
    category_has_items=false

    if [ -f "$TECH_FILE" ]; then
        items=$(grep "^${category}:" "$TECH_FILE" | sort | uniq -c | sort -rn | while read -r count tech; do
            if [ "$count" -gt "$threshold" ]; then
                tech_name="${tech#*:}"
                echo "${tech_name}|${count}"
            fi
        done)

        if [ -n "$items" ]; then
            if [ "$first_category" = false ]; then
                echo ","
            fi
            first_category=false

            echo -n "    \"${category}\": ["
            first_item=true

            echo "$items" | while IFS='|' read -r tech_name count; do
                if [ "$first_item" = true ]; then
                    first_item=false
                else
                    echo -n ","
                fi
                percentage=$((count * 100 / TOTAL_SITES))
                echo ""
                echo -n "      {\"name\": \"${tech_name}\", \"count\": ${count}, \"percentage\": ${percentage}}"
            done

            echo ""
            echo -n "    ]"
        fi
    fi
done

echo ""
echo "  },"
echo "  \"common_missing_features\": {"

# Missing security headers
echo -n "    \"security_headers\": ["
if [ -f "$MISSING_SECURITY_FILE" ] && [ -s "$MISSING_SECURITY_FILE" ]; then
    first=true
    sort "$MISSING_SECURITY_FILE" | uniq -c | sort -rn | while read -r count header; do
        if [ "$first" = true ]; then
            first=false
        else
            echo -n ","
        fi
        percentage=$((count * 100 / TOTAL_SITES))
        echo ""
        echo -n "      {\"name\": \"${header}\", \"missing_on\": ${count}, \"percentage\": ${percentage}}"
    done
    echo ""
    echo -n "    "
fi
echo "],"

# Missing files
echo -n "    \"files\": ["
if [ -f "$MISSING_FILES_FILE" ] && [ -s "$MISSING_FILES_FILE" ]; then
    first=true
    sort "$MISSING_FILES_FILE" | uniq -c | sort -rn | while read -r count file; do
        if [ "$first" = true ]; then
            first=false
        else
            echo -n ","
        fi
        percentage=$((count * 100 / TOTAL_SITES))
        echo ""
        echo -n "      {\"name\": \"${file}\", \"missing_on\": ${count}, \"percentage\": ${percentage}}"
    done
    echo ""
    echo -n "    "
fi
echo "],"

# Missing meta tags
echo -n "    \"meta_tags\": ["
if [ -f "$MISSING_META_FILE" ] && [ -s "$MISSING_META_FILE" ]; then
    first=true
    sort "$MISSING_META_FILE" | uniq -c | sort -rn | while read -r count tag; do
        if [ "$first" = true ]; then
            first=false
        else
            echo -n ","
        fi
        percentage=$((count * 100 / TOTAL_SITES))
        echo ""
        echo -n "      {\"name\": \"${tag}\", \"missing_on\": ${count}, \"percentage\": ${percentage}}"
    done
    echo ""
    echo -n "    "
fi
echo "]"

echo "  }"
echo "}"
