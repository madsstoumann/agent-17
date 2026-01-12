#!/bin/bash

# Tech Stack Analyzer - Batch Mode
# Simple wrapper for processing multiple URLs

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PARALLEL_JOBS="${2:-3}"
SINGLE_SCRIPT="./analyze-tech-stack.sh"

# Check arguments
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No URL file provided${NC}"
    echo "Usage: $0 <urls_file> [parallel_jobs]"
    exit 1
fi

URLS_FILE="$1"

# Validate
if [ ! -f "$URLS_FILE" ]; then
    echo -e "${RED}Error: File not found: $URLS_FILE${NC}"
    exit 1
fi

if [ ! -f "$SINGLE_SCRIPT" ]; then
    echo -e "${RED}Error: Script not found: $SINGLE_SCRIPT${NC}"
    exit 1
fi

# Create output directory
BATCH_ID=$(date +%Y%m%d_%H%M%S)
BATCH_DIR="tech_stack_batch_${BATCH_ID}"
mkdir -p "$BATCH_DIR"

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN} Tech Stack Analyzer - Batch Mode${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Batch ID:${NC}  $BATCH_ID"
echo -e "${BLUE}Input:${NC}     $URLS_FILE"
echo -e "${BLUE}Output:${NC}    $BATCH_DIR/"
echo ""

# Read URLs
URLS=()
while IFS= read -r line; do
    if [[ ! "$line" =~ ^#.* ]] && [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
        URLS+=("$line")
    fi
done < "$URLS_FILE"

TOTAL=${#URLS[@]}
echo -e "${YELLOW}Processing $TOTAL URLs...${NC}"
echo ""

# Process each URL
COUNT=0
for url in "${URLS[@]}"; do
    ((COUNT++))
    echo -e "[$(date +%H:%M:%S)] [$COUNT/$TOTAL] Analyzing: $url"

    # Run analysis with output directory parameter
    if $SINGLE_SCRIPT --output-dir "$BATCH_DIR" "$url" > /dev/null 2>&1; then
        echo "  ✓ Completed"
    else
        echo "  ⚠ Failed"
    fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN} Batch Complete${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "Results saved to: ${BLUE}$BATCH_DIR/${NC}"
echo ""

# Generate summary files
if [ -f "./analyze_batch_summary.sh" ]; then
    echo -e "${YELLOW}Generating summary report...${NC}"
    ./analyze_batch_summary.sh "$BATCH_DIR" > "${BATCH_DIR}/summary_report.txt"
    echo -e "${GREEN}✓ Summary report: ${BATCH_DIR}/summary_report.txt${NC}"
fi

if [ -f "./generate_batch_summary.sh" ]; then
    echo -e "${YELLOW}Generating summary JSON...${NC}"
    ./generate_batch_summary.sh "$BATCH_DIR" > "${BATCH_DIR}/summary.json"
    echo -e "${GREEN}✓ Summary JSON: ${BATCH_DIR}/summary.json${NC}"
fi

echo ""
echo -e "${BLUE}Batch directory contents:${NC}"
echo "  - <domain>.json (individual site results)"
echo "  - summary.json (aggregate statistics)"
echo "  - summary_report.txt (human-readable summary)"

