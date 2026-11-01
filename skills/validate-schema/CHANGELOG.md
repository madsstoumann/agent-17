# Changelog

All notable changes to the `validate-schema` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.1.0] - 2026-11-01

### Added
- Levels ("errors only", `--level error`, `warn`, `error,warn`, `all`) limit the issues listed; the summary counts stay complete.
- A console list ("just the list", `--console`) in the same one-line format as the audit skills.

## [1.0.0] - 2026-01-09

### Added
- Initial release: validates schema.org structured data (JSON-LD, Microdata, RDFa) for a URL or local HTML file via validator.schema.org and reports entities, issues and recommendations.
