# Tech Stack Analyzer

A bash script that analyzes a website's technology stack similar to Wappalyzer and outputs structured JSON results.

## Features

The script detects and categorizes technologies across multiple categories:

### Detection Categories

- **CMS**: WordPress, Drupal, Joomla, Umbraco, Shopify, Wix, Squarespace, Webflow
- **JavaScript Frameworks**: React, Vue.js, Angular, Next.js, Nuxt.js, Svelte
- **JavaScript Libraries**: jQuery, Lodash, Moment.js, Boomerang, GSAP
- **UI Frameworks**: Bootstrap, Tailwind CSS, Foundation, Material-UI, Bulma
- **Web Servers**: Nginx, Apache, Microsoft ASP.NET, Express
- **Analytics**: Google Analytics, Adobe Analytics, Matomo, Hotjar, Mixpanel
- **Tag Managers**: Google Tag Manager, Adobe Tag Manager, Tealium
- **CDN**: Cloudflare, Akamai, Fastly, Amazon CloudFront, jsDelivr, unpkg
- **Font Scripts**: Google Fonts, Adobe Fonts, Font Awesome
- **Security**: HSTS, Cloudflare Bot Management, reCAPTCHA, Content Security Policy
- **Cookie Compliance**: OneTrust, Cookiebot, Cookie Consent
- **Performance**: Akamai mPulse, New Relic, Priority Hints
- **Miscellaneous**: Open Graph, HTTP/2, HTTP/3

### Metadata Extraction

- Page title
- Meta description
- Responsive design detection
- HTTP version
- SSL/TLS status

### Missing Features Detection

**Security Headers:**
- Strict-Transport-Security (HSTS)
- Content-Security-Policy (CSP)
- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- Permissions-Policy

**Important Files:**
- robots.txt
- sitemap.xml
- favicon.ico
- humans.txt
- security.txt (.well-known/security.txt)

**Essential Meta Tags:**
- viewport
- description
- canonical
- Open Graph tags
- Twitter Card tags
- theme-color

## Requirements

- bash (compatible with macOS and Linux)
- curl
- grep
- sed

## Installation

1. Download the script:
```bash
chmod +x analyze-tech-stack.sh
```

## Usage

### Single URL Analysis

```bash
./analyze-tech-stack.sh <url>
```

### Examples

```bash
# With full URL
./analyze-tech-stack.sh https://www.example.com

# Without protocol (will default to https)
./analyze-tech-stack.sh www.example.com

# With path
./analyze-tech-stack.sh https://www.example.com/dk/
```

### Batch Mode Analysis

Analyze multiple URLs from a file:

```bash
./analyze-tech-stack-batch.sh urls.txt [parallel_jobs]
```

### Batch Mode Examples

```bash
# Analyze URLs from file with default parallelism (3 jobs)
./analyze-tech-stack-batch.sh urls.txt

# Analyze URLs with 5 parallel jobs
./analyze-tech-stack-batch.sh urls.txt 5

# Analyze URLs sequentially (1 job at a time)
./analyze-tech-stack-batch.sh urls.txt 1
```

### URLs File Format

Create a text file with one URL per line:

```
# Sample URLs file (urls.txt)
# Lines starting with # are comments
# Blank lines are ignored

https://www.site1.com
https://www.site2.com/page
https://www.site3.com
```

## Output

### Single URL Mode

The script generates:

1. **Console Output**: A color-coded summary of detected technologies
2. **JSON File**: A timestamped file named `tech_stack_<domain>_<timestamp>.json`

### Batch Mode

Batch mode creates a directory with multiple output files:

```
tech_stack_batch_20251218_120000/
├── detailed.json          # Complete results for all URLs
├── summary.json          # Statistics and analysis
└── process.log           # Processing log with timestamps
```

**Detailed Output** - Contains individual results for each URL:
- Full technology detection results
- Success/failure status
- Error messages for failed analyses

**Summary Output** - Provides aggregate statistics:
- Total sites analyzed
- Success/failure counts
- Common technologies across all sites
- Technology usage percentages

### Example Output

```json
{
  "url": "https://www.lotushygiene.com/dk/",
  "analyzed_at": "2025-12-18T11:52:26Z",
  "technologies": {
    "cms": [],
    "javascript_frameworks": [],
    "javascript_libraries": ["jQuery","Boomerang"],
    "ui_frameworks": [],
    "analytics": ["Google Analytics"],
    "tag_managers": ["Google Tag Manager"],
    "cdn": ["Akamai"],
    "font_scripts": [],
    "security": ["HSTS","Cloudflare Bot Management","Content Security Policy"],
    "cookie_compliance": ["OneTrust"],
    "miscellaneous": ["Open Graph","HTTP/2"],
    "performance": ["Akamai mPulse","Priority Hints"]
  },
  "meta": {
    "title": "Lotus Startside - Lotus",
    "description": "",
    "responsive": true,
    "http_version": "HTTP/2",
    "ssl_enabled": true
  },
  "missing": {
    "security": ["Referrer-Policy","Permissions-Policy"],
    "files": ["humans.txt","security.txt"],
    "meta_tags": ["description"]
  }
}
```

The console output also displays missing features in red for easy identification:

```
=== Missing Features ===
Security: ["Referrer-Policy","Permissions-Policy"]
Files: ["humans.txt","security.txt"]
Meta Tags: ["description"]
```

## How It Works

1. **Fetches HTTP Headers**: Analyzes server headers for technology signatures
2. **Downloads HTML Content**: Retrieves the page HTML for content analysis
3. **Pattern Matching**: Uses regex patterns to detect technology fingerprints
4. **Categorization**: Organizes detected technologies into logical categories
5. **Security Audit**: Checks for missing security headers and best practices
6. **File Validation**: Verifies presence of important SEO and security files
7. **JSON Export**: Outputs structured data for easy parsing and integration

## Additional Checks Implemented

Beyond basic technology detection, the script also performs:

### Security Auditing
- **HTTP Security Headers**: Validates presence of critical security headers (HSTS, CSP, X-Frame-Options, etc.)
- **Security Best Practices**: Checks for security.txt file in .well-known directory

### SEO & Accessibility
- **Essential Files**: robots.txt, sitemap.xml, favicon.ico
- **Meta Tags**: Validates viewport, description, canonical, social media tags
- **Structured Data**: Detects Open Graph and Twitter Card implementations

### Other Suggested Checks (Not Yet Implemented)

You may want to extend the script to check for:

1. **Performance**
   - Lazy loading implementation
   - Image optimization (WebP, AVIF support)
   - Resource hints (preload, prefetch, dns-prefetch)
   - Service Worker / PWA manifest

2. **Accessibility**
   - ARIA landmarks
   - Alt text on images
   - Skip navigation links
   - Color contrast (requires rendering)

3. **SEO Advanced**
   - Schema.org structured data
   - hreflang tags for internationalization
   - Pagination tags (rel=next/prev)
   - AMP pages

4. **Privacy & Compliance**
   - GDPR consent implementation
   - Cookie declaration
   - Privacy policy link
   - Terms of service link

5. **Modern Web Features**
   - HTTP/3 support
   - Brotli compression
   - Service Worker registration
   - Web App Manifest
   - Push notification support

6. **Development & Debug**
   - Source maps exposed
   - Console errors (requires rendering)
   - Mixed content warnings
   - Deprecated API usage

## Detection Method

The script uses multiple detection methods:

- **Header Analysis**: Examines HTTP response headers (Server, X-Powered-By, etc.)
- **HTML Pattern Matching**: Searches for characteristic strings and patterns in HTML
- **Script/Link Detection**: Identifies technology-specific URLs and CDN patterns
- **Meta Tag Analysis**: Extracts metadata and technology markers

## Limitations

- Detection is based on publicly visible signatures only
- Some technologies may be missed if they don't leave obvious fingerprints
- Minified or obfuscated code may reduce detection accuracy
- Client-side rendered content may not be fully analyzed
- Results depend on what's visible in the initial page load

## Extending the Script

To add detection for new technologies:

1. Locate the appropriate `detect_*` function
2. Add a new conditional check with the technology's signature
3. Append the technology name to the array if detected

Example:

```bash
detect_analytics() {
    local analytics=()

    # Existing detections...

    # Add new detection
    if grep -qi "your-analytics-pattern" "${HTML_FILE}"; then
        analytics+=("\"Your Analytics Tool\"")
    fi

    [ ${#analytics[@]} -eq 0 ] && echo "" || printf '%s\n' "${analytics[@]}"
}
```

## Troubleshooting

### Script fails with "command not found"
Ensure you have `curl`, `grep`, and `sed` installed.

### No technologies detected
- Check if the URL is accessible
- Verify the site doesn't require authentication
- Some sites may block automated requests

### Invalid JSON output
Run the validation command:
```bash
python3 -m json.tool tech_stack_*.json
```

## License

This script is provided as-is for educational and analysis purposes.

## Comparison with Wappalyzer

This script provides similar functionality to Wappalyzer by:
- Analyzing HTTP headers and HTML content
- Detecting common web technologies
- Categorizing results
- Outputting structured data

Differences:
- Wappalyzer has a more extensive signature database
- This script is lightweight and runs locally
- Fully customizable detection patterns
- No external dependencies or API calls
