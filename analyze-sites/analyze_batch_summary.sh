#!/bin/bash

# Batch Summary Analyzer
# Analyzes JSON results from tech stack batch analysis
# Compatible with bash 3.x (macOS)

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
SECURITY_FILE="${TEMP_DIR}/security_counts.txt"
FILES_FILE="${TEMP_DIR}/files_counts.txt"
META_FILE="${TEMP_DIR}/meta_counts.txt"

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

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN} Batch Analysis Summary${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Total sites analyzed:${NC} $TOTAL_SITES"
echo ""

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
            echo "$item" >> "$SECURITY_FILE"
        fi
    done

    # Extract MISSING files (from the "missing" section)
    sed -n '/"missing":/,/^  }/p' "$json_file" | grep '"files"' | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
        item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [ -n "$item" ]; then
            echo "$item" >> "$FILES_FILE"
        fi
    done

    # Extract MISSING meta tags (from the "missing" section)
    sed -n '/"missing":/,/^  }/p' "$json_file" | grep '"meta_tags"' | sed 's/.*\[//; s/\].*//; s/"//g' | tr ',' '\n' | while read -r item; do
        item=$(echo "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [ -n "$item" ]; then
            echo "$item" >> "$META_FILE"
        fi
    done
done

# Display common technologies (found in >50% of sites)
echo -e "${CYAN}Common Technologies (>50% of sites):${NC}"
echo ""

threshold=$((TOTAL_SITES / 2))

if [ -f "$TECH_FILE" ] && [ -s "$TECH_FILE" ]; then
    sort "$TECH_FILE" | uniq -c | sort -rn | while read -r count tech; do
        if [ "$count" -gt "$threshold" ]; then
            category="${tech%%:*}"
            tech_name="${tech#*:}"
            percentage=$((count * 100 / TOTAL_SITES))
            echo -e "  ${GREEN}✓${NC} $tech_name (${category}) - ${count}/${TOTAL_SITES} sites (${percentage}%)"
        fi
    done
fi

echo ""

# Display common missing features
echo -e "${CYAN}Common Missing Security Headers:${NC}"
echo ""

if [ -f "$SECURITY_FILE" ] && [ -s "$SECURITY_FILE" ]; then
    sort "$SECURITY_FILE" | uniq -c | sort -rn | while read -r count header; do
        percentage=$((count * 100 / TOTAL_SITES))
        echo -e "  ${RED}✗${NC} $header - Missing on ${count}/${TOTAL_SITES} sites (${percentage}%)"
    done
else
    echo -e "  ${GREEN}✓${NC} No missing security headers detected"
fi

echo ""

echo -e "${CYAN}Common Missing Files:${NC}"
echo ""

if [ -f "$FILES_FILE" ] && [ -s "$FILES_FILE" ]; then
    sort "$FILES_FILE" | uniq -c | sort -rn | while read -r count file; do
        percentage=$((count * 100 / TOTAL_SITES))
        echo -e "  ${RED}✗${NC} $file - Missing on ${count}/${TOTAL_SITES} sites (${percentage}%)"
    done
else
    echo -e "  ${GREEN}✓${NC} No missing files detected"
fi

echo ""

echo -e "${CYAN}Common Missing Meta Tags:${NC}"
echo ""

if [ -f "$META_FILE" ] && [ -s "$META_FILE" ]; then
    sort "$META_FILE" | uniq -c | sort -rn | while read -r count tag; do
        percentage=$((count * 100 / TOTAL_SITES))
        echo -e "  ${RED}✗${NC} $tag - Missing on ${count}/${TOTAL_SITES} sites (${percentage}%)"
    done
else
    echo -e "  ${GREEN}✓${NC} No missing meta tags detected"
fi

echo ""

# Responsive design stats
responsive_count=$(grep -l '"responsive": true' "${JSON_FILES[@]}" | wc -l | tr -d ' ')
responsive_pct=$((responsive_count * 100 / TOTAL_SITES))

echo -e "${CYAN}Additional Statistics:${NC}"
echo ""
echo -e "  Responsive design: ${responsive_count}/${TOTAL_SITES} sites (${responsive_pct}%)"

# SSL enabled
ssl_count=$(grep -l '"ssl_enabled": true' "${JSON_FILES[@]}" | wc -l | tr -d ' ')
ssl_pct=$((ssl_count * 100 / TOTAL_SITES))
echo -e "  SSL enabled: ${ssl_count}/${TOTAL_SITES} sites (${ssl_pct}%)"

# HTTP/2
http2_count=$(grep -l '"http_version": "HTTP/2"' "${JSON_FILES[@]}" | wc -l | tr -d ' ')
http2_pct=$((http2_count * 100 / TOTAL_SITES))
echo -e "  HTTP/2: ${http2_count}/${TOTAL_SITES} sites (${http2_pct}%)"

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
