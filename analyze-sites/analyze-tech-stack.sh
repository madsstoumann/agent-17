#!/bin/bash

# Tech Stack Analyzer Script
# Usage: ./analyze-tech-stack.sh <url>
#        ./analyze-tech-stack.sh -b urls.txt
#        ./analyze-tech-stack.sh --batch urls.txt

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
BATCH_MODE=false
BATCH_FILE=""
PARALLEL_JOBS=3
BATCH_RESULTS=()
OUTPUT_DIR="."

# Show usage
show_usage() {
    echo "Tech Stack Analyzer - Analyze website technology stacks"
    echo ""
    echo "Usage:"
    echo "  $0 <url>                    Analyze a single URL"
    echo "  $0 -b <file>                Analyze multiple URLs from a file"
    echo "  $0 --batch <file>           Analyze multiple URLs from a file"
    echo ""
    echo "Options:"
    echo "  -b, --batch <file>          Batch mode - analyze URLs from file (one per line)"
    echo "  -j, --jobs <num>            Number of parallel jobs (default: 3, max: 10)"
    echo "  -o, --output-dir <dir>      Output directory for JSON files (default: current dir)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 https://example.com"
    echo "  $0 -b urls.txt"
    echo "  $0 --batch urls.txt --jobs 5"
    exit 0
}

# Parse command line arguments
parse_args() {
    if [ $# -eq 0 ]; then
        echo -e "${RED}Error: No arguments provided${NC}"
        show_usage
    fi

    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -b|--batch)
                BATCH_MODE=true
                shift
                if [ $# -eq 0 ]; then
                    echo -e "${RED}Error: --batch requires a file argument${NC}"
                    exit 1
                fi
                BATCH_FILE="$1"
                shift
                ;;
            -j|--jobs)
                shift
                if [ $# -eq 0 ]; then
                    echo -e "${RED}Error: --jobs requires a number argument${NC}"
                    exit 1
                fi
                PARALLEL_JOBS="$1"
                if ! [[ "$PARALLEL_JOBS" =~ ^[0-9]+$ ]] || [ "$PARALLEL_JOBS" -lt 1 ] || [ "$PARALLEL_JOBS" -gt 10 ]; then
                    echo -e "${RED}Error: --jobs must be a number between 1 and 10${NC}"
                    exit 1
                fi
                shift
                ;;
            -o|--output-dir)
                shift
                if [ $# -eq 0 ]; then
                    echo -e "${RED}Error: --output-dir requires a directory argument${NC}"
                    exit 1
                fi
                OUTPUT_DIR="$1"
                shift
                ;;
            *)
                if [ "$BATCH_MODE" = false ]; then
                    URL="$1"
                    shift
                else
                    echo -e "${RED}Error: Unknown argument: $1${NC}"
                    exit 1
                fi
                ;;
        esac
    done

    # Validate batch file exists
    if [ "$BATCH_MODE" = true ] && [ ! -f "$BATCH_FILE" ]; then
        echo -e "${RED}Error: Batch file not found: $BATCH_FILE${NC}"
        exit 1
    fi

    # Validate URL in single mode
    if [ "$BATCH_MODE" = false ] && [ -z "${URL:-}" ]; then
        echo -e "${RED}Error: No URL provided${NC}"
        show_usage
    fi
}

# Parse arguments
parse_args "$@"

# Single URL mode setup
if [ "$BATCH_MODE" = false ]; then
    # Validate URL format
    if [[ ! "$URL" =~ ^https?:// ]]; then
        URL="https://$URL"
    fi

    echo -e "${GREEN}Analyzing tech stack for: ${URL}${NC}\n"

    # Temporary files
    TEMP_DIR=$(mktemp -d)
    HEADERS_FILE="${TEMP_DIR}/headers.txt"
    HTML_FILE="${TEMP_DIR}/page.html"
    SCRIPTS_FILE="${TEMP_DIR}/scripts.txt"
    OUTPUT_FILE="${TEMP_DIR}/tech_stack.json"

    # Cleanup function
    cleanup() {
        rm -rf "${TEMP_DIR}"
    }
    trap cleanup EXIT

    # Fetch headers
    echo -e "${YELLOW}Fetching HTTP headers...${NC}"
    curl -sI -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
        "$URL" > "${HEADERS_FILE}" 2>/dev/null || true

    # Fetch HTML content
    echo -e "${YELLOW}Fetching HTML content...${NC}"
    curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
        "$URL" > "${HTML_FILE}" 2>/dev/null || true
fi

# Detection functions
detect_from_headers() {
    local tech_array=()

    if grep -qi "cloudflare" "${HEADERS_FILE}"; then
        tech_array+=("\"Cloudflare\"")
    fi

    if grep -qi "x-powered-by.*ASP.NET" "${HEADERS_FILE}"; then
        tech_array+=("\"Microsoft ASP.NET\"")
    fi

    if grep -qi "x-powered-by.*PHP" "${HEADERS_FILE}"; then
        tech_array+=("\"PHP\"")
    fi

    if grep -qi "server.*nginx" "${HEADERS_FILE}"; then
        tech_array+=("\"Nginx\"")
    fi

    if grep -qi "server.*apache" "${HEADERS_FILE}"; then
        tech_array+=("\"Apache\"")
    fi

    if grep -qi "x-powered-by.*Express" "${HEADERS_FILE}"; then
        tech_array+=("\"Express\"")
    fi

    if grep -qi "x-drupal" "${HEADERS_FILE}"; then
        tech_array+=("\"Drupal\"")
    fi

    echo "${tech_array[@]}"
}

detect_cms() {
    local cms_array=()

    # WordPress
    if grep -qi "wp-content\|wp-includes\|wordpress" "${HTML_FILE}"; then
        cms_array+=("\"WordPress\"")
    fi

    # Drupal
    if grep -qi "drupal\|sites/default/files" "${HTML_FILE}"; then
        cms_array+=("\"Drupal\"")
    fi

    # Joomla
    if grep -qi "/components/com_\|Joomla!" "${HTML_FILE}"; then
        cms_array+=("\"Joomla\"")
    fi

    # Umbraco
    if grep -qi "umbraco\|/media/[a-z0-9]\{6,\}/" "${HTML_FILE}"; then
        cms_array+=("\"Umbraco\"")
    fi

    # Shopify
    if grep -qi "cdn.shopify.com\|myshopify.com" "${HTML_FILE}"; then
        cms_array+=("\"Shopify\"")
    fi

    # Wix
    if grep -qi "wix.com\|wixstatic.com" "${HTML_FILE}"; then
        cms_array+=("\"Wix\"")
    fi

    # Squarespace
    if grep -qi "squarespace" "${HTML_FILE}"; then
        cms_array+=("\"Squarespace\"")
    fi

    # Webflow
    if grep -qi "webflow" "${HTML_FILE}"; then
        cms_array+=("\"Webflow\"")
    fi

    # Sitecore
    if grep -qi "\"sitecore\":\|__JSS_STATE__\|/sitecore/\|/jssmedia/" "${HTML_FILE}"; then
        cms_array+=("\"Sitecore\"")
    fi

    # Optimizely (Episerver)
    if grep -qi "window\.optimizely\|cdn\.optimizely\.com\|episerver" "${HTML_FILE}"; then
        cms_array+=("\"Optimizely\"")
    fi

    [ ${#cms_array[@]} -eq 0 ] && echo "" || printf '%s\n' "${cms_array[@]}"
}

detect_javascript_frameworks() {
    local frameworks=()

    # React
    if grep -qi "react\|_react\|data-reactroot" "${HTML_FILE}"; then
        frameworks+=("\"React\"")
    fi

    # Vue.js
    if grep -qi "vue\.js\|data-v-\|__vue__" "${HTML_FILE}"; then
        frameworks+=("\"Vue.js\"")
    fi

    # Angular
    if grep -qi "ng-\|angular\|data-ng-" "${HTML_FILE}"; then
        frameworks+=("\"Angular\"")
    fi

    # Next.js
    if grep -qi "next\.js\|_next/" "${HTML_FILE}"; then
        frameworks+=("\"Next.js\"")
    fi

    # Nuxt.js
    if grep -qi "nuxt\|__nuxt" "${HTML_FILE}"; then
        frameworks+=("\"Nuxt.js\"")
    fi

    # Svelte
    if grep -qi "svelte" "${HTML_FILE}"; then
        frameworks+=("\"Svelte\"")
    fi

    [ ${#frameworks[@]} -eq 0 ] && echo "" || printf '%s\n' "${frameworks[@]}"
}

detect_javascript_libraries() {
    local libraries=()

    # jQuery
    if grep -qi "jquery" "${HTML_FILE}"; then
        libraries+=("\"jQuery\"")
    fi

    # Lodash
    if grep -qi "lodash" "${HTML_FILE}"; then
        libraries+=("\"Lodash\"")
    fi

    # Moment.js
    if grep -qi "moment\.js" "${HTML_FILE}"; then
        libraries+=("\"Moment.js\"")
    fi

    # Boomerang
    if grep -qi "boomerang" "${HTML_FILE}"; then
        libraries+=("\"Boomerang\"")
    fi

    # GSAP
    if grep -qi "gsap\|greensock" "${HTML_FILE}"; then
        libraries+=("\"GSAP\"")
    fi

    [ ${#libraries[@]} -eq 0 ] && echo "" || printf '%s\n' "${libraries[@]}"
}

detect_ui_frameworks() {
    local frameworks=()

    # Bootstrap
    if grep -qi "bootstrap" "${HTML_FILE}"; then
        frameworks+=("\"Bootstrap\"")
    fi

    # Tailwind CSS
    if grep -qi "tailwind" "${HTML_FILE}"; then
        frameworks+=("\"Tailwind CSS\"")
    fi

    # Foundation
    if grep -qi "foundation" "${HTML_FILE}"; then
        frameworks+=("\"Foundation\"")
    fi

    # Material UI
    if grep -qi "material-ui\|@mui" "${HTML_FILE}"; then
        frameworks+=("\"Material-UI\"")
    fi

    # Bulma
    if grep -qi "bulma" "${HTML_FILE}"; then
        frameworks+=("\"Bulma\"")
    fi

    [ ${#frameworks[@]} -eq 0 ] && echo "" || printf '%s\n' "${frameworks[@]}"
}

detect_analytics() {
    local analytics=()

    # Google Analytics
    if grep -qi "google-analytics\|googletagmanager\|gtag\|ga\.js\|analytics\.js" "${HTML_FILE}"; then
        analytics+=("\"Google Analytics\"")
    fi

    # Adobe Analytics
    if grep -qi "omniture\|adobe.*analytics" "${HTML_FILE}"; then
        analytics+=("\"Adobe Analytics\"")
    fi

    # Matomo
    if grep -qi "matomo\|piwik" "${HTML_FILE}"; then
        analytics+=("\"Matomo\"")
    fi

    # Hotjar
    if grep -qi "hotjar" "${HTML_FILE}"; then
        analytics+=("\"Hotjar\"")
    fi

    # Mixpanel
    if grep -qi "mixpanel" "${HTML_FILE}"; then
        analytics+=("\"Mixpanel\"")
    fi

    [ ${#analytics[@]} -eq 0 ] && echo "" || printf '%s\n' "${analytics[@]}"
}

detect_tag_managers() {
    local managers=()

    # Google Tag Manager
    if grep -qi "googletagmanager\.com/gtm" "${HTML_FILE}"; then
        managers+=("\"Google Tag Manager\"")
    fi

    # Adobe Tag Manager
    if grep -qi "adobe.*tag.*manager" "${HTML_FILE}"; then
        managers+=("\"Adobe Tag Manager\"")
    fi

    # Tealium
    if grep -qi "tealium" "${HTML_FILE}"; then
        managers+=("\"Tealium\"")
    fi

    [ ${#managers[@]} -eq 0 ] && echo "" || printf '%s\n' "${managers[@]}"
}

detect_cdn() {
    local cdns=()

    # Cloudflare
    if grep -qi "cloudflare" "${HTML_FILE}" || grep -qi "cloudflare" "${HEADERS_FILE}"; then
        cdns+=("\"Cloudflare\"")
    fi

    # Akamai
    if grep -qi "akamai" "${HTML_FILE}"; then
        cdns+=("\"Akamai\"")
    fi

    # Fastly
    if grep -qi "fastly" "${HTML_FILE}" || grep -qi "fastly" "${HEADERS_FILE}"; then
        cdns+=("\"Fastly\"")
    fi

    # CloudFront
    if grep -qi "cloudfront" "${HTML_FILE}"; then
        cdns+=("\"Amazon CloudFront\"")
    fi

    # jsDelivr
    if grep -qi "jsdelivr" "${HTML_FILE}"; then
        cdns+=("\"jsDelivr\"")
    fi

    # unpkg
    if grep -qi "unpkg\.com" "${HTML_FILE}"; then
        cdns+=("\"unpkg\"")
    fi

    [ ${#cdns[@]} -eq 0 ] && echo "" || printf '%s\n' "${cdns[@]}"
}

detect_font_scripts() {
    local fonts=()

    # Google Fonts
    if grep -qi "fonts\.googleapis\.com\|fonts\.gstatic\.com" "${HTML_FILE}"; then
        fonts+=("\"Google Fonts\"")
    fi

    # Adobe Fonts
    if grep -qi "typekit\|use\.typekit" "${HTML_FILE}"; then
        fonts+=("\"Adobe Fonts\"")
    fi

    # Font Awesome
    if grep -qi "fontawesome\|font-awesome" "${HTML_FILE}"; then
        fonts+=("\"Font Awesome\"")
    fi

    [ ${#fonts[@]} -eq 0 ] && echo "" || printf '%s\n' "${fonts[@]}"
}

detect_security() {
    local security=()

    # HSTS
    if grep -qi "strict-transport-security" "${HEADERS_FILE}"; then
        security+=("\"HSTS\"")
    fi

    # Cloudflare Bot Management
    if grep -qi "cloudflare.*bot\|cf-ray" "${HEADERS_FILE}"; then
        security+=("\"Cloudflare Bot Management\"")
    fi

    # reCAPTCHA
    if grep -qi "recaptcha" "${HTML_FILE}"; then
        security+=("\"reCAPTCHA\"")
    fi

    # Content Security Policy
    if grep -qi "content-security-policy" "${HEADERS_FILE}"; then
        security+=("\"Content Security Policy\"")
    fi

    [ ${#security[@]} -eq 0 ] && echo "" || printf '%s\n' "${security[@]}"
}

detect_cookie_compliance() {
    local compliance=()

    # OneTrust
    if grep -qi "onetrust" "${HTML_FILE}"; then
        compliance+=("\"OneTrust\"")
    fi

    # Cookiebot
    if grep -qi "cookiebot" "${HTML_FILE}"; then
        compliance+=("\"Cookiebot\"")
    fi

    # Cookie Consent
    if grep -qi "cookieconsent" "${HTML_FILE}"; then
        compliance+=("\"Cookie Consent\"")
    fi

    [ ${#compliance[@]} -eq 0 ] && echo "" || printf '%s\n' "${compliance[@]}"
}

detect_miscellaneous() {
    local misc=()

    # Open Graph
    if grep -qi "og:title\|og:description\|property=\"og:" "${HTML_FILE}"; then
        misc+=("\"Open Graph\"")
    fi

    # HTTP/3
    if grep -qi "HTTP/3\|h3-" "${HEADERS_FILE}"; then
        misc+=("\"HTTP/3\"")
    elif grep -qi "HTTP/2" "${HEADERS_FILE}"; then
        misc+=("\"HTTP/2\"")
    fi

    [ ${#misc[@]} -eq 0 ] && echo "" || printf '%s\n' "${misc[@]}"
}

detect_performance() {
    local perf=()

    # Priority Hints
    if grep -qi "fetchpriority\|importance=" "${HTML_FILE}"; then
        perf+=("\"Priority Hints\"")
    fi

    # New Relic (if not RUM-specific)
    if grep -qi "newrelic" "${HTML_FILE}" && ! grep -qi "browser-agent\|NREUM" "${HTML_FILE}"; then
        perf+=("\"New Relic\"")
    fi

    [ ${#perf[@]} -eq 0 ] && echo "" || printf '%s\n' "${perf[@]}"
}

detect_rum() {
    local rum=()

    # Boomerang
    if grep -qi "boomerang" "${HTML_FILE}"; then
        rum+=("\"Boomerang\"")
    fi

    # Akamai mPulse
    if grep -qi "mpulse\|go-mpulse\.net" "${HTML_FILE}"; then
        rum+=("\"Akamai mPulse\"")
    fi

    # New Relic Browser
    if grep -qi "browser-agent\|NREUM\|js-agent\.newrelic\.com" "${HTML_FILE}"; then
        rum+=("\"New Relic Browser\"")
    fi

    # Google Analytics (also RUM)
    if grep -qi "google-analytics.*rum\|gtag.*measurement" "${HTML_FILE}"; then
        rum+=("\"Google Analytics RUM\"")
    fi

    [ ${#rum[@]} -eq 0 ] && echo "" || printf '%s\n' "${rum[@]}"
}

detect_web_frameworks() {
    local frameworks=()

    # ASP.NET / ASP.NET Core
    if grep -qi "x-powered-by.*ASP\.NET\|x-aspnet-version\|__VIEWSTATE\|\.AspNetCore" "${HEADERS_FILE}" "${HTML_FILE}"; then
        frameworks+=("\"Microsoft ASP.NET\"")
    fi

    # Laravel
    if grep -qi "laravel_session\|laravel.*token" "${HEADERS_FILE}" "${HTML_FILE}"; then
        frameworks+=("\"Laravel\"")
    fi

    # Django
    if grep -qi "csrfmiddlewaretoken\|django" "${HTML_FILE}" || grep -qi "X-Django" "${HEADERS_FILE}"; then
        frameworks+=("\"Django\"")
    fi

    # Ruby on Rails
    if grep -qi "_session.*rails\|csrf-token.*rails\|X-Runtime" "${HTML_FILE}" "${HEADERS_FILE}"; then
        frameworks+=("\"Ruby on Rails\"")
    fi

    # Express.js
    if grep -qi "x-powered-by.*Express" "${HEADERS_FILE}"; then
        frameworks+=("\"Express.js\"")
    fi

    # Flask
    if grep -qi "flask\|werkzeug" "${HEADERS_FILE}" "${HTML_FILE}"; then
        frameworks+=("\"Flask\"")
    fi

    # Spring Framework
    if grep -qi "spring\|jsessionid" "${HTML_FILE}" "${HEADERS_FILE}"; then
        frameworks+=("\"Spring Framework\"")
    fi

    [ ${#frameworks[@]} -eq 0 ] && echo "" || printf '%s\n' "${frameworks[@]}"
}

detect_programming_languages() {
    local langs=()

    # PHP
    if grep -qi "x-powered-by.*PHP\|\.php\|phpsessid" "${HEADERS_FILE}" "${HTML_FILE}"; then
        langs+=("\"PHP\"")
    fi

    # JavaScript/Node.js
    if grep -qi "x-powered-by.*Express\|x-powered-by.*Next\.js" "${HEADERS_FILE}"; then
        langs+=("\"Node.js\"")
    fi

    # Python
    if grep -qi "django\|flask\|werkzeug" "${HEADERS_FILE}" "${HTML_FILE}"; then
        langs+=("\"Python\"")
    fi

    # Ruby
    if grep -qi "rails\|rack" "${HEADERS_FILE}" "${HTML_FILE}"; then
        langs+=("\"Ruby\"")
    fi

    # ASP.NET/C#
    if grep -qi "x-powered-by.*ASP\.NET\|x-aspnet-version\|\.AspNetCore" "${HEADERS_FILE}"; then
        langs+=("\"C#\"")
    fi

    # Java
    if grep -qi "jsessionid\|spring\|jboss\|tomcat" "${HTML_FILE}" "${HEADERS_FILE}"; then
        langs+=("\"Java\"")
    fi

    [ ${#langs[@]} -eq 0 ] && echo "" || printf '%s\n' "${langs[@]}"
}

detect_caching() {
    local cache=()

    # Varnish
    if grep -qi "x-varnish\|via.*varnish" "${HEADERS_FILE}"; then
        cache+=("\"Varnish\"")
    fi

    # Redis (if exposed in headers)
    if grep -qi "x-redis\|redis" "${HEADERS_FILE}"; then
        cache+=("\"Redis\"")
    fi

    # Memcached
    if grep -qi "memcached" "${HEADERS_FILE}"; then
        cache+=("\"Memcached\"")
    fi

    # Cloudflare Cache
    if grep -qi "cf-cache-status" "${HEADERS_FILE}"; then
        cache+=("\"Cloudflare Cache\"")
    fi

    # Fastly
    if grep -qi "x-served-by.*fastly\|fastly-io" "${HEADERS_FILE}"; then
        cache+=("\"Fastly\"")
    fi

    [ ${#cache[@]} -eq 0 ] && echo "" || printf '%s\n' "${cache[@]}"
}

detect_reverse_proxies() {
    local proxies=()

    # Nginx (as reverse proxy)
    if grep -qi "server.*nginx" "${HEADERS_FILE}"; then
        proxies+=("\"Nginx\"")
    fi

    # Varnish
    if grep -qi "x-varnish\|via.*varnish" "${HEADERS_FILE}"; then
        proxies+=("\"Varnish\"")
    fi

    # HAProxy
    if grep -qi "haproxy" "${HEADERS_FILE}"; then
        proxies+=("\"HAProxy\"")
    fi

    # Apache (as reverse proxy)
    if grep -qi "via.*apache" "${HEADERS_FILE}"; then
        proxies+=("\"Apache\"")
    fi

    [ ${#proxies[@]} -eq 0 ] && echo "" || printf '%s\n' "${proxies[@]}"
}

detect_hosting() {
    local hosting=()

    # AWS
    if grep -qi "x-amz-\|amazonaws\.com\|cloudfront" "${HEADERS_FILE}" "${HTML_FILE}"; then
        hosting+=("\"Amazon Web Services\"")
    fi

    # Azure
    if grep -qi "azure\|windows\.net" "${HEADERS_FILE}" "${HTML_FILE}"; then
        hosting+=("\"Microsoft Azure\"")
    fi

    # Google Cloud
    if grep -qi "gcp\|google.*cloud\|appengine" "${HEADERS_FILE}" "${HTML_FILE}"; then
        hosting+=("\"Google Cloud Platform\"")
    fi

    # Cloudflare Pages
    if grep -qi "cf-ray" "${HEADERS_FILE}" && grep -qi "pages\.dev" "${HTML_FILE}"; then
        hosting+=("\"Cloudflare Pages\"")
    fi

    # Vercel
    if grep -qi "x-vercel\|vercel\.com" "${HEADERS_FILE}" "${HTML_FILE}"; then
        hosting+=("\"Vercel\"")
    fi

    # Netlify
    if grep -qi "x-nf-\|netlify\.com" "${HEADERS_FILE}" "${HTML_FILE}"; then
        hosting+=("\"Netlify\"")
    fi

    # GitHub Pages
    if grep -qi "github\.io\|pages\.github\.com" "${HTML_FILE}"; then
        hosting+=("\"GitHub Pages\"")
    fi

    # Heroku
    if grep -qi "herokuapp\.com" "${HTML_FILE}" "${HEADERS_FILE}"; then
        hosting+=("\"Heroku\"")
    fi

    [ ${#hosting[@]} -eq 0 ] && echo "" || printf '%s\n' "${hosting[@]}"
}

detect_missing_security_headers() {
    local missing=()

    # Check for Strict-Transport-Security
    if ! grep -qi "strict-transport-security" "${HEADERS_FILE}"; then
        missing+=("\"Strict-Transport-Security\"")
    fi

    # Check for Content-Security-Policy
    if ! grep -qi "content-security-policy" "${HEADERS_FILE}"; then
        missing+=("\"Content-Security-Policy\"")
    fi

    # Check for X-Content-Type-Options
    if ! grep -qi "x-content-type-options" "${HEADERS_FILE}"; then
        missing+=("\"X-Content-Type-Options\"")
    fi

    # Check for X-Frame-Options
    if ! grep -qi "x-frame-options" "${HEADERS_FILE}"; then
        missing+=("\"X-Frame-Options\"")
    fi

    # Check for Referrer-Policy
    if ! grep -qi "referrer-policy" "${HEADERS_FILE}"; then
        missing+=("\"Referrer-Policy\"")
    fi

    # Check for Permissions-Policy
    if ! grep -qi "permissions-policy" "${HEADERS_FILE}"; then
        missing+=("\"Permissions-Policy\"")
    fi

    [ ${#missing[@]} -eq 0 ] && echo "" || printf '%s\n' "${missing[@]}"
}

check_file_exists() {
    local file_url="$1"
    local status_code=$(curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$file_url" 2>/dev/null || echo "000")

    if [ "$status_code" = "200" ]; then
        echo "true"
    else
        echo "false"
    fi
}

detect_missing_files() {
    local missing=()
    local base_url=$(echo "$URL" | sed -E 's|(https?://[^/]+).*|\1|')

    # Check for robots.txt
    if [ "$(check_file_exists "${base_url}/robots.txt")" = "false" ]; then
        missing+=("\"robots.txt\"")
    fi

    # Check for sitemap.xml
    if [ "$(check_file_exists "${base_url}/sitemap.xml")" = "false" ]; then
        missing+=("\"sitemap.xml\"")
    fi

    # Check for favicon.ico
    if [ "$(check_file_exists "${base_url}/favicon.ico")" = "false" ]; then
        missing+=("\"favicon.ico\"")
    fi

    # Check for humans.txt
    if [ "$(check_file_exists "${base_url}/humans.txt")" = "false" ]; then
        missing+=("\"humans.txt\"")
    fi

    # Check for security.txt
    if [ "$(check_file_exists "${base_url}/.well-known/security.txt")" = "false" ]; then
        missing+=("\"security.txt\"")
    fi

    [ ${#missing[@]} -eq 0 ] && echo "" || printf '%s\n' "${missing[@]}"
}

detect_missing_meta_tags() {
    local missing=()

    # Check for viewport meta tag
    if ! grep -qi "viewport" "${HTML_FILE}"; then
        missing+=("\"viewport\"")
    fi

    # Check for description meta tag
    if ! grep -qi '<meta name="description"' "${HTML_FILE}"; then
        missing+=("\"description\"")
    fi

    # Check for canonical link
    if ! grep -qi 'rel="canonical"' "${HTML_FILE}"; then
        missing+=("\"canonical\"")
    fi

    # Check for Open Graph tags
    if ! grep -qi 'property="og:' "${HTML_FILE}"; then
        missing+=("\"Open Graph tags\"")
    fi

    # Check for Twitter Card tags
    if ! grep -qi 'name="twitter:' "${HTML_FILE}"; then
        missing+=("\"Twitter Card tags\"")
    fi

    # Check for theme-color
    if ! grep -qi 'name="theme-color"' "${HTML_FILE}"; then
        missing+=("\"theme-color\"")
    fi

    [ ${#missing[@]} -eq 0 ] && echo "" || printf '%s\n' "${missing[@]}"
}

detect_meta_info() {
    # Extract title (using sed instead of grep -P)
    TITLE=$(sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' "${HTML_FILE}" | head -1 | sed 's/"/\\"/g' || echo "")

    # Extract description (using sed instead of grep -P)
    DESCRIPTION=$(grep -i 'meta name="description"' "${HTML_FILE}" | sed -n 's/.*content="\([^"]*\)".*/\1/p' | head -1 | sed 's/"/\\"/g' || echo "")

    # Check if responsive
    RESPONSIVE=false
    if grep -qi "viewport.*width=device-width" "${HTML_FILE}"; then
        RESPONSIVE=true
    fi

    # HTTP Version (using sed instead of grep -P)
    HTTP_VERSION=$(head -1 "${HEADERS_FILE}" | sed -n 's/.*\(HTTP\/[0-9.]*\).*/\1/p' || echo "")

    # SSL Enabled
    SSL_ENABLED=false
    if [[ "$URL" =~ ^https:// ]]; then
        SSL_ENABLED=true
    fi

    echo "$TITLE|$DESCRIPTION|$RESPONSIVE|$HTTP_VERSION|$SSL_ENABLED"
}

# Build JSON arrays
join_array() {
    if [ $# -eq 0 ]; then
        echo "[]"
    else
        local result="["
        local first=true
        for item in "$@"; do
            if [ "$first" = true ]; then
                result="${result}${item}"
                first=false
            else
                result="${result},${item}"
            fi
        done
        result="${result}]"
        echo "$result"
    fi
}

# Run detections
echo -e "${YELLOW}Detecting technologies...${NC}"

# Read arrays line by line (compatible with older bash versions)
CMS=()
while IFS= read -r line; do
    [ -n "$line" ] && CMS+=("$line")
done < <(detect_cms)

JS_FRAMEWORKS=()
while IFS= read -r line; do
    [ -n "$line" ] && JS_FRAMEWORKS+=("$line")
done < <(detect_javascript_frameworks)

JS_LIBRARIES=()
while IFS= read -r line; do
    [ -n "$line" ] && JS_LIBRARIES+=("$line")
done < <(detect_javascript_libraries)

UI_FRAMEWORKS=()
while IFS= read -r line; do
    [ -n "$line" ] && UI_FRAMEWORKS+=("$line")
done < <(detect_ui_frameworks)

ANALYTICS=()
while IFS= read -r line; do
    [ -n "$line" ] && ANALYTICS+=("$line")
done < <(detect_analytics)

TAG_MANAGERS=()
while IFS= read -r line; do
    [ -n "$line" ] && TAG_MANAGERS+=("$line")
done < <(detect_tag_managers)

CDN=()
while IFS= read -r line; do
    [ -n "$line" ] && CDN+=("$line")
done < <(detect_cdn)

FONT_SCRIPTS=()
while IFS= read -r line; do
    [ -n "$line" ] && FONT_SCRIPTS+=("$line")
done < <(detect_font_scripts)

SECURITY=()
while IFS= read -r line; do
    [ -n "$line" ] && SECURITY+=("$line")
done < <(detect_security)

COOKIE_COMPLIANCE=()
while IFS= read -r line; do
    [ -n "$line" ] && COOKIE_COMPLIANCE+=("$line")
done < <(detect_cookie_compliance)

MISC=()
while IFS= read -r line; do
    [ -n "$line" ] && MISC+=("$line")
done < <(detect_miscellaneous)

PERFORMANCE=()
while IFS= read -r line; do
    [ -n "$line" ] && PERFORMANCE+=("$line")
done < <(detect_performance)

RUM=()
while IFS= read -r line; do
    [ -n "$line" ] && RUM+=("$line")
done < <(detect_rum)

WEB_FRAMEWORKS=()
while IFS= read -r line; do
    [ -n "$line" ] && WEB_FRAMEWORKS+=("$line")
done < <(detect_web_frameworks)

PROG_LANGUAGES=()
while IFS= read -r line; do
    [ -n "$line" ] && PROG_LANGUAGES+=("$line")
done < <(detect_programming_languages)

CACHING=()
while IFS= read -r line; do
    [ -n "$line" ] && CACHING+=("$line")
done < <(detect_caching)

REVERSE_PROXIES=()
while IFS= read -r line; do
    [ -n "$line" ] && REVERSE_PROXIES+=("$line")
done < <(detect_reverse_proxies)

HOSTING=()
while IFS= read -r line; do
    [ -n "$line" ] && HOSTING+=("$line")
done < <(detect_hosting)

echo -e "${YELLOW}Checking for missing features...${NC}"

MISSING_HEADERS=()
while IFS= read -r line; do
    [ -n "$line" ] && MISSING_HEADERS+=("$line")
done < <(detect_missing_security_headers)

MISSING_FILES=()
while IFS= read -r line; do
    [ -n "$line" ] && MISSING_FILES+=("$line")
done < <(detect_missing_files)

MISSING_META=()
while IFS= read -r line; do
    [ -n "$line" ] && MISSING_META+=("$line")
done < <(detect_missing_meta_tags)

# Get meta info
IFS='|' read -r TITLE DESCRIPTION RESPONSIVE HTTP_VERSION SSL_ENABLED <<< "$(detect_meta_info)"

# Build final JSON
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "${OUTPUT_FILE}" << EOF
{
  "url": "${URL}",
  "analyzed_at": "${TIMESTAMP}",
  "technologies": {
    "cms": $(join_array ${CMS[@]+"${CMS[@]}"}),
    "javascript_frameworks": $(join_array ${JS_FRAMEWORKS[@]+"${JS_FRAMEWORKS[@]}"}),
    "javascript_libraries": $(join_array ${JS_LIBRARIES[@]+"${JS_LIBRARIES[@]}"}),
    "ui_frameworks": $(join_array ${UI_FRAMEWORKS[@]+"${UI_FRAMEWORKS[@]}"}),
    "web_frameworks": $(join_array ${WEB_FRAMEWORKS[@]+"${WEB_FRAMEWORKS[@]}"}),
    "programming_languages": $(join_array ${PROG_LANGUAGES[@]+"${PROG_LANGUAGES[@]}"}),
    "analytics": $(join_array ${ANALYTICS[@]+"${ANALYTICS[@]}"}),
    "tag_managers": $(join_array ${TAG_MANAGERS[@]+"${TAG_MANAGERS[@]}"}),
    "cdn": $(join_array ${CDN[@]+"${CDN[@]}"}),
    "caching": $(join_array ${CACHING[@]+"${CACHING[@]}"}),
    "reverse_proxies": $(join_array ${REVERSE_PROXIES[@]+"${REVERSE_PROXIES[@]}"}),
    "font_scripts": $(join_array ${FONT_SCRIPTS[@]+"${FONT_SCRIPTS[@]}"}),
    "security": $(join_array ${SECURITY[@]+"${SECURITY[@]}"}),
    "cookie_compliance": $(join_array ${COOKIE_COMPLIANCE[@]+"${COOKIE_COMPLIANCE[@]}"}),
    "rum": $(join_array ${RUM[@]+"${RUM[@]}"}),
    "performance": $(join_array ${PERFORMANCE[@]+"${PERFORMANCE[@]}"}),
    "hosting": $(join_array ${HOSTING[@]+"${HOSTING[@]}"}),
    "miscellaneous": $(join_array ${MISC[@]+"${MISC[@]}"})
  },
  "meta": {
    "title": "${TITLE}",
    "description": "${DESCRIPTION}",
    "responsive": ${RESPONSIVE},
    "http_version": "${HTTP_VERSION}",
    "ssl_enabled": ${SSL_ENABLED}
  },
  "missing": {
    "security": $(join_array ${MISSING_HEADERS[@]+"${MISSING_HEADERS[@]}"}),
    "files": $(join_array ${MISSING_FILES[@]+"${MISSING_FILES[@]}"}),
    "meta_tags": $(join_array ${MISSING_META[@]+"${MISSING_META[@]}"})
  }
}
EOF

# Output filename based on URL (include path to make it unique)
URL_SAFE=$(echo "$URL" | sed -E 's|https?://||' | sed 's|/$||' | sed 's|[^a-zA-Z0-9.-]|_|g')
FINAL_OUTPUT="${OUTPUT_DIR}/${URL_SAFE}.json"

# Create output directory if it doesn't exist
mkdir -p "${OUTPUT_DIR}"

# If file exists, append counter to make it unique
if [ -f "${FINAL_OUTPUT}" ]; then
    COUNTER=2
    while [ -f "${OUTPUT_DIR}/${URL_SAFE}_${COUNTER}.json" ]; do
        ((COUNTER++))
    done
    FINAL_OUTPUT="${OUTPUT_DIR}/${URL_SAFE}_${COUNTER}.json"
fi

# Copy to final location and format
cat "${OUTPUT_FILE}" > "${FINAL_OUTPUT}"

echo -e "\n${GREEN}✓ Analysis complete!${NC}"
echo -e "${GREEN}Results saved to: ${FINAL_OUTPUT}${NC}\n"

# Display summary
echo -e "${YELLOW}=== Technology Summary ===${NC}"
cat "${FINAL_OUTPUT}" | grep -A 100 "technologies" | grep -v "^{" | grep -v "^}" | grep -v "meta" | grep -v "missing" | grep "\[" | while IFS=: read -r key value; do
    if [[ "$value" != *"[]"* ]]; then
        clean_key=$(echo "$key" | tr -d ' "')
        echo -e "${GREEN}${clean_key}:${NC} ${value}"
    fi
done

# Display missing features summary
if [ ${#MISSING_HEADERS[@]} -gt 0 ] || [ ${#MISSING_FILES[@]} -gt 0 ] || [ ${#MISSING_META[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}=== Missing Features ===${NC}"

    if [ ${#MISSING_HEADERS[@]} -gt 0 ]; then
        echo -e "${RED}Security:${NC} $(join_array ${MISSING_HEADERS[@]+"${MISSING_HEADERS[@]}"})"
    fi

    if [ ${#MISSING_FILES[@]} -gt 0 ]; then
        echo -e "${RED}Files:${NC} $(join_array ${MISSING_FILES[@]+"${MISSING_FILES[@]}"})"
    fi

    if [ ${#MISSING_META[@]} -gt 0 ]; then
        echo -e "${RED}Meta Tags:${NC} $(join_array ${MISSING_META[@]+"${MISSING_META[@]}"})"
    fi
fi

echo ""
cat "${FINAL_OUTPUT}"
